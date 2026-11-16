import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  CANVAS_COOKIES,
  CookieJar,
  GRADESCOPE_COOKIES,
  GRADESCOPE_ORIGIN,
  REST_TOKENS,
  SESSION_COOKIES,
  SIS_COOKIES,
  canvasUser,
  gradescopeCourseCount,
  normalizeBaseUrl,
  peopleSoftPath,
  sessionWorks,
  sisWorks,
  sleep,
  type FetchLike,
  type SecretStore,
  type StoredCookie,
} from "@sd/connectors";
import type { LinkStatus, LinkTarget } from "@sd/core";
import { deleteSetting, setSetting, type Db } from "../db/client.js";
import type { Launcher, SignInWindow } from "./chrome.js";

export interface LinkDeps {
  db: Db;
  secrets: SecretStore;
  env: () => NodeJS.ProcessEnv;
  fetch: FetchLike;
  launch: Launcher;
  /** Folder that holds the sign-in browser's own profile. Undefined (tests) = no profile on disk. */
  dataDir?: string;
  /** Called once the sign-in is saved; does the first sync. */
  onLinked: (target: LinkTarget) => Promise<void>;
  /** Blackboard paths that open Gradescope with the Blackboard sign-in, if any are known. */
  gradescopeLaunch?: () => string[];
  /** Refuse to link anything but this address (the demo's pretend Blackboard). */
  onlyBase?: string;
  pollMs?: number;
  timeoutMs?: number;
  /** How long a quiet renewal may take. */
  renewMs?: number;
}

interface Plan {
  url: string;
  host: string;
  secret: string;
  flag: string;
  works: (jar: CookieJar) => Promise<boolean>;
  /** A saved session to hand to the window first (Blackboard's, when opening Gradescope through it). */
  cookies?: StoredCookie[];
  waiting: string;
  /** Shown while waiting when the check says "signed in, but not there yet". */
  hint?: (jar: CookieJar) => Promise<string | undefined>;
  /** Addresses the window shows (never page content): the SIS learns where its pages live from them. */
  learn?: (pages: string[]) => void;
}

/**
 * "Link Blackboard": open the school's real sign-in page in a browser window,
 * wait until you are signed in, keep the session cookies (encrypted), close
 * the window, and sync. Nothing you type in that window is read.
 */
export class Linker {
  private state: LinkStatus = { phase: "idle" };
  private win?: SignInWindow;
  private run = 0;

  constructor(private readonly d: LinkDeps) {}

  status(): LinkStatus {
    return this.state;
  }

  private get profileDir(): string {
    return join(this.d.dataDir ?? ".", "browser-profile");
  }

  private async plan(target: LinkTarget): Promise<Plan> {
    const base = normalizeBaseUrl(this.d.env().BLACKBOARD_BASE_URL);
    if (this.d.onlyBase && (target !== "blackboard" || base !== this.d.onlyBase)) {
      throw new Error(`This is the demo: it only links the pretend Blackboard at ${this.d.onlyBase}. To link your real school, quit the demo and start the real app (double-click start.command).`);
    }
    if (target === "gradescope") {
      const host = new URL(GRADESCOPE_ORIGIN).hostname;
      const common = {
        host,
        secret: GRADESCOPE_COOKIES,
        flag: "GRADESCOPE_SESSION_EXPIRED",
        works: async (jar: CookieJar) => (await gradescopeCourseCount(jar, this.d.fetch)) > 0,
      };
      // Best: open a Gradescope assignment link through Blackboard. That lands in the Gradescope
      // account your classes are in, with no second sign-in.
      const launch = this.d.gradescopeLaunch?.()[0];
      const saved = await this.d.secrets.get(SESSION_COOKIES);
      if (base && launch && saved) {
        return {
          ...common,
          url: `${base}${launch}`,
          cookies: CookieJar.parse(saved).list(),
          waiting: "Opening Gradescope through Blackboard. The window closes by itself.",
        };
      }
      return {
        ...common,
        url: `${GRADESCOPE_ORIGIN}/login`,
        waiting: "Sign in to Gradescope in the window that just opened. It closes by itself when you're in.",
        hint: async (jar) =>
          (await gradescopeCourseCount(jar, this.d.fetch)) === 0
            ? "Signed in, but this Gradescope account has no classes. In that window, open Blackboard and click a Gradescope assignment instead."
            : undefined,
      };
    }
    if (target === "canvas") {
      const cbase = normalizeBaseUrl(this.d.env().CANVAS_BASE_URL);
      if (this.d.onlyBase) throw new Error("This is the demo: it only links its pretend Blackboard. To link Canvas, start the real app (double-click start.command).");
      if (!cbase) throw new Error("Enter your school's Canvas address first (for example canvas.school.edu).");
      return {
        url: `${cbase}/login`,
        host: new URL(cbase).hostname,
        secret: CANVAS_COOKIES,
        flag: "CANVAS_SESSION_EXPIRED",
        works: async (jar) => (await canvasUser(cbase, { jar }, this.d.fetch)) !== undefined,
        waiting: "Sign in to Canvas in the window that just opened. It closes by itself when you're in.",
      };
    }
    if (target === "sis") {
      const sbase = normalizeBaseUrl(this.d.env().SIS_BASE_URL);
      if (this.d.onlyBase) throw new Error("This is the demo: it only links its pretend Blackboard. To link your SIS, start the real app (double-click start.command).");
      if (!sbase) throw new Error("Enter your school's SIS address first.");
      const host = new URL(sbase).hostname;
      let learned = this.d.env().SIS_PS_PATH;
      const start = this.d.env().SIS_START_URL;
      return {
        url: start && start.startsWith(`${sbase}/`) ? start : `${sbase}/`,
        host,
        secret: SIS_COOKIES,
        flag: "SIS_SESSION_EXPIRED",
        learn: (pages) => {
          for (const p of pages) {
            if (new URL(p).hostname !== host) continue;
            const path = peopleSoftPath(p);
            if (path) learned = path;
          }
        },
        works: async (jar) => {
          const path = await sisWorks(sbase, learned, jar, this.d.fetch);
          if (path) setSetting(this.d.db, "SIS_PS_PATH", path);
          return path !== undefined;
        },
        waiting: "Sign in to your SIS in the window that just opened. It closes by itself once your Student Center is open.",
      };
    }
    if (!base) throw new Error("Enter your school's Blackboard address first (for example learn.school.edu).");
    return {
      url: `${base}/`,
      host: new URL(base).hostname,
      secret: SESSION_COOKIES,
      flag: "BLACKBOARD_SESSION_EXPIRED",
      works: (jar) => sessionWorks(base, jar, this.d.fetch),
      waiting: "Sign in in the window that just opened. It closes by itself when you're in.",
    };
  }

  private busy(): boolean {
    return this.state.phase === "opening" || this.state.phase === "waiting" || this.state.phase === "syncing";
  }

  /** Opens the window and returns at once; poll status() for progress. */
  async start(target: LinkTarget): Promise<LinkStatus> {
    if (this.busy()) return this.state;
    let plan: Plan;
    try {
      plan = await this.plan(target);
    } catch (e) {
      return (this.state = { target, phase: "error", message: (e as Error).message });
    }
    const my = ++this.run;
    this.state = { target, phase: "opening", message: "Opening the sign-in window…" };
    try {
      this.win = await this.d.launch({ url: plan.url, profileDir: this.profileDir, cookies: plan.cookies });
    } catch (e) {
      return (this.state = { target, phase: "error", message: (e as Error).message });
    }
    this.state = { target, phase: "waiting", message: plan.waiting };
    void this.wait(my, target, plan);
    return this.state;
  }

  private async wait(my: number, target: LinkTarget, plan: Plan): Promise<void> {
    const win = this.win!;
    const deadline = Date.now() + (this.d.timeoutMs ?? 10 * 60_000);
    try {
      for (;;) {
        if (my !== this.run) return;
        if (Date.now() > deadline) {
          this.state = { target, phase: "error", message: "Waited 10 minutes for the sign-in. Try again when you're ready." };
          return;
        }
        if (!(await win.isOpen().catch(() => false))) {
          this.state = { target, phase: "cancelled", message: "The sign-in window was closed before signing in." };
          return;
        }
        plan.learn?.(await win.pages().catch(() => []));
        const jar = new CookieJar(await win.cookies().catch(() => [])).forHost(plan.host);
        if (await plan.works(jar)) {
          await this.d.secrets.set(plan.secret, jar.serialize());
          setSetting(this.d.db, plan.flag, "false");
          this.state = { target, phase: "syncing", message: "Signed in. Pulling your classes, grades and syllabi…" };
          await win.close().catch(() => undefined);
          this.win = undefined;
          await this.d.onLinked(target);
          this.state = { target, phase: "done", message: "Linked." };
          return;
        }
        const hint = await plan.hint?.(jar).catch(() => undefined);
        if (hint && my === this.run) this.state = { target, phase: "waiting", message: hint };
        await sleep(this.d.pollMs ?? 1500);
      }
    } catch (e) {
      this.state = { target, phase: "error", message: (e as Error).message || "Linking failed" };
    } finally {
      await win.close().catch(() => undefined);
      if (this.win === win) this.win = undefined;
    }
  }

  async cancel(): Promise<LinkStatus> {
    // Once signed in, the first sync runs to the end; only the sign-in wait can be cancelled.
    if (this.state.phase === "syncing") return this.state;
    this.run++;
    await this.win?.close().catch(() => undefined);
    this.win = undefined;
    if (this.state.phase === "opening" || this.state.phase === "waiting") this.state = { target: this.state.target, phase: "cancelled", message: "Cancelled." };
    return this.state;
  }

  /**
   * An expired session can often be renewed without bothering you: the
   * sign-in browser's own profile still remembers the school's single
   * sign-on. Runs with no window; gives up after 25 seconds.
   */
  async renew(target: LinkTarget): Promise<boolean> {
    if (this.busy() || !this.d.dataDir || !existsSync(this.profileDir)) return false;
    let plan: Plan;
    let win: SignInWindow;
    try {
      plan = await this.plan(target);
      // Gradescope renews by being opened through Blackboard again; a bare Gradescope login page can't renew by itself.
      if (target === "gradescope" && !plan.cookies) return false;
      win = await this.d.launch({ url: plan.url, profileDir: this.profileDir, headless: true, cookies: plan.cookies });
    } catch {
      return false;
    }
    try {
      for (const end = Date.now() + (this.d.renewMs ?? 25_000); Date.now() < end; ) {
        plan.learn?.(await win.pages().catch(() => []));
        const jar = new CookieJar(await win.cookies().catch(() => [])).forHost(plan.host);
        if (await plan.works(jar)) {
          await this.d.secrets.set(plan.secret, jar.serialize());
          return true;
        }
        await sleep(this.d.pollMs ?? 1500);
      }
      return false;
    } finally {
      await win.close().catch(() => undefined);
    }
  }

  /** Forget a sign-in. When nothing is linked any more, the sign-in browser's profile is deleted too. */
  async unlink(target: LinkTarget): Promise<void> {
    await this.cancel();
    if (target === "blackboard") {
      await this.d.secrets.delete(SESSION_COOKIES);
      await this.d.secrets.delete(REST_TOKENS);
      deleteSetting(this.d.db, "BLACKBOARD_SESSION_EXPIRED");
      deleteSetting(this.d.db, "BLACKBOARD_REST_EXPIRED");
    } else if (target === "canvas") {
      await this.d.secrets.delete(CANVAS_COOKIES);
      await this.d.secrets.delete("canvas.token");
      deleteSetting(this.d.db, "CANVAS_SESSION_EXPIRED");
    } else if (target === "sis") {
      await this.d.secrets.delete(SIS_COOKIES);
      deleteSetting(this.d.db, "SIS_SESSION_EXPIRED");
      deleteSetting(this.d.db, "SIS_PS_PATH");
      deleteSetting(this.d.db, "SIS_LAST_READ");
      this.d.db.prepare("DELETE FROM sis_record").run();
    } else {
      await this.d.secrets.delete(GRADESCOPE_COOKIES);
      deleteSetting(this.d.db, "GRADESCOPE_SESSION_EXPIRED");
    }
    let left = false;
    for (const k of [SESSION_COOKIES, GRADESCOPE_COOKIES, CANVAS_COOKIES, SIS_COOKIES]) left = left || Boolean(await this.d.secrets.get(k));
    if (!left) this.forgetBrowser();
    this.state = { phase: "idle" };
  }

  forgetBrowser(): void {
    if (this.d.dataDir) rmSync(this.profileDir, { recursive: true, force: true });
  }
}
