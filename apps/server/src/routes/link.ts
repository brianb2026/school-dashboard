import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { CANVAS_TOKEN, SIS_PRESETS, canvasUser, presetLmsFor, GMAIL_TOKEN, gmailAuthUrl, gmailConfigured, gmailExchangeCode, normalizeBaseUrl, restAuthUrl, restConfigured, restExchangeCode } from "@sd/connectors";
import type { LinkStatus, LinkTarget } from "@sd/core";
import type { AppContext } from "../app.js";
import { deleteSetting, saveSync, setSetting } from "../db/client.js";

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

  /** Does a Canvas answer at this address? Canvas's "who are you" says "user authorization required" to a stranger. */
  const canvasAt = async (base: string): Promise<string | undefined> => {
    try {
      const r = await ctx.fetch(`${base}/api/v1/users/self`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      const text = (await r.text()).slice(0, 2000);
      if (!/"unauthenticated"|user authorization required|^while\(1\)/i.test(text)) return undefined;
      return normalizeBaseUrl(new URL(r.url || base).origin) ?? base;
    } catch {
      return undefined;
    }
  };

  /**
   * The real Canvas for an address someone typed: the address itself if
   * Canvas answers there; a known school's Canvas for its information site;
   * else a Canvas the page links to (a "Canvas login" button).
   */
  const resolveCanvas = async (base: string): Promise<string | undefined> => {
    const known = presetLmsFor(base);
    if (known) return known;
    const here = await canvasAt(base);
    if (here) return here;
    try {
      const r = await ctx.fetch(`${base}/`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(8000) });
      const html = (await r.text()).slice(0, 400_000);
      const hosts = new Set<string>();
      for (const m of html.matchAll(/href=["'](https:\/\/[^"'/]+)/gi)) {
        const o = normalizeBaseUrl(m[1]);
        if (o && o !== base && /canvas|instructure/i.test(o)) hosts.add(o);
      }
      for (const o of [...hosts].slice(0, 5)) {
        const found = await canvasAt(o);
        if (found) return found;
      }
    } catch {
      /* page not readable */
    }
    return undefined;
  };

  /** Is this address Blackboard or Canvas? Asked of the site itself, without any sign-in. */
  const detect = async (raw: string): Promise<{ kind: "blackboard" | "canvas" | "unknown"; base?: string }> => {
    const base = normalizeBaseUrl(raw);
    if (!base) return { kind: "unknown" };
    if (/blackboard|\/\/learn\./i.test(base)) return { kind: "blackboard", base };
    const canvasBase = await resolveCanvas(base);
    if (canvasBase) return { kind: "canvas", base: canvasBase };
    try {
      const r = await ctx.fetch(`${base}/learn/api/public/v1/system/version`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (r.ok && /"learn"/.test(await r.text())) return { kind: "blackboard", base };
    } catch {
      /* not reachable that way */
    }
    return { kind: "unknown", base };
  };

  /** Schools set up ahead of time (Canvas or Blackboard address, plus the SIS). */
  app.get("/api/schools", async () => Object.entries(SIS_PRESETS).map(([id, s]) => ({ id, name: s.name, lms: s.lms })));

  /**
   * One button for any school: "Link" with an address (Blackboard or Canvas,
   * found out here) or a preset school. A preset's SIS is linked right after,
   * usually with no second sign-in (the same single sign-on).
   */
  app.post<{ Body: { baseUrl?: string; school?: string } }>("/api/link/auto", async (req, reply) => {
    const preset = req.body?.school ? SIS_PRESETS[req.body.school] : undefined;
    if (req.body?.school && !preset) return reply.code(400).send({ error: "Unknown school." });
    const found = preset ? { kind: preset.lms, base: normalizeBaseUrl(preset.lmsUrl) } : await detect(String(req.body?.baseUrl ?? ""));
    if (!found.base) return reply.code(400).send({ error: "That doesn't look like a school address. It usually looks like learn.school.edu or canvas.school.edu." });
    if (found.kind === "unknown") return reply.code(400).send({ error: "Couldn't tell whether that's Blackboard or Canvas. Check the address (copy it from your browser while you're on your school's course site)." });
    if (preset) {
      setSetting(db, "SIS_BASE_URL", normalizeBaseUrl(preset.sis)!);
      if (preset.sisStart) setSetting(db, "SIS_START_URL", preset.sisStart);
      else deleteSetting(db, "SIS_START_URL");
      setSetting(db, "SCHOOL_PRESET", req.body!.school!);
    }
    if (found.kind === "canvas") {
      setSetting(db, "CANVAS_BASE_URL", found.base);
      return linker.start("canvas");
    }
    setSetting(db, "BLACKBOARD_BASE_URL", found.base);
    const env = sync.env();
    if (restConfigured(env)) return { openUrl: restAuthUrl(env, begin({ kind: "blackboard" })) };
    return linker.start("blackboard");
  });

  app.post<{ Body: { baseUrl?: string } }>("/api/link/canvas", async (req, reply) => {
    if (req.body?.baseUrl !== undefined) {
      const base = normalizeBaseUrl(String(req.body.baseUrl));
      if (!base) return reply.code(400).send({ error: "That doesn't look like a Canvas address. It usually looks like canvas.school.edu." });
      const real = await resolveCanvas(base);
      if (!real) return reply.code(400).send({ error: "Canvas doesn't answer at that address. Copy the address from your browser while you're on your Canvas dashboard." });
      setSetting(db, "CANVAS_BASE_URL", real);
    }
    if (!normalizeBaseUrl(sync.env().CANVAS_BASE_URL)) return reply.code(400).send({ error: "Enter your school's Canvas address first." });
    return linker.start("canvas");
  });

  /**
   * Canvas with a personal access token instead of the sign-in window, for
   * schools that allow it (Canvas → Account → Settings → New access token).
   * You paste it; it is checked once, then kept encrypted on this Mac.
   */
  app.put<{ Body: { baseUrl?: string; token?: string } }>("/api/link/canvas-token", async (req, reply) => {
    const base = normalizeBaseUrl(String(req.body?.baseUrl ?? sync.env().CANVAS_BASE_URL ?? ""));
    const token = String(req.body?.token ?? "").trim();
    if (!base) return reply.code(400).send({ error: "Enter your school's Canvas address first." });
    if (!/^[\w~.-]{20,200}$/.test(token)) return reply.code(400).send({ error: "That doesn't look like a Canvas access token." });
    const me = await canvasUser(base, { token }, ctx.fetch);
    if (!me) return reply.code(400).send({ error: "Canvas didn't accept that token. Make a new one and paste it again." });
    setSetting(db, "CANVAS_BASE_URL", base);
    await ctx.secrets.set(CANVAS_TOKEN, token);
    setSetting(db, "CANVAS_SESSION_EXPIRED", "false");
    if (me.name) setSetting(db, "STUDENT_NAME", me.name);
    void sync.runFresh({ deep: true }).catch(() => undefined);
    return { ok: true };
  });

  app.post<{ Body: { baseUrl?: string } }>("/api/link/sis", async (req, reply) => {
    if (req.body?.baseUrl !== undefined) {
      const base = normalizeBaseUrl(String(req.body.baseUrl));
      if (!base) return reply.code(400).send({ error: "That doesn't look like an SIS address." });
      setSetting(db, "SIS_BASE_URL", base);
      // A school we know the front door of; anything else starts at the address given.
      const preset = Object.values(SIS_PRESETS).find((p) => normalizeBaseUrl(p.sis) === base);
      if (preset?.sisStart) setSetting(db, "SIS_START_URL", preset.sisStart);
      else deleteSetting(db, "SIS_START_URL");
    }
    if (!normalizeBaseUrl(sync.env().SIS_BASE_URL)) return reply.code(400).send({ error: "Enter your school's SIS address first." });
    return linker.start("sis");
  });

  app.post("/api/link/gradescope", async () => {
    deleteSetting(db, "GRADESCOPE_AUTOLINK_OFF");
    return linker.start("gradescope");
  });
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
    if (!["blackboard", "gradescope", "canvas", "sis"].includes(t)) return reply.code(404).send({ error: "Unknown link." });
    await linker.unlink(t as LinkTarget);
    if (t === "gradescope") {
      // What Gradescope added goes with it (your own scores stay), and it is not linked again behind your back.
      saveSync(db, { authoritative: { assignments: ["gs:"] } });
      setSetting(db, "GRADESCOPE_AUTOLINK_OFF", "true");
    } else if (t === "canvas") {
      saveSync(db, { authoritative: { assignments: ["cv:"], announcements: ["cv:ann:"], files: ["cvfile:"] } });
    } else if (t === "sis") {
      setSetting(db, "SIS_AUTOLINK_OFF", "true");
    } else deleteSetting(db, "GRADESCOPE_AUTOLINK_OFF");
    return { ok: true };
  });

  app.post("/api/link/gmail", async (_req, reply) => {
    const env = sync.env();
    if (!gmailConfigured(env)) {
      return reply.code(400).send({ error: "Gmail needs a one-time setup first: open Settings → Gmail and follow the steps there. Writing to professors works without it." });
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
