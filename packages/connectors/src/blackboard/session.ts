import type { CourseFile } from "@sd/core";
import { CookieJar, isLoopback } from "../net.js";
import type { Connector, ConnectorContext } from "../types.js";
import { BlackboardClient } from "./client.js";
import { REST_TOKENS } from "./rest.js";
import { downloadBlackboardFile, syncBlackboard } from "./sync.js";

/** Vault key for the session cookies from your own sign-in. */
export const SESSION_COOKIES = "blackboard.session.cookies";

/** "learn.school.edu" / "https://learn.school.edu/ultra/…" → "https://learn.school.edu". Undefined if unusable. */
export function normalizeBaseUrl(input: string | undefined): string | undefined {
  const raw = (input ?? "").trim();
  if (!raw) return undefined;
  let u: URL;
  try {
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(raw);
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${local ? "http" : "https"}://${raw}`);
  } catch {
    return undefined;
  }
  if (u.username || u.password) return undefined;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback(u.hostname))) return undefined;
  if (!u.hostname.includes(".") && !isLoopback(u.hostname)) return undefined;
  return u.origin;
}

export async function openSession(ctx: ConnectorContext): Promise<{ client: BlackboardClient; jar: CookieJar } | undefined> {
  const baseUrl = normalizeBaseUrl(ctx.env.BLACKBOARD_BASE_URL);
  const saved = await ctx.secrets.get(SESSION_COOKIES);
  if (!baseUrl || !saved) return undefined;
  const jar = CookieJar.parse(saved);
  const client = new BlackboardClient({
    baseUrl,
    fetch: ctx.fetch,
    jar,
    minIntervalMs: ctx.env.BLACKBOARD_REQUEST_GAP_MS ? Number(ctx.env.BLACKBOARD_REQUEST_GAP_MS) : undefined,
  });
  return { client, jar };
}

/** Is this cookie jar signed in to Blackboard right now? Used while the sign-in window is open. */
export async function sessionWorks(baseUrl: string, jar: CookieJar, fetchImpl: ConnectorContext["fetch"]): Promise<boolean> {
  if (jar.size === 0) return false;
  try {
    const client = new BlackboardClient({ baseUrl, fetch: fetchImpl, jar, minIntervalMs: 0, timeoutMs: 10_000 });
    const me = await client.json<{ id?: string }>("/learn/api/public/v1/users/me");
    return Boolean(me?.id);
  } catch {
    return false;
  }
}

/**
 * Blackboard through your own sign-in. You sign in yourself in a real browser
 * window (password, SSO, 2FA all happen there); the dashboard keeps only the
 * session cookies, encrypted, and reads the same public REST paths the
 * Blackboard site itself uses. Read-only: it never submits or changes anything.
 */
export const blackboardSession: Connector = {
  id: "blackboard-session",
  label: "Blackboard",
  capabilities: ["courses", "assignments", "grades", "attendance", "announcements", "download"],
  async status(ctx) {
    if (await ctx.secrets.get(REST_TOKENS)) return { state: "not-configured", detail: "Using the official API instead" };
    if (!normalizeBaseUrl(ctx.env.BLACKBOARD_BASE_URL) || !(await ctx.secrets.get(SESSION_COOKIES))) {
      return { state: "not-configured", detail: "Not linked yet" };
    }
    if (ctx.env.BLACKBOARD_SESSION_EXPIRED === "true") return { state: "needs-sign-in", detail: "Sign-in expired. Reconnect to keep syncing." };
    return { state: "ready" };
  },
  async sync(ctx) {
    const s = await openSession(ctx);
    if (!s) return {};
    try {
      return await syncBlackboard(s.client, ctx, "blackboard-session");
    } finally {
      // Blackboard slides the session forward on every response; keep the newest cookies.
      if (s.jar.dirty) await ctx.secrets.set(SESSION_COOKIES, s.jar.serialize());
    }
  },
  async download(ctx, file: CourseFile) {
    const s = await openSession(ctx);
    if (!s) throw new Error("Blackboard is not linked");
    try {
      return await downloadBlackboardFile(s.client, file);
    } finally {
      if (s.jar.dirty) await ctx.secrets.set(SESSION_COOKIES, s.jar.serialize());
    }
  },
};
