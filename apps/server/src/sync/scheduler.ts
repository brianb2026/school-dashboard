import {
  ALL_CONNECTORS,
  AuthExpiredError,
  GMAIL_TOKEN,
  GRADESCOPE_COOKIES,
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
import { allSettings, deleteSetting, getSetting, listCourses, logSync, rematchUnassigned, saveSync, setSetting, type Db } from "../db/client.js";
import { notifyChanges, type Notifier } from "../notify.js";
import { buildDashboard } from "../routes/dashboard.js";
import { pullSyllabi } from "./syllabi.js";

const DEEP_EVERY_MS = 6 * 60 * 60 * 1000;

/** Setting that records "this connector's sign-in stopped working". */
export const EXPIRED_FLAG: Record<string, string> = {
  "blackboard-session": "BLACKBOARD_SESSION_EXPIRED",
  "blackboard-rest": "BLACKBOARD_REST_EXPIRED",
  gradescope: "GRADESCOPE_SESSION_EXPIRED",
  gmail: "GMAIL_EXPIRED",
};
const RENEWABLE: Record<string, LinkTarget> = { "blackboard-session": "blackboard", gradescope: "gradescope" };

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

export class SyncService {
  private running?: Promise<SyncReport[]>;
  renew?: SyncDeps["renew"];

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
        saveSync(db, result);
        if (result.files?.length) {
          const s = await pullSyllabi(db, cfg, c, this.context(deep), result.files);
          if (s.applied) notes.push(`${s.applied} syllabus${s.applied === 1 ? "" : "es"} read and applied`);
          if (s.review) notes.push(`${s.review} syllabus${s.review === 1 ? "" : "es"} waiting for a quick check`);
          if (s.failed) notes.push(`${s.failed} syllabus file${s.failed === 1 ? "" : "s"} could not be read`);
        }
        if (c.id.startsWith("blackboard-") && c.id !== "blackboard-ical") deepDone = deepDone || deep;
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
    return reports;
  }

  /** Link states for the dashboard (no secrets leave this function, only yes/no). */
  async links(): Promise<DashboardData["links"]> {
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
      },
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

  /** Sync shortly after start, then every `minutes`; check deadlines every 5 minutes. */
  start(minutes = 30): () => void {
    const first = setTimeout(() => void this.run().catch(() => undefined), 3000);
    const sync = setInterval(() => void this.run().catch(() => undefined), minutes * 60_000);
    const due = setInterval(() => void this.notify().catch(() => undefined), 5 * 60_000);
    for (const t of [first, sync, due]) t.unref();
    return () => {
      clearTimeout(first);
      clearInterval(sync);
      clearInterval(due);
    };
  }
}
