import { decodeEntities, htmlToText, type SisRecord } from "@sd/core";
import { normalizeBaseUrl } from "../blackboard/session.js";
import { CookieJar, isLoopback, readCapped, sleep, type FetchLike } from "../net.js";
import { AuthExpiredError, HttpError, type Connector, type ConnectorContext, type SyncResult } from "../types.js";

/**
 * The student information system (SIS). Many universities, UVA's included,
 * run Oracle PeopleSoft Campus Solutions. Its student pages are server-made
 * HTML with the same delivered page names everywhere, so the dashboard reads
 * two of them through your own signed-in session, GET only:
 *
 *   Student Center    this week's classes (days, times, rooms), holds,
 *                     to-do list, enrollment appointment
 *   My Course History every course on your record with its official grade
 *
 * Nothing is ever submitted. The SIS signs you out after a short idle time,
 * so it is read on sign-in and a few times a day, not every 30 minutes.
 */
export const SIS_COOKIES = "sis.session.cookies";

/**
 * Schools with a known setup. Only public addresses here.
 *  lmsUrl     where the school's Canvas or Blackboard itself answers
 *  lmsAliases addresses people may type that aren't it (an information site about it)
 *  sisStart   the SIS's own front door (UVA's bare address shows "access interrupted")
 */
export const SIS_PRESETS: Record<string, { name: string; sis: string; sisStart?: string; lms: "canvas" | "blackboard"; lmsUrl: string; lmsAliases?: string[] }> = {
  uva: {
    name: "University of Virginia",
    sis: "https://sisuva.admin.virginia.edu",
    sisStart: "https://sisuva.admin.virginia.edu/ihprd/signon.html",
    lms: "canvas",
    lmsUrl: "https://canvas.its.virginia.edu",
    lmsAliases: ["https://canvas.virginia.edu"],
  },
};

/** "canvas.virginia.edu" (UVA's page about Canvas) → the Canvas it means. */
export function presetLmsFor(base: string): string | undefined {
  for (const p of Object.values(SIS_PRESETS)) if (p.lmsAliases?.includes(base)) return p.lmsUrl;
  return undefined;
}

const PAGES = {
  studentCenter: "c/SA_LEARNER_SERVICES.SSS_STUDENT_CENTER.GBL",
  courseHistory: "c/SA_LEARNER_SERVICES.SSS_MY_CRSEHIST.GBL",
};

/**
 * "https://sis.school.edu/psp/site/EMPLOYEE/SA/h/?tab=DEFAULT" → "/psc/site/EMPLOYEE/SA/".
 * PeopleSoft addresses carry the site, portal and node; the page content lives under /psc/.
 */
export function peopleSoftPath(url: string): string | undefined {
  try {
    const m = /^\/(?:psp|psc)\/([^/]+)\/([^/]+)\/([^/]+)\//.exec(new URL(url).pathname);
    return m ? `/psc/${m[1]}/${m[2]}/${m[3]}/` : undefined;
  } catch {
    return undefined;
  }
}

/** Paths worth trying: the one learned from the window first, then the usual student-node names. */
export function candidatePaths(learned: string | undefined): string[] {
  const out: string[] = [];
  if (learned) out.push(learned);
  const m = learned ? /^\/psc\/([^/]+)\/([^/]+)\/([^/]+)\/$/.exec(learned) : undefined;
  if (m) for (const node of ["SA", "HRMS", "CS"]) out.push(`/psc/${m[1]}/${m[2]}/${node}/`);
  return [...new Set(out)];
}

// ---------- reading PeopleSoft pages ----------

interface Cell {
  header: boolean;
  html: string;
}
interface Table {
  rows: Cell[][];
}

/** Every <table> with its rows and cells (nested tables become tables of their own). */
export function tablesIn(html: string): Table[] {
  const tables: Table[] = [];
  const stack: { tag: string; table?: Table; row?: Cell[]; start?: number }[] = [];
  const re = /<(\/?)(table|tr|td|th)\b[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const close = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    if (!close) {
      if (tag === "table") {
        const t: Table = { rows: [] };
        tables.push(t);
        stack.push({ tag, table: t });
      } else if (tag === "tr") {
        const t = [...stack].reverse().find((s) => s.tag === "table")?.table;
        if (!t) continue;
        const row: Cell[] = [];
        t.rows.push(row);
        stack.push({ tag, row });
      } else {
        const tr = [...stack].reverse().find((s) => s.tag === "tr" || s.tag === "table");
        if (tr?.tag !== "tr") continue;
        stack.push({ tag, row: tr.row, start: re.lastIndex });
      }
    } else {
      const i = stack.map((s) => s.tag).lastIndexOf(tag);
      if (i < 0) continue;
      const e = stack[i]!;
      if ((tag === "td" || tag === "th") && e.row && e.start !== undefined) e.row.push({ header: tag === "th", html: html.slice(e.start, m.index) });
      stack.length = i;
    }
  }
  return tables;
}

/** A cell's text, one line per <br>/block, whitespace tidied. */
export function cellText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(br|\/div|\/p|\/span)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * The rows of the grid whose header row names every wanted column, as
 * records keyed like `want`. Columns are found by their header text, not by
 * position or element ids, so a school's own layout tweaks don't break it.
 */
export function grid<K extends string>(html: string, want: Record<K, RegExp>): Record<K, string>[] {
  let best: Record<K, string>[] | undefined;
  for (const t of tablesIn(html)) {
    const h = t.rows.findIndex((r) => r.length > 1 && Object.values<RegExp>(want).every((re) => r.some((c) => re.test(cellText(c.html)))));
    if (h < 0) continue;
    const head = t.rows[h]!.map((c) => cellText(c.html));
    const col = Object.fromEntries(Object.entries<RegExp>(want).map(([k, re]) => [k, head.findIndex((x) => re.test(x))])) as Record<K, number>;
    const width = Math.max(...Object.values<number>(col)) + 1;
    const rows = t.rows
      .slice(h + 1)
      .filter((r) => r.length >= width && !r.every((c) => c.header))
      .map((r) => Object.fromEntries(Object.entries<number>(col).map(([k, i]) => [k, cellText(r[i]!.html)])) as Record<K, string>)
      .filter((r) => Object.values<string>(r).some(Boolean));
    if (!best || rows.length > best.length) best = rows;
  }
  return best ?? [];
}

const DAYS: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

/** "2:00PM" → "14:00". */
function to24(t: string): string | undefined {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(t.trim());
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if (m[3]!.toUpperCase() === "P") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** "CS 2100-001\nLEC (12345)" → code, section, component. */
function classCell(text: string): { code: string; section?: string; component?: string } | undefined {
  const m = /([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)(?:\s*-\s*([0-9A-Z]{1,4}))?/.exec(text);
  if (!m) return undefined;
  const comp = /\b(LEC|LAB|DIS|SEM|IND|STO|CLN|PRA|WKS|STU|ACT|REC)\b/.exec(text)?.[1];
  return { code: `${m[1]} ${m[2]}`, ...(m[3] ? { section: m[3] } : {}), ...(comp ? { component: comp } : {}) };
}

/** "MoWe 2:00PM - 3:15PM\nRice Hall 130" (one or more meetings) → meetings. */
function scheduleCell(text: string): { days: number[]; start?: string; end?: string; room?: string }[] {
  const lines = text.split("\n");
  const out: { days: number[]; start?: string; end?: string; room?: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)(?:\s+(.+))?$/i.exec(lines[i]!);
    if (!m) continue;
    const days = (m[1]!.match(/Mo|Tu|We|Th|Fr|Sa|Su/g) ?? []).map((d) => DAYS[d]!);
    let room = m[4]?.trim();
    // The room is often on the next line.
    if (!room && lines[i + 1] && !/^(?:Mo|Tu|We|Th|Fr|Sa|Su)+\s+\d/.test(lines[i + 1]!)) room = lines[++i]!.trim();
    out.push({ days, start: to24(m[2]!), end: to24(m[3]!), ...(room && !/^TBA$/i.test(room) ? { room } : {}) });
  }
  return out;
}

/** Lines of the page under a heading, until the next heading (or a "none" line). */
function section(lines: string[], heading: RegExp, none: RegExp): string[] | undefined {
  const i = lines.findIndex((l) => heading.test(l));
  if (i < 0) return undefined;
  const out: string[] = [];
  for (const l of lines.slice(i + 1, i + 25)) {
    if (none.test(l)) return [];
    if (/^(holds|to do list|enrollment dates|advisor|program advisor|search for classes|academics|finances|personal information|admissions|my academics|student center)$/i.test(l)) break;
    if (/^(details|more|view all|other academic\.\.\.|go)\b/i.test(l) || l.length < 3) continue;
    out.push(l);
  }
  return out;
}

export function parseStudentCenter(html: string): Pick<SisRecord, "schedule" | "holds" | "todos" | "enrollment"> & { recognized: { schedule: boolean; holds: boolean; todos: boolean } } {
  const schedule: SisRecord["schedule"] = [];
  const rows = grid(html, { cls: /^class$/i, sched: /^schedule$/i });
  for (const r of rows) {
    const c = classCell(r.cls);
    if (!c) continue;
    for (const m of scheduleCell(r.sched)) schedule.push({ ...c, ...m });
  }
  const lines = htmlToText(html.replace(/<\/(td|th)\s*>/gi, "\n"))
    .split("\n")
    .map((l) => l.replace(/^•\s*/, "").trim())
    .filter(Boolean);
  const holds = section(lines, /^holds$/i, /^no holds/i);
  const todos = section(lines, /^to do list$/i, /^no to do/i);
  const enrollment: SisRecord["enrollment"] = [];
  const text = lines.join(" ");
  for (const m of text.matchAll(/you may begin enrolling for (?:the )?(.+?) session on ([A-Z][a-z]+ \d{1,2}, \d{4})(?: at)?(?: (\d{1,2}:\d{2} ?[AP]M))?/gi)) {
    const at = Date.parse(`${m[2]} ${m[3] ?? ""}`.trim());
    enrollment.push({ term: m[1]!.replace(/\s+/g, " ").trim(), ...(Number.isFinite(at) ? { at: new Date(at).toISOString() } : {}), text: m[0]!.trim() });
  }
  return {
    schedule,
    holds: (holds ?? []).map((title) => ({ title })),
    todos: (todos ?? []).map((title) => ({ title })),
    enrollment,
    recognized: { schedule: rows.length > 0 || /this week'?s schedule/i.test(text), holds: holds !== undefined, todos: todos !== undefined },
  };
}

export function parseCourseHistory(html: string): SisRecord["history"] {
  const rows = grid(html, { course: /^course$/i, title: /^description$/i, term: /^term$/i, grade: /^grade$/i, units: /^units$/i, status: /^status$/i });
  const out: SisRecord["history"] = [];
  for (const r of rows) {
    const code = /([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)/.exec(r.course);
    if (!code) continue;
    const units = Number(r.units);
    out.push({
      term: r.term,
      code: `${code[1]} ${code[2]}`,
      title: r.title,
      ...(Number.isFinite(units) && r.units !== "" ? { units } : {}),
      ...(r.grade ? { grade: r.grade.trim() } : {}),
      ...(r.status ? { status: r.status } : {}),
    });
  }
  return out;
}

// ---------- the session ----------

/** A PeopleSoft sign-in page, or the school's single sign-on bouncing us there. */
function isSignIn(html: string): boolean {
  return (
    /<form[^>]+(?:name|id)=["']?login/i.test(html) ||
    /name=["']?(?:pwd|userid)["']?/i.test(html) ||
    /SAMLRequest|RelayState/.test(html) ||
    /cmd=login/i.test(html.slice(0, 4000))
  );
}

/** One GET of a SIS page with your session. Never leaves the SIS host; a bounce to sign-in = session gone. */
export async function sisGet(base: string, path: string, jar: CookieJar, fetchImpl: FetchLike, timeoutMs = 20_000): Promise<string> {
  const origin = new URL(base).origin;
  let url = new URL(path, origin);
  for (let hop = 0; hop < 6; hop++) {
    const cookie = jar.header(url);
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "text/html", ...(cookie ? { cookie } : {}) }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    jar.store(url, res.headers.getSetCookie?.() ?? []);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) throw new HttpError(res.status);
      const next = new URL(loc, url);
      const okProto = next.protocol === "https:" || (next.protocol === "http:" && isLoopback(next.hostname));
      if (!okProto || next.origin !== origin || /cmd=login|signon/i.test(next.search + next.pathname)) throw new AuthExpiredError();
      url = next;
      continue;
    }
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      throw new AuthExpiredError();
    }
    if (res.status === 403) {
      // A sign-in page means the session is gone; anything else ("Access to SIS interrupted") is the SIS refusing.
      const body = new TextDecoder().decode(await readCapped(res, 512 * 1024));
      if (isSignIn(body)) throw new AuthExpiredError();
      throw new HttpError(403, "The SIS turned this request away");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError(res.status);
    }
    const html = new TextDecoder().decode(await readCapped(res, 6 * 1024 * 1024));
    if (isSignIn(html)) throw new AuthExpiredError();
    return html;
  }
  throw new Error("Too many redirects");
}

/**
 * Is this session signed in to the SIS? Returns the PeopleSoft path that
 * answered (so later reads go straight there), or undefined.
 */
export async function sisWorks(base: string, learned: string | undefined, jar: CookieJar, fetchImpl: FetchLike): Promise<string | undefined> {
  if (jar.size === 0) return undefined;
  for (const path of candidatePaths(learned)) {
    try {
      const html = await sisGet(base, `${path}${PAGES.studentCenter}`, jar, fetchImpl, 10_000);
      if (/name=["']?win0["']?|win0divPAGECONTAINER|PSPAGECONTAINER|ptifrmtgtframe/i.test(html)) return path;
    } catch {
      /* not this one */
    }
  }
  return undefined;
}

export const sis: Connector = {
  id: "sis",
  label: "SIS",
  capabilities: ["courses"],
  async status(ctx) {
    if (!normalizeBaseUrl(ctx.env.SIS_BASE_URL) || !(await ctx.secrets.get(SIS_COOKIES))) return { state: "not-configured", detail: "Not linked yet" };
    if (ctx.env.SIS_SESSION_EXPIRED === "true") return { state: "needs-sign-in", detail: "Sign-in expired. Reconnect to read your record again." };
    return { state: "ready" };
  },
  async sync(ctx) {
    const base = normalizeBaseUrl(ctx.env.SIS_BASE_URL);
    const saved = await ctx.secrets.get(SIS_COOKIES);
    if (!base || !saved) return {};
    // The record changes slowly and the SIS signs you out quickly: a few reads a day are plenty.
    const last = Date.parse(ctx.env.SIS_LAST_READ ?? "");
    if (!ctx.deep && Number.isFinite(last) && ctx.now.getTime() - last < 6 * 3_600_000) return {};
    const jar = CookieJar.parse(saved);
    try {
      return await syncSis(base, ctx, jar);
    } finally {
      if (jar.dirty) await ctx.secrets.set(SIS_COOKIES, jar.serialize());
    }
  },
};

export async function syncSis(base: string, ctx: ConnectorContext, jar: CookieJar): Promise<SyncResult> {
  const path = ctx.env.SIS_PS_PATH || (await sisWorks(base, undefined, jar, ctx.fetch));
  if (!path) throw new AuthExpiredError();
  const notes: string[] = [];
  const gap = Number(ctx.env.SIS_REQUEST_GAP_MS ?? 400);
  const center = parseStudentCenter(await sisGet(base, `${path}${PAGES.studentCenter}`, jar, ctx.fetch));
  if (!center.recognized.schedule) notes.push("class schedule: this school's Student Center looks different; not read");
  if (!center.recognized.holds) notes.push("holds: not found on the Student Center");
  await sleep(gap);
  let history: SisRecord["history"] = [];
  try {
    history = parseCourseHistory(await sisGet(base, `${path}${PAGES.courseHistory}`, jar, ctx.fetch));
    if (history.length === 0) notes.push("course history: page not recognized");
  } catch (e) {
    if (e instanceof AuthExpiredError) throw e;
    notes.push("course history: not available");
  }
  const { recognized: _r, ...rest } = center;
  notes.push(`${history.length} course${history.length === 1 ? "" : "s"} on record, ${rest.schedule.length} class meeting${rest.schedule.length === 1 ? "" : "s"}, ${rest.holds.length} hold${rest.holds.length === 1 ? "" : "s"}`);
  return { sis: { ...rest, history, fetchedAt: ctx.now.toISOString() }, notes };
}
