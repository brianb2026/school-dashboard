import { decodeEntities, matchCourse, type Assignment, type GradeEntry } from "@sd/core";
import { guessKind } from "../kinds.js";
import { CookieJar, readCapped, sleep } from "../net.js";
import { AuthExpiredError, HttpError, type Connector, type ConnectorContext, type SyncResult } from "../types.js";

/**
 * Gradescope has no student API, so this reads the two pages you see when
 * signed in: your course list and each course's assignment table. Same deal
 * as the Blackboard link: you sign in yourself, only the session cookies are
 * kept, and nothing is ever submitted or changed.
 *
 * The page shapes below come from Gradescope's public HTML class names
 * (courseBox, submissionStatus, submissionTimeChart). If Gradescope changes
 * its pages this reader finds nothing and says so; it cannot corrupt data.
 */
export const GRADESCOPE_COOKIES = "gradescope.session.cookies";
export const GRADESCOPE_ORIGIN = "https://www.gradescope.com";

export interface GsCourse {
  id: string;
  shortName: string;
  name: string;
}

export interface GsAssignment {
  id: string;
  title: string;
  score?: number;
  possible?: number;
  statusText?: string;
  dueAt?: string;
  url?: string;
}

const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Courses from the account page, current term only (the first term block listed). */
export function parseGsCourses(html: string): GsCourse[] {
  const blocks = html.split(/class="courseList--term"/);
  const scope = blocks.length > 1 ? blocks[1]! : html;
  const out: GsCourse[] = [];
  for (const m of scope.matchAll(/<a[^>]*class="courseBox"[^>]*href="\/courses\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const inner = m[2]!;
    const shortName = text(/class="courseBox--shortname"[^>]*>([\s\S]*?)<\/h3>/.exec(inner)?.[1] ?? "");
    const name = text(/class="courseBox--name"[^>]*>([\s\S]*?)<\/div>/.exec(inner)?.[1] ?? "");
    if (shortName || name) out.push({ id: m[1]!, shortName, name });
  }
  return out;
}

/** "2026-09-08 23:59:00 -0400" → ISO. */
function gsDate(v: string | undefined): string | undefined {
  const m = v ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/.exec(v.trim()) : null;
  if (!m) return undefined;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Rows of the student assignment table on a course page. */
export function parseGsAssignments(html: string): GsAssignment[] {
  const table = /<table[^>]*id="assignments-student-table"[\s\S]*?<\/table>/.exec(html)?.[0];
  if (!table) return [];
  const out: GsAssignment[] = [];
  for (const row of table.split(/<tr[\s>]/).slice(1)) {
    const head = /<th[^>]*>([\s\S]*?)<\/th>/.exec(row)?.[1];
    if (!head) continue;
    const title = text(head);
    if (!title || /^name$/i.test(title)) continue;
    const href = /href="(\/courses\/\d+\/assignments\/(\d+)[^"]*)"/.exec(row);
    const btn = /data-assignment-id="(\d+)"/.exec(row);
    const score = /submissionStatus--score"[^>]*>\s*(-?[\d.]+)\s*\/\s*([\d.]+)/.exec(row);
    const statusText = text(/submissionStatus--text"[^>]*>([\s\S]*?)<\/div>/.exec(row)?.[1] ?? "");
    const due = /submissionTimeChart--dueDate"[^>]*datetime="([^"]+)"/.exec(row)?.[1];
    out.push({
      id: href?.[2] ?? btn?.[1] ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
      score: score ? Number(score[1]) : undefined,
      possible: score ? Number(score[2]) : undefined,
      statusText: statusText || undefined,
      dueAt: gsDate(due),
      url: href ? `${GRADESCOPE_ORIGIN}${href[1]}` : undefined,
    });
  }
  return out;
}

async function page(ctx: ConnectorContext, jar: CookieJar, path: string): Promise<string> {
  const url = new URL(path, GRADESCOPE_ORIGIN);
  const res = await ctx.fetch(url, {
    headers: { cookie: jar.header(url), accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  jar.store(url, res.headers.getSetCookie?.() ?? []);
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    throw new AuthExpiredError("Gradescope sign-in expired");
  }
  if (res.status === 401) throw new AuthExpiredError("Gradescope sign-in expired");
  if (!res.ok) throw new HttpError(res.status);
  return new TextDecoder().decode(await readCapped(res, 8 * 1024 * 1024));
}

/** Is this cookie jar signed in to Gradescope? Used while the sign-in window is open. */
export async function gradescopeWorks(jar: CookieJar, fetchImpl: ConnectorContext["fetch"]): Promise<boolean> {
  if (jar.size === 0) return false;
  try {
    const url = new URL("/account", GRADESCOPE_ORIGIN);
    const res = await fetchImpl(url, { headers: { cookie: jar.header(url), accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    await res.body?.cancel().catch(() => undefined);
    return res.status === 200;
  } catch {
    return false;
  }
}

export const gradescope: Connector = {
  id: "gradescope",
  label: "Gradescope",
  capabilities: ["assignments", "grades"],
  async status(ctx) {
    if (!(await ctx.secrets.get(GRADESCOPE_COOKIES))) return { state: "not-configured", detail: "Not linked (scores often reach Blackboard anyway)" };
    if (ctx.env.GRADESCOPE_SESSION_EXPIRED === "true") return { state: "needs-sign-in", detail: "Sign-in expired. Reconnect to keep syncing." };
    return { state: "ready" };
  },
  async sync(ctx): Promise<SyncResult> {
    const jar = CookieJar.parse(await ctx.secrets.get(GRADESCOPE_COOKIES));
    const gap = ctx.env.GRADESCOPE_REQUEST_GAP_MS ? Number(ctx.env.GRADESCOPE_REQUEST_GAP_MS) : 400;
    const assignments: Assignment[] = [];
    const grades: GradeEntry[] = [];
    const prefixes: string[] = [];
    const notes: string[] = [];
    const fetchedAt = ctx.now.toISOString();
    try {
      const courses = parseGsCourses(await page(ctx, jar, "/account"));
      const visible = ctx.knownCourses.filter((c) => !c.hidden);
      let unmatched = 0;
      for (const gc of courses.slice(0, 12)) {
        const courseId = matchCourse(`${gc.shortName} ${gc.name}`, visible);
        if (!courseId) {
          unmatched++;
          continue;
        }
        await sleep(gap);
        const rows = parseGsAssignments(await page(ctx, jar, `/courses/${gc.id}`));
        prefixes.push(`gs:${gc.id}:`);
        for (const r of rows) {
          const id = `gs:${gc.id}:${r.id}`;
          const graded = r.score !== undefined && r.possible !== undefined && r.possible > 0;
          const submitted = graded || /submitted|ungraded/i.test(r.statusText ?? "");
          const late = !submitted && r.dueAt !== undefined && Date.parse(r.dueAt) < ctx.now.getTime();
          const source = { source: "gradescope" as const, externalId: r.id, url: r.url ?? `${GRADESCOPE_ORIGIN}/courses/${gc.id}`, fetchedAt };
          assignments.push({
            id,
            courseId,
            title: r.title,
            kind: guessKind(r.title),
            dueAt: r.dueAt,
            pointsPossible: r.possible,
            status: graded ? "graded" : submitted ? "submitted" : late ? "missing" : "upcoming",
            submittable: false,
            url: source.url,
            attachments: [],
            sources: [source],
          });
          if (graded) grades.push({ assignmentId: id, courseId, score: r.score, pointsPossible: r.possible!, source });
        }
      }
      notes.push(`${courses.length} Gradescope course${courses.length === 1 ? "" : "s"}, ${assignments.length} assignments, ${grades.length} scores`);
      if (unmatched) notes.push(`${unmatched} Gradescope course${unmatched === 1 ? "" : "s"} matched none of your courses (add the course first)`);
      if (courses.length === 0) notes.push("No courses found on the Gradescope page; its layout may have changed");
    } finally {
      if (jar.dirty) await ctx.secrets.set(GRADESCOPE_COOKIES, jar.serialize());
    }
    return { assignments, grades, authoritative: { assignments: prefixes }, notes };
  },
};
