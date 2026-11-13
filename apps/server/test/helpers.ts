import { readFileSync } from "node:fs";
import type { FetchLike, SecretStore } from "@sd/connectors";
import type { DashboardData, LinkStatus } from "@sd/core";
import { fakeBlackboard, type FakeBlackboard } from "../../../packages/connectors/test/fake-blackboard.js";
import { buildApp, type AppDeps } from "../src/app.js";
import type { SchoolConfig } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import type { Launcher } from "../src/signin/chrome.js";

export const cfg = JSON.parse(readFileSync(new URL("../../../config/school.example.json", import.meta.url), "utf8")) as SchoolConfig;

export function memorySecrets(): SecretStore & { data: Map<string, string>; wipe: () => Promise<void> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    wipe: async () => data.clear(),
  };
}

export interface Rig {
  app: ReturnType<typeof buildApp>;
  bb: FakeBlackboard;
  secrets: ReturnType<typeof memorySecrets>;
  /** Notifications that would have popped up. */
  pings: { title: string; body: string }[];
  /** Sign-in windows opened. */
  windows: { url: string; headless?: boolean; closed: boolean }[];
  dashboard(): Promise<DashboardData>;
  /** Press "Link Blackboard" and wait for it to finish. */
  link(body?: object): Promise<LinkStatus>;
}

export interface RigOptions extends Partial<AppDeps> {
  /** "signs-in": the pretend user signs in after a moment. "closes": they close the window. "no-chrome": no browser installed. */
  window?: "signs-in" | "closes" | "no-chrome";
}

export function rig(opts: RigOptions = {}): Rig {
  const bb = fakeBlackboard();
  const secrets = memorySecrets();
  const pings: Rig["pings"] = [];
  const windows: Rig["windows"] = [];
  const launch: Launcher = async ({ url, headless }) => {
    if (opts.window === "no-chrome") throw new Error("Google Chrome is needed for the sign-in window. Install Chrome, then try again.");
    const w = { url, headless, closed: false };
    windows.push(w);
    let polls = 0;
    return {
      cookies: async () => {
        if (opts.window === "closes" || ++polls < 2) return [];
        bb.state.sessionValid = true; // the pretend user finished signing in
        return [bb.sessionCookie, { name: "unrelated", value: "x", domain: "ads.example", path: "/", secure: false, hostOnly: true }];
      },
      isOpen: async () => !w.closed && opts.window !== "closes",
      close: async () => void (w.closed = true),
    };
  };
  const other: FetchLike | undefined = opts.fetch;
  const fetchImpl: FetchLike = (input, init) => (new URL(String(input)).origin === bb.base || !other ? bb.fetch(input, init) : other(input, init));
  const app = buildApp({
    db: openDb(":memory:"),
    cfg,
    secrets,
    env: { BLACKBOARD_REQUEST_GAP_MS: "0", GRADESCOPE_REQUEST_GAP_MS: "0" },
    launch,
    notifier: { notify: async (title, body) => void pings.push({ title, body }) },
    linkPollMs: 5,
    ...opts,
    fetch: fetchImpl,
  });
  const dashboard = async () => (await app.inject({ url: "/api/dashboard" })).json() as DashboardData;
  const link = async (body: object = { baseUrl: bb.base }) => {
    const res = await app.inject({ method: "POST", url: "/api/link/blackboard", payload: body });
    if (res.statusCode !== 200) throw new Error(res.body);
    return waitFor(async () => {
      const s = (await app.inject({ url: "/api/link/status" })).json() as LinkStatus;
      return s.phase === "done" || s.phase === "error" || s.phase === "cancelled" ? s : undefined;
    });
  };
  return { app, bb, secrets, pings, windows, dashboard, link };
}

export async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
