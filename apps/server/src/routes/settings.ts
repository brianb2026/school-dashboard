import { rmSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { ALL_CONNECTORS, GMAIL_CLIENT_SECRET, ICAL_SECRET, isLoopback, normalizeBaseUrl } from "@sd/connectors";
import type { ConnectorInfo, SettingsInfo } from "@sd/core";
import type { AppContext } from "../app.js";
import { getSetting, lastSync, setSetting, wipeAll } from "../db/client.js";
import { morningBrief } from "../notify.js";
import { findChrome } from "../signin/chrome.js";

export function settingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, cfg, secrets, sync } = ctx;

  async function info(): Promise<SettingsInfo> {
    const e = sync.env();
    const stored = await secrets.get(ICAL_SECRET);
    const link = stored || e.BLACKBOARD_ICAL_URL;
    let host: string | undefined;
    try {
      host = link ? new URL(link).host : undefined;
    } catch {
      host = undefined;
    }
    return {
      // Never send the link itself back: it's a bearer link. Host only.
      calendarLink: { set: Boolean(link), host, fromEnv: !stored && Boolean(e.BLACKBOARD_ICAL_URL) },
      blackboardUrl: normalizeBaseUrl(e.BLACKBOARD_BASE_URL),
      ai: { provider: e.AI_PROVIDER || "none" },
      timezone: cfg.timezone,
      term: cfg.term,
      gpaScale: cfg.gpa.scale,
      notifications: e.NOTIFICATIONS_ENABLED !== "false",
      chromeFound: Boolean(findChrome(e)),
      demo: Boolean(e.DEMO_ONLY_BASE),
      gmailRedirectUri: e.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${e.PORT || 5179}/auth/google/callback`,
    };
  }

  app.get("/api/settings", info);

  app.put<{ Body: { url?: string } }>("/api/settings/calendar-link", async (req, reply) => {
    const raw = String(req.body?.url ?? "").trim().replace(/^webcal:\/\//i, "https://");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return reply.code(400).send({ error: "That doesn't look like a link. Copy it from Blackboard → Calendar → Share calendar." });
    }
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) || url.username || url.password) {
      return reply.code(400).send({ error: "The calendar link should start with https:// (or webcal://)." });
    }
    await secrets.set(ICAL_SECRET, url.toString());
    return info();
  });

  app.delete("/api/settings/calendar-link", async () => {
    await secrets.delete(ICAL_SECRET);
    return info();
  });

  /** The morning brief: what it would say right now, its time ("08:00", or "off"), and a test send. */
  app.get("/api/brief", async () => {
    const env = sync.env();
    const b = morningBrief(await sync.dashboard(), ctx.cfg.timezone, new Date(), getSetting(db, "BRIEF_AT"));
    return { time: env.MORNING_BRIEF ?? "08:00", ...b };
  });
  app.put<{ Body: { time?: string } }>("/api/brief", async (req, reply) => {
    const t = String(req.body?.time ?? "");
    if (t !== "off" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return reply.code(400).send({ error: "Pick a time like 08:00, or turn it off." });
    setSetting(db, "MORNING_BRIEF", t);
    return { ok: true };
  });
  app.post("/api/brief/send", async () => {
    const b = morningBrief(await sync.dashboard(), ctx.cfg.timezone, new Date(), getSetting(db, "BRIEF_AT"));
    await ctx.notifier.notify(b.title, b.body);
    return { ok: true };
  });

  app.put<{ Body: { enabled?: boolean } }>("/api/settings/notifications", async (req, reply) => {
    if (typeof req.body?.enabled !== "boolean") return reply.code(400).send({ error: "Unknown setting." });
    setSetting(db, "NOTIFICATIONS_ENABLED", req.body.enabled ? "true" : "false");
    return info();
  });

  /**
   * The one-time Google setup, done from Settings instead of a config file.
   * (For a "Desktop app" OAuth client Google does not treat the client secret
   * as confidential; the sign-in itself still happens on Google's page.)
   */
  app.put<{ Body: { clientId?: string; clientSecret?: string } }>("/api/settings/gmail", async (req, reply) => {
    if (sync.env().DEMO_ONLY_BASE) return reply.code(400).send({ error: "This is the demo. Start the real app to connect Gmail." });
    const id = String(req.body?.clientId ?? "").trim();
    const secret = String(req.body?.clientSecret ?? "").trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) return reply.code(400).send({ error: "The client ID should end with .apps.googleusercontent.com" });
    if (secret.length < 10 || secret.length > 200 || /\s/.test(secret)) return reply.code(400).send({ error: "That client secret doesn't look right." });
    await secrets.set(GMAIL_CLIENT_SECRET, secret);
    setSetting(db, "GOOGLE_CLIENT_ID", id);
    setSetting(db, "GOOGLE_CLIENT_SECRET_SAVED", "true");
    return info();
  });

  app.get("/api/connectors", async (): Promise<ConnectorInfo[]> => {
    const c = sync.context();
    return Promise.all(
      ALL_CONNECTORS.map(async (x) => {
        const last = lastSync(db, x.id);
        return {
          id: x.id,
          label: x.label,
          capabilities: x.capabilities,
          status: { ...(await x.status(c).catch((e: Error) => ({ state: "error", detail: e.message }))), lastSyncAt: last?.ok ? last.at : undefined },
          notes: last?.ok ? last.notes : last?.detail ? [last.detail] : undefined,
        };
      }),
    );
  });

  /** "Sync now" also refreshes the slow things (files, people, letter scale). */
  app.post<{ Body: { deep?: boolean } }>("/api/sync", async (req) => sync.run({ deep: req.body?.deep !== false, force: true }));

  /** Delete everything: school data, saved sign-ins, cached files, the sign-in browser profile. */
  app.post<{ Body: { confirm?: string } }>("/api/wipe", async (req, reply) => {
    if (req.body?.confirm !== "WIPE") return reply.code(400).send({ error: 'Type WIPE to confirm.' });
    await ctx.linker.cancel();
    wipeAll(db);
    await secrets.wipe?.();
    ctx.linker.forgetBrowser();
    if (ctx.dataDir) rmSync(join(ctx.dataDir, "files"), { recursive: true, force: true });
    return { ok: true };
  });
}
