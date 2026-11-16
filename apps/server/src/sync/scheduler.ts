import {
  ALL_CONNECTORS,
  AuthExpiredError,
  CANVAS_COOKIES,
  CANVAS_TOKEN,
  GMAIL_TOKEN,
  GRADESCOPE_COOKIES,
  SIS_COOKIES,
  ICAL_SECRET,
  REST_TOKENS,
  SESSION_COOKIES,
  gmailConfigured,
  normalizeBaseUrl,
  type Connector,
  type ConnectorContext,
  type FetchLike,
  type SecretStore,
  type SyncResult,
} from "@sd/connectors";
import type { DashboardData, LinkTarget, SyncReport } from "@sd/core";
import type { SchoolConfig } from "../config.js";
import { allSettings, deleteSetting, getSetting, listChanges, listCourses, logSync, markChangeNotified, rematchUnassigned, saveSync, setSetting, type Db } from "../db/client.js";
import { morningBrief, notifyChanges, zoned, type Notifier } from "../notify.js";
import { buildDashboard } from "../routes/dashboard.js";
import { pullSyllabi } from "./syllabi.js";

const DEEP_EVERY_MS = 6 * 60 * 60 * 1000;

/** Setting that records "this connector's sign-in stopped working". */
export const EXPIRED_FLAG: Record<string, string> = {
  "blackboard-session": "BLACKBOARD_SESSION_EXPIRED",
  "blackboard-rest": "BLACKBOARD_REST_EXPIRED",
  gradescope: "GRADESCOPE_SESSION_EXPIRED",
  canvas: "CANVAS_SESSION_EXPIRED",
  sis: "SIS_SESSION_EXPIRED",
  gmail: "GMAIL_EXPIRED",
};
const RENEWABLE: Record<string, LinkTarget> = { "blackboard-session": "blackboard", gradescope: "gradescope", canvas: "canvas", sis: "sis" };

/** Settings saved from the UI override .env, under the same names connectors already read. */
export function effectiveEnv(db: Db, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, ...allSettings(db) };
}

export interface SyncDeps {
  db: Db;
  cfg: SchoolConfig;
  secrets: SecretStore;
  env: NodeJS.ProcessEnv;
  fetch: FetchLike;
  notifier: Notifier;
  /** Quietly renew an expired sign-in from the saved browser profile, if possible. */
  renew?: (target: LinkTarget) => Promise<boolean>;
}

/** Blackboard paths that open Gradescope with the Blackboard sign-in (found during a Blackboard sync). */
export function gradescopeLaunch(db: Db): string[] {
  try {
    const v = JSON.parse(getSetting(db, "GRADESCOPE_LAUNCH") ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.startsWith("/webapps/blackboard/execute/blti/")) : [];
  } catch {
    return [];
  }
}

export class SyncService {
  private running?: Promise<SyncReport[]>;
  renew?: SyncDeps["renew"];
  /** Runs (in the background) after every sync: the file search index catching up. */
  afterRun?: () => Promise<unknown>;
  /** Called after a sync when Gradescope could be opened through Blackboard but isn't linked (or linked to an empty account). */
  wantGradescope?: () => void;

  constructor(private readonly d: SyncDeps) {
    this.renew = d.renew;
  }

  get busy(): boolean {
    return this.running !== undefined;
  }

  env(): NodeJS.ProcessEnv {
    return effectiveEnv(this.d.db, this.d.env);
  }

  context(deep = false): ConnectorContext {
    return {
      env: this.env(),
      secrets: this.d.secrets,
      knownCourses: listCourses(this.d.db),
      now: new Date(),
      fetch: this.d.fetch,
      timezone: this.d.cfg.timezone,
      termName: this.d.cfg.term.name,
      deep,
    };
  }

  /** A fresh sync that starts after any run already in flight (used right after linking). */
  async runFresh(opts: { deep?: boolean; force?: boolean } = {}): Promise<SyncReport[]> {
    if (this.running) await this.running.catch(() => undefined);
    return this.run(opts);
  }

  /**
   * An expired sign-in is retried without a window (the sign-in browser's
   * profile often still knows the school's single sign-on): after 1 h, 2 h,
   * 4 h … up to once a day, or at once when you press Sync now.
   */
  private async quietRenew(connectorId: string, force: boolean): Promise<boolean> {
    const target = RENEWABLE[connectorId];
    if (!target || !this.renew) return false;
    const { db } = this.d;
    const after = `RENEW_AFTER_${target}`;
    const tries = `RENEW_TRIES_${target}`;
    if (!force && Date.now() < Number(getSetting(db, after) ?? 0)) return false;
    const ok = await this.renew(target).catch(() => false);
    if (ok) {
      deleteSetting(db, after);
      deleteSetting(db, tries);
      setSetting(db, EXPIRED_FLAG[connectorId]!, "false");
    } else {
      const n = Number(getSetting(db, tries) ?? 0) + 1;
      setSetting(db, tries, String(n));
      setSetting(db, after, String(Date.now() + Math.min(24, 2 ** (n - 1)) * 3_600_000));
    }
    return ok;
  }

  /** One sync at a time; a second caller gets the run already in flight. */
  run(opts: { deep?: boolean; force?: boolean } = {}): Promise<SyncReport[]> {
    if (!this.running) {
      this.running = this.doRun(opts).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  private async syncOne(c: Connector, deep: boolean): Promise<{ result?: SyncResult; error?: string; expired?: boolean }> {
    try {
      return { result: await c.sync(this.context(deep)) };
    } catch (e) {
      if (!(e instanceof AuthExpiredError)) return { error: (e as Error).message || "Sync failed" };
      if (await this.quietRenew(c.id, true)) {
        try {
          return { result: await c.sync(this.context(deep)) };
        } catch (again) {
          if (!(again instanceof AuthExpiredError)) return { error: (again as Error).message || "Sync failed" };
        }
      }
      return { expired: true, error: "Sign-in expired" };
    }
  }

  private async doRun(opts: { deep?: boolean; force?: boolean }): Promise<SyncReport[]> {
    const { db, cfg } = this.d;
    const reports: SyncReport[] = [];
    const lastDeep = Number(getSetting(db, "LAST_DEEP_SYNC") ?? 0);
    const deep = opts.deep ?? Date.now() - lastDeep > DEEP_EVERY_MS;
    let deepDone = false;

    for (const c of ALL_CONNECTORS) {
      const check = () => c.status(this.context(deep)).catch((e: Error) => ({ state: "error" as const, detail: e.message }));
      let status = await check();
      if (status.state === "needs-sign-in" && (await this.quietRenew(c.id, opts.force === true))) status = await check();
      if (status.state !== "ready") {
        reports.push({ connector: c.id, ok: false, detail: status.detail ?? status.state });
        continue;
      }
      const { result, error, expired } = await this.syncOne(c, deep);
      const flag = EXPIRED_FLAG[c.id];
      if (!result) {
        if (expired && flag) setSetting(db, flag, "true");
        reports.push({ connector: c.id, ok: false, detail: error });
        logSync(db, c.id, false, error);
        continue;
      }
      if (flag && getSetting(db, flag) === "true") setSetting(db, flag, "false");
      const notes = [...(result.notes ?? [])];
      try {
        // A source's first sync is the baseline; after that, what's new or moved is noted for "What changed".
        const baseline = `CHANGES_BASE_${c.id}`;
        saveSync(db, result, { record: getSetting(db, baseline) === "1" });
        setSetting(db, baseline, "1");
        if (result.extras?.studentName) setSetting(db, "STUDENT_NAME", result.extras.studentName.slice(0, 60));
        if (result.sis) setSetting(db, "SIS_LAST_READ", result.sis.fetchedAt);
        if (result.extras?.gradescopeLaunch) setSetting(db, "GRADESCOPE_LAUNCH", JSON.stringify(result.extras.gradescopeLaunch.slice(0, 6)));
        if (result.files?.length) {
          const s = await pullSyllabi(db, cfg, c, this.context(deep), result.files);
          if (s.applied) notes.push(`${s.applied} syllabus${s.applied === 1 ? "" : "es"} read: grading weights applied`);
          if (s.dated) notes.push(`${s.dated} schedule page${s.dated === 1 ? "" : "s"} read: dates and readings added`);
          if (s.review) notes.push(`${s.review} syllabus${s.review === 1 ? "" : "es"} waiting for a quick check`);
          if (s.failed) notes.push(`${s.failed} syllabus file${s.failed === 1 ? "" : "s"} could not be read`);
        }
        if ((c.id.startsWith("blackboard-") && c.id !== "blackboard-ical") || c.id === "canvas") deepDone = deepDone || deep;
        reports.push({ connector: c.id, ok: true, notes });
        logSync(db, c.id, true, undefined, notes);
      } catch (e) {
        const detail = (e as Error).message || "Could not save";
        reports.push({ connector: c.id, ok: false, detail });
        logSync(db, c.id, false, detail);
      }
    }

    rematchUnassigned(db);
    if (deepDone) setSetting(db, "LAST_DEEP_SYNC", String(Date.now()));
    await this.notify().catch(() => undefined);
    await this.notifyMoved().catch(() => undefined);
    void this.afterRun?.().catch(() => undefined);

    // Gradescope hangs off Blackboard at many schools: if Blackboard synced and a link into
    // Gradescope exists, but Gradescope isn't linked (or the saved sign-in sees no classes), go get it.
    const bbOk = reports.some((r) => r.ok && (r.connector === "blackboard-session" || r.connector === "blackboard-rest"));
    const gs = reports.find((r) => r.connector === "gradescope");
    const gsEmpty = gs?.ok === true && (gs.notes ?? []).some((n) => /has no classes/.test(n));
    if (bbOk && gradescopeLaunch(db).length && (!gs?.ok || gsEmpty) && getSetting(db, "GRADESCOPE_AUTOLINK_OFF") !== "true") {
      const last = Number(getSetting(db, "GRADESCOPE_AUTOLINK_AT") ?? 0);
      if (opts.force || Date.now() - last > 12 * 3_600_000) {
        setSetting(db, "GRADESCOPE_AUTOLINK_AT", String(Date.now()));
        this.wantGradescope?.();
      }
    }
    return reports;
  }

  /** Link states for the dashboard (no secrets leave this function, only yes/no). */
  async links(): Promise<DashboardData["links"]> {
    const out = await this.baseLinks();
    const { secrets } = this.d;
    const env = this.env();
    const token = Boolean(await secrets.get(CANVAS_TOKEN));
    const cookies = Boolean(await secrets.get(CANVAS_COOKIES));
    out.canvas = {
      ...out.canvas,
      linked: Boolean(out.canvas.host) && (token || cookies),
      expired: !token && cookies && env.CANVAS_SESSION_EXPIRED === "true",
      via: token ? "token" : cookies ? "session" : undefined,
    };
    out.sis = { ...out.sis, linked: Boolean(out.sis.host) && Boolean(await secrets.get(SIS_COOKIES)) };
    return out;
  }

  private async baseLinks(): Promise<DashboardData["links"]> {
    const env = this.env();
    const { secrets } = this.d;
    const base = normalizeBaseUrl(env.BLACKBOARD_BASE_URL);
    const viaApi = Boolean(await secrets.get(REST_TOKENS));
    const viaSession = Boolean(await secrets.get(SESSION_COOKIES));
    return {
      blackboard: {
        linked: Boolean(base) && (viaApi || viaSession),
        expired: viaApi ? env.BLACKBOARD_REST_EXPIRED === "true" : viaSession && env.BLACKBOARD_SESSION_EXPIRED === "true",
        host: base ? new URL(base).host : undefined,
        via: viaApi ? "api" : viaSession ? "session" : undefined,
      },
      gradescope: {
        linked: Boolean(await secrets.get(GRADESCOPE_COOKIES)),
        expired: env.GRADESCOPE_SESSION_EXPIRED === "true",
        host: "gradescope.com",
        viaBlackboard: gradescopeLaunch(this.d.db).length > 0,
      },
      canvas: (() => {
        const base = normalizeBaseUrl(env.CANVAS_BASE_URL);
        return { linked: false, expired: false, host: base ? new URL(base).host : undefined };
      })(),
      sis: (() => {
        const base = normalizeBaseUrl(env.SIS_BASE_URL);
        return { linked: false, expired: env.SIS_SESSION_EXPIRED === "true", host: base ? new URL(base).host : undefined, home: base };
      })(),
      gmail: { connected: Boolean(await secrets.get(GMAIL_TOKEN)) && env.GMAIL_EXPIRED !== "true", configured: gmailConfigured(env) },
      calendar: { set: Boolean((await secrets.get(ICAL_SECRET)) || env.BLACKBOARD_ICAL_URL) },
    };
  }

  async dashboard(): Promise<DashboardData> {
    const env = this.env();
    return buildDashboard(this.d.db, this.d.cfg, {
      links: await this.links(),
      syncing: this.busy,
      ai: { provider: env.AI_PROVIDER || "none" },
      notifications: env.NOTIFICATIONS_ENABLED !== "false",
    });
  }

  /** Grade-posted, new-announcement and due-soon pings. Also runs between syncs for deadlines. */
  async notify(): Promise<number> {
    const d = await this.dashboard();
    return notifyChanges(this.d.db, d, this.d.cfg.notifications.dueSoonHours, this.d.notifier, d.notifications);
  }

  /** A deadline the school moved gets its own ping (once). */
  async notifyMoved(): Promise<number> {
    const { db, cfg, notifier } = this.d;
    if (this.env().NOTIFICATIONS_ENABLED === "false") return 0;
    const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: cfg.timezone });
    const code = new Map(listCourses(db).map((c) => [c.id, c.code]));
    let n = 0;
    for (const ch of listChanges(db, 3)) {
      if (ch.kind !== "due-moved" || ch.notified || !ch.data.to) continue;
      markChangeNotified(db, ch.id);
      await notifier.notify(`Deadline moved · ${code.get(ch.courseId ?? "") ?? "class"}`, `${ch.data.title ?? "An assignment"}: now due ${fmt.format(new Date(ch.data.to))}`);
      n++;
    }
    return n;
  }

  /**
   * The morning brief, once a day at the time you chose (8:00 unless you
   * changed it or turned it off). If the Mac was asleep then, it comes when
   * it wakes, as long as that's before 6 PM. Data is refreshed first.
   */
  async maybeBrief(now = new Date()): Promise<boolean> {
    const { db, cfg, notifier } = this.d;
    const env = this.env();
    const at = env.MORNING_BRIEF ?? "08:00";
    if (at === "off" || env.NOTIFICATIONS_ENABLED === "false" || !/^\d{2}:\d{2}$/.test(at)) return false;
    const t = zoned(now, cfg.timezone);
    if (t.hhmm < at || t.hhmm >= "18:00" || getSetting(db, "BRIEF_SENT") === t.day) return false;
    setSetting(db, "BRIEF_SENT", t.day);
    if (!this.busy) await this.run().catch(() => undefined);
    const b = morningBrief(await this.dashboard(), cfg.timezone, now, getSetting(db, "BRIEF_AT"));
    setSetting(db, "BRIEF_AT", now.toISOString());
    await notifier.notify(b.title, b.body);
    return true;
  }

  /** Sync shortly after start, then every `minutes`; check deadlines every 5 minutes, the brief every minute. */
  start(minutes = 30): () => void {
    const first = setTimeout(() => void this.run().catch(() => undefined), 3000);
    const sync = setInterval(() => void this.run().catch(() => undefined), minutes * 60_000);
    const due = setInterval(() => void this.notify().catch(() => undefined), 5 * 60_000);
    const brief = setInterval(() => void this.maybeBrief().catch(() => undefined), 60_000);
    for (const t of [first, sync, due, brief]) t.unref();
    return () => {
      clearTimeout(first);
      clearInterval(sync);
      clearInterval(due);
      clearInterval(brief);
    };
  }
}
