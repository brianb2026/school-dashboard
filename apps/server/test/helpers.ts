import { readFileSync } from "node:fs";
import type { FetchLike, SecretStore } from "@sd/connectors";
import type { DashboardData, LinkStatus } from "@sd/core";
import { fakeBlackboard, fakeGradescope, type FakeBlackboard } from "../../../packages/connectors/test/fake-blackboard.js";
import { fakeCanvas } from "../../../packages/connectors/test/fake-canvas.js";
import { fakeSis } from "../../../packages/connectors/test/fake-sis.js";
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
  /** The pretend Gradescope (only reachable when `gradescope` is on). */
  gs: ReturnType<typeof fakeGradescope>;
  /** A pretend Canvas and PeopleSoft SIS at UVA's public addresses (so the school preset can be tested). */
  cv: ReturnType<typeof fakeCanvas>;
  sis: ReturnType<typeof fakeSis>;
  /** Sign-in windows opened; `cookies` = names of the cookies handed to the window before it loaded. */
  windows: { url: string; headless?: boolean; closed: boolean; cookies?: string[] }[];
  dashboard(): Promise<DashboardData>;
  /** Press "Link Blackboard" and wait for it to finish. */
  link(body?: object): Promise<LinkStatus>;
}

export interface RigOptions extends Partial<AppDeps> {
  /** "signs-in": the pretend user signs in after a moment. "closes": they close the window. "no-chrome": no browser installed. */
  window?: "signs-in" | "closes" | "no-chrome";
  /** The school opens Gradescope from Blackboard (Project 1 is a link into it). */
  gradescope?: boolean;
}

export function rig(opts: RigOptions = {}): Rig {
  const bb = fakeBlackboard({ gradescope: opts.gradescope });
  const gs = fakeGradescope();
  const cv = fakeCanvas({ base: "https://canvas.its.virginia.edu" });
  const sis = fakeSis({ base: "https://sisuva.admin.virginia.edu", site: "ihprd" });
  const secrets = memorySecrets();
  const pings: Rig["pings"] = [];
  const windows: Rig["windows"] = [];
  const launch: Launcher = async ({ url, headless, cookies }) => {
    if (opts.window === "no-chrome") throw new Error("Google Chrome is needed for the sign-in window. Install Chrome, then try again.");
    const w: Rig["windows"][number] = { url, headless, closed: false, ...(cookies ? { cookies: cookies.map((c) => c.name) } : {}) };
    windows.push(w);
    let polls = 0;
    // A Blackboard link into Gradescope lands in Gradescope only when the window carries the Blackboard sign-in.
    const intoGradescope = url.includes("/blti/launchLink") && (cookies ?? []).some((c) => c.name === "BbRouter");
    const toCanvas = url.startsWith(cv.base);
    const toSis = url.startsWith(sis.base);
    return {
      cookies: async () => {
        if (opts.window === "closes" || ++polls < 2) return [];
        if (toCanvas) {
          cv.state.sessionValid = true;
          return [cv.sessionCookie];
        }
        if (toSis) {
          sis.state.sessionValid = true;
          return [sis.sessionCookie];
        }
        if (url.includes("/blti/launchLink") || url.includes("gradescope.com")) return intoGradescope ? [gs.cookie, bb.sessionCookie] : [];
        bb.state.sessionValid = true; // the pretend user finished signing in
        return [bb.sessionCookie, { name: "unrelated", value: "x", domain: "ads.example", path: "/", secure: false, hostOnly: true }];
      },
      pages: async () => (toSis && polls >= 2 ? [sis.home] : [url]),
      isOpen: async () => !w.closed && opts.window !== "closes",
      close: async () => void (w.closed = true),
    };
  };
  const other: FetchLike | undefined = opts.fetch;
  const fetchImpl: FetchLike = (input, init) => {
    const origin = new URL(String(input)).origin;
    if (origin === bb.base) return bb.fetch(input, init);
    if (origin === cv.base || origin === "https://files.storage.example") return cv.fetch(input, init);
    // UVA's page about Canvas (not Canvas itself): turns automated requests away, like the real one.
    if (origin === "https://canvas.virginia.edu") return Promise.resolve(new Response("<h1>Access denied</h1>", { status: 403, headers: { "content-type": "text/html" } }));
    if (origin === sis.base) return sis.fetch(input, init);
    if (origin === "https://www.gradescope.com" && opts.gradescope) return gs.fetch(input, init);
    return other ? other(input, init) : bb.fetch(input, init);
  };
  const app = buildApp({
    db: openDb(":memory:"),
    cfg,
    secrets,
    env: { BLACKBOARD_REQUEST_GAP_MS: "0", GRADESCOPE_REQUEST_GAP_MS: "0", CANVAS_REQUEST_GAP_MS: "0", SIS_REQUEST_GAP_MS: "0" },
    launch,
    notifier: { notify: async (title, body) => void pings.push({ title, body }) },
    linkPollMs: 5,
    indexFiles: false,
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
  return { app, bb, gs, cv, sis, secrets, pings, windows, dashboard, link };
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
