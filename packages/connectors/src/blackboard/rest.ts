import type { CourseFile } from "@sd/core";
import { readCapped } from "../net.js";
import { AuthExpiredError, type Connector, type ConnectorContext } from "../types.js";
import { BlackboardClient } from "./client.js";
import { downloadBlackboardFile, syncBlackboard } from "./sync.js";

/**
 * Official Blackboard Learn REST API with 3-legged OAuth (you sign in as
 * yourself; the app gets your permissions, nothing more).
 *
 * Needs, before it can work:
 *   1. An app registered at developer.anthology.com (gives an Application ID, key and secret).
 *   2. School IT adding that Application ID under System Admin → REST API Integrations,
 *      with "End User Access" on. A student cannot do this step.
 * With both in .env, "Link Blackboard" uses this path automatically.
 */
export const REST_TOKENS = "blackboard.rest.tokens";

interface Tokens {
  access_token: string;
  refresh_token?: string;
  /** ms since epoch */
  expires_at: number;
}

function base(ctx: Pick<ConnectorContext, "env">): string | undefined {
  const raw = ctx.env.BLACKBOARD_BASE_URL?.trim();
  try {
    return raw ? new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).origin : undefined;
  } catch {
    return undefined;
  }
}

export function restConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.BLACKBOARD_APP_KEY && env.BLACKBOARD_APP_SECRET);
}

function redirectUri(env: NodeJS.ProcessEnv): string {
  return env.BLACKBOARD_REDIRECT_URI || `http://127.0.0.1:${env.PORT || 5179}/auth/blackboard/callback`;
}

/** Where to send the browser to approve read access. */
export function restAuthUrl(env: NodeJS.ProcessEnv, state: string): string {
  const b = base({ env });
  if (!b || !restConfigured(env)) throw new Error("Blackboard API key is not set");
  const u = new URL("/learn/api/public/v1/oauth2/authorizationcode", b);
  u.searchParams.set("redirect_uri", redirectUri(env));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.BLACKBOARD_APP_KEY!);
  u.searchParams.set("scope", "read");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(ctx: ConnectorContext, params: Record<string, string>): Promise<Tokens> {
  const b = base(ctx);
  if (!b) throw new Error("Blackboard address is not set");
  const u = new URL("/learn/api/public/v1/oauth2/token", b);
  const basic = Buffer.from(`${ctx.env.BLACKBOARD_APP_KEY}:${ctx.env.BLACKBOARD_APP_SECRET}`).toString("base64");
  const res = await ctx.fetch(u, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = new TextDecoder().decode(await readCapped(res, 1024 * 1024));
  if (res.status === 400 || res.status === 401) throw new AuthExpiredError("Blackboard refused the sign-in");
  if (!res.ok) throw new Error(`Blackboard token request failed (${res.status})`);
  const t = JSON.parse(body) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!t.access_token) throw new AuthExpiredError("Blackboard returned no access token");
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: ctx.now.getTime() + (t.expires_in ?? 3600) * 1000 };
}

/** Finish the OAuth sign-in: trade the one-time code for tokens and store them. */
export async function restExchangeCode(ctx: ConnectorContext, code: string): Promise<void> {
  const t = await tokenRequest(ctx, { grant_type: "authorization_code", code, redirect_uri: redirectUri(ctx.env) });
  await ctx.secrets.set(REST_TOKENS, JSON.stringify(t));
}

async function client(ctx: ConnectorContext): Promise<BlackboardClient> {
  const b = base(ctx);
  const saved = await ctx.secrets.get(REST_TOKENS);
  if (!b || !saved) throw new AuthExpiredError("Blackboard API is not linked");
  let t = JSON.parse(saved) as Tokens;
  if (t.expires_at - ctx.now.getTime() < 60_000) {
    if (!t.refresh_token) throw new AuthExpiredError();
    const fresh = await tokenRequest(ctx, { grant_type: "refresh_token", refresh_token: t.refresh_token, redirect_uri: redirectUri(ctx.env) });
    t = { ...fresh, refresh_token: fresh.refresh_token ?? t.refresh_token };
    await ctx.secrets.set(REST_TOKENS, JSON.stringify(t));
  }
  return new BlackboardClient({
    baseUrl: b,
    fetch: ctx.fetch,
    bearer: t.access_token,
    minIntervalMs: ctx.env.BLACKBOARD_REQUEST_GAP_MS ? Number(ctx.env.BLACKBOARD_REQUEST_GAP_MS) : undefined,
  });
}

export const blackboardRest: Connector = {
  id: "blackboard-rest",
  label: "Blackboard (official API)",
  capabilities: ["courses", "assignments", "grades", "attendance", "announcements", "download"],
  async status(ctx) {
    if (!restConfigured(ctx.env)) return { state: "not-configured", detail: "Needs an app key and school IT approval" };
    if (!(await ctx.secrets.get(REST_TOKENS))) return { state: "needs-sign-in", detail: "Link Blackboard to approve read access" };
    if (ctx.env.BLACKBOARD_REST_EXPIRED === "true") return { state: "needs-sign-in", detail: "Approval expired. Link again." };
    return { state: "ready" };
  },
  async sync(ctx) {
    return syncBlackboard(await client(ctx), ctx, "blackboard-rest");
  },
  async download(ctx, file: CourseFile) {
    return downloadBlackboardFile(await client(ctx), file);
  },
};
