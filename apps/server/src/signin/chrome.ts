import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { Readable, Writable } from "node:stream";
import type { StoredCookie } from "@sd/connectors";

/**
 * The sign-in window: a real Chrome window, started with its own profile
 * folder, showing the school's real sign-in page. You type your password and
 * do 2FA there; this code never sees keystrokes or page content. The only
 * thing it asks the browser for is the cookie list, so it can tell when you
 * are signed in and keep that session.
 *
 * It talks to Chrome over a private pipe (--remote-debugging-pipe), not a
 * network port, so no other program on the machine can attach to the window.
 */
export interface SignInWindow {
  cookies(): Promise<StoredCookie[]>;
  /** False once you close the window. */
  isOpen(): Promise<boolean>;
  close(): Promise<void>;
}

export type Launcher = (opts: { url: string; profileDir: string; headless?: boolean }) => Promise<SignInWindow>;

export function findChrome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = homedir();
  const candidates = [
    env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    env.PROGRAMFILES ? `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
    env["PROGRAMFILES(X86)"] ? `${env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
    env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
  ];
  return candidates.find((p): p is string => Boolean(p) && existsSync(p!));
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** Chrome DevTools Protocol over the browser's fd 3/4 pipe: JSON messages separated by a zero byte. */
class CdpPipe {
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private buf: Buffer = Buffer.alloc(0);
  closed = false;

  constructor(private child: ChildProcess) {
    const out = child.stdio[4] as Readable;
    out.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      for (let i = this.buf.indexOf(0); i >= 0; i = this.buf.indexOf(0)) {
        const raw = this.buf.subarray(0, i).toString("utf8");
        this.buf = this.buf.subarray(i + 1);
        try {
          const msg = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } };
          const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
          if (!p) continue;
          this.pending.delete(msg.id!);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message ?? "browser error"));
          else p.resolve(msg.result);
        } catch {
          /* not JSON: ignore */
        }
      }
    });
    const end = () => {
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("The browser closed."));
      }
      this.pending.clear();
    };
    child.on("exit", end);
    child.on("error", end);
    out.on("error", end);
    (child.stdio[3] as Writable).on("error", end);
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The browser closed."));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The browser did not answer."));
      }, 10_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      (this.child.stdio[3] as Writable).write(`${JSON.stringify({ id, method, params })}\0`);
    });
  }
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
}

export const launchChrome: Launcher = async ({ url, profileDir, headless }) => {
  const exe = findChrome();
  if (!exe) throw new Error("Google Chrome is needed for the sign-in window. Install Chrome, then try again.");
  if (!/^https?:\/\//.test(url)) throw new Error("Bad sign-in address");
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const args = [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-pipe",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--window-size=980,820",
  ];
  if (headless) args.push("--headless=new", url);
  else args.push(`--app=${url}`);
  const child = spawn(exe, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const cdp = new CdpPipe(child);
  // Fail fast if the browser never comes up.
  await cdp.send("Browser.getVersion");

  return {
    async cookies() {
      const r = await cdp.send<{ cookies: CdpCookie[] }>("Storage.getCookies");
      return r.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain.replace(/^\./, ""),
        path: c.path || "/",
        secure: c.secure,
        hostOnly: !c.domain.startsWith("."),
        expires: c.expires > 0 ? Math.floor(c.expires) : undefined,
      }));
    },
    async isOpen() {
      if (cdp.closed) return false;
      const r = await cdp.send<{ targetInfos: { type: string }[] }>("Target.getTargets");
      return r.targetInfos.some((t) => t.type === "page");
    },
    async close() {
      if (!cdp.closed) await cdp.send("Browser.close").catch(() => undefined);
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || cdp.closed) return resolve();
        const t = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 4000);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
};
