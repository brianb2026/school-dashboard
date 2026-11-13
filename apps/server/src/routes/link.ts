import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { GMAIL_TOKEN, gmailAuthUrl, gmailConfigured, gmailExchangeCode, normalizeBaseUrl, restAuthUrl, restConfigured, restExchangeCode } from "@sd/connectors";
import type { LinkStatus, LinkTarget } from "@sd/core";
import type { AppContext } from "../app.js";
import { deleteSetting, setSetting } from "../db/client.js";

interface Pending {
  kind: "gmail" | "blackboard";
  verifier?: string;
  expires: number;
}

function page(reply: FastifyReply, title: string, text: string): FastifyReply {
  // Fixed text only; nothing from the request is ever written into this page.
  return reply
    .type("text/html; charset=utf-8")
    .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    .send(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:15vh auto;max-width:30rem;text-align:center;color:#222"><h1 style="font-size:20px">${title}</h1><p>${text}</p></body>`,
    );
}

export function linkRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, sync, linker } = ctx;
  // One-time values for sign-ins in progress (10 minutes, single use).
  const pending = new Map<string, Pending>();
  const begin = (p: Omit<Pending, "expires">): string => {
    for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
    const state = randomBytes(24).toString("base64url");
    pending.set(state, { ...p, expires: Date.now() + 10 * 60_000 });
    return state;
  };
  const take = (state: string | undefined, kind: Pending["kind"]): Pending | undefined => {
    const p = state ? pending.get(state) : undefined;
    if (!p || p.kind !== kind || p.expires < Date.now()) return undefined;
    pending.delete(state!);
    return p;
  };

  /**
   * Link Blackboard. With an official API key in .env this returns a link to
   * the school's approval page; otherwise it opens the sign-in window.
   */
  app.post<{ Body: { baseUrl?: string } }>("/api/link/blackboard", async (req, reply): Promise<LinkStatus | { openUrl: string } | FastifyReply> => {
    if (req.body?.baseUrl !== undefined) {
      const base = normalizeBaseUrl(String(req.body.baseUrl));
      if (!base) return reply.code(400).send({ error: "That doesn't look like a Blackboard address. It usually looks like learn.school.edu." });
      setSetting(db, "BLACKBOARD_BASE_URL", base);
    }
    const env = sync.env();
    if (!normalizeBaseUrl(env.BLACKBOARD_BASE_URL)) return reply.code(400).send({ error: "Enter your school's Blackboard address first." });
    if (restConfigured(env)) return { openUrl: restAuthUrl(env, begin({ kind: "blackboard" })) };
    return linker.start("blackboard");
  });

  app.post("/api/link/gradescope", async () => linker.start("gradescope"));
  app.get("/api/link/status", async () => linker.status());
  app.post("/api/link/cancel", async () => linker.cancel());

  app.delete<{ Params: { target: string } }>("/api/link/:target", async (req, reply) => {
    const t = req.params.target;
    if (t === "gmail") {
      await ctx.secrets.delete(GMAIL_TOKEN);
      deleteSetting(db, "GMAIL_EXPIRED");
      db.prepare("DELETE FROM messages WHERE id LIKE 'gmail:%'").run();
      return { ok: true };
    }
    if (t !== "blackboard" && t !== "gradescope") return reply.code(404).send({ error: "Unknown link." });
    await linker.unlink(t as LinkTarget);
    return { ok: true };
  });

  app.post("/api/link/gmail", async (_req, reply) => {
    const env = sync.env();
    if (!gmailConfigured(env)) {
      return reply.code(400).send({ error: "Gmail needs a one-time setup (a Google client ID in .env). See docs/connectors.md. Writing to professors works without it." });
    }
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { openUrl: gmailAuthUrl(env, begin({ kind: "gmail", verifier }), challenge) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/google/callback", async (req, reply) => {
    const p = take(req.query.state, "gmail");
    if (!p || !req.query.code) return page(reply.code(400), "Gmail was not connected", "That sign-in link is no longer valid. Go back to the dashboard and press Connect Gmail again.");
    try {
      await gmailExchangeCode(sync.context(), req.query.code, p.verifier!);
    } catch {
      return page(reply.code(400), "Gmail was not connected", "Google did not accept the sign-in. Go back to the dashboard and try again.");
    }
    setSetting(db, "GMAIL_EXPIRED", "false");
    void sync.run().catch(() => undefined);
    return page(reply, "Gmail connected", "You can close this tab and go back to the dashboard.");
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/blackboard/callback", async (req, reply) => {
    const p = take(req.query.state, "blackboard");
    if (!p || !req.query.code) return page(reply.code(400), "Blackboard was not linked", "That link is no longer valid. Go back to the dashboard and press Link Blackboard again.");
    try {
      await restExchangeCode(sync.context(), req.query.code);
    } catch {
      return page(reply.code(400), "Blackboard was not linked", "Blackboard did not accept the approval. Go back to the dashboard and try again.");
    }
    setSetting(db, "BLACKBOARD_REST_EXPIRED", "false");
    void sync.runFresh({ deep: true }).catch(() => undefined);
    return page(reply, "Blackboard linked", "You can close this tab and go back to the dashboard.");
  });
}
