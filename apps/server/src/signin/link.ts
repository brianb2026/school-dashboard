import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  CookieJar,
  GRADESCOPE_COOKIES,
  GRADESCOPE_ORIGIN,
  REST_TOKENS,
  SESSION_COOKIES,
  gradescopeWorks,
  normalizeBaseUrl,
  sessionWorks,
  sleep,
  type FetchLike,
  type SecretStore,
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

  private plan(target: LinkTarget): Plan {
    if (target === "gradescope") {
      const host = new URL(GRADESCOPE_ORIGIN).hostname;
      return {
        url: `${GRADESCOPE_ORIGIN}/login`,
        host,
        secret: GRADESCOPE_COOKIES,
        flag: "GRADESCOPE_SESSION_EXPIRED",
        works: (jar) => gradescopeWorks(jar, this.d.fetch),
      };
    }
    const base = normalizeBaseUrl(this.d.env().BLACKBOARD_BASE_URL);
    if (!base) throw new Error("Enter your school's Blackboard address first (for example learn.school.edu).");
    return {
      url: `${base}/`,
      host: new URL(base).hostname,
      secret: SESSION_COOKIES,
      flag: "BLACKBOARD_SESSION_EXPIRED",
      works: (jar) => sessionWorks(base, jar, this.d.fetch),
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
      plan = this.plan(target);
    } catch (e) {
      return (this.state = { target, phase: "error", message: (e as Error).message });
    }
    const my = ++this.run;
    this.state = { target, phase: "opening", message: "Opening the sign-in window…" };
    try {
      this.win = await this.d.launch({ url: plan.url, profileDir: this.profileDir });
    } catch (e) {
      return (this.state = { target, phase: "error", message: (e as Error).message });
    }
    this.state = { target, phase: "waiting", message: "Sign in in the window that just opened. It closes by itself when you're in." };
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
      plan = this.plan(target);
      win = await this.d.launch({ url: plan.url, profileDir: this.profileDir, headless: true });
    } catch {
      return false;
    }
    try {
      for (const end = Date.now() + (this.d.renewMs ?? 25_000); Date.now() < end; ) {
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
    } else {
      await this.d.secrets.delete(GRADESCOPE_COOKIES);
      deleteSetting(this.d.db, "GRADESCOPE_SESSION_EXPIRED");
    }
    const left = (await this.d.secrets.get(SESSION_COOKIES)) || (await this.d.secrets.get(GRADESCOPE_COOKIES));
    if (!left) this.forgetBrowser();
    this.state = { phase: "idle" };
  }

  forgetBrowser(): void {
    if (this.d.dataDir) rmSync(this.profileDir, { recursive: true, force: true });
  }
}
