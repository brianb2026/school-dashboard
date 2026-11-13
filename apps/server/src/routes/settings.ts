import type { FastifyInstance } from "fastify";
import { ALL_CONNECTORS, ICAL_SECRET, type SecretStore } from "@sd/connectors";
import type { ConnectorInfo, SettingsInfo, ToggleKey } from "@sd/core";
import type { SchoolConfig } from "../config.js";
import { setSetting, type Db } from "../db/client.js";
import { connectorContext, effectiveEnv, syncAll } from "../sync/scheduler.js";

/** UI toggle → the env-style key the connector reads. */
const TOGGLES: Record<ToggleKey, string> = {
  blackboardSessionReader: "BLACKBOARD_SESSION_READER_ENABLED",
  gradescopeSessionReader: "GRADESCOPE_SESSION_READER_ENABLED",
};

export function settingsRoutes(app: FastifyInstance, db: Db, cfg: SchoolConfig, secrets: SecretStore, env: NodeJS.ProcessEnv): void {
  async function info(): Promise<SettingsInfo> {
    const e = effectiveEnv(db, env);
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
      toggles: {
        blackboardSessionReader: e[TOGGLES.blackboardSessionReader] === "true",
        gradescopeSessionReader: e[TOGGLES.gradescopeSessionReader] === "true",
      },
      ai: { provider: e.AI_PROVIDER || "none" },
      timezone: cfg.timezone,
      term: cfg.term,
      gpaScale: cfg.gpa.scale,
    };
  }

  app.get("/api/settings", info);

  app.put<{ Body: { url?: string } }>("/api/settings/calendar-link", async (req, reply) => {
    const raw = (req.body?.url ?? "").trim().replace(/^webcal:\/\//i, "https://");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return reply.code(400).send({ error: "That doesn't look like a link. Copy it from Blackboard → Calendar → Share calendar." });
    }
    if (url.protocol !== "https:") return reply.code(400).send({ error: "The calendar link should start with https:// (or webcal://)." });
    await secrets.set(ICAL_SECRET, url.toString());
    return info();
  });

  app.delete("/api/settings/calendar-link", async () => {
    await secrets.delete(ICAL_SECRET);
    return info();
  });

  app.put<{ Body: { key?: ToggleKey; enabled?: boolean; acknowledged?: boolean } }>("/api/settings/toggles", async (req, reply) => {
    const { key, enabled, acknowledged } = req.body ?? {};
    if (!key || !(key in TOGGLES) || typeof enabled !== "boolean") return reply.code(400).send({ error: "Unknown setting." });
    if (enabled && acknowledged !== true) {
      return reply.code(400).send({ error: "Confirm you've read the warning before turning this on." });
    }
    setSetting(db, TOGGLES[key], enabled ? "true" : "false");
    return info();
  });

  app.get("/api/connectors", async (): Promise<ConnectorInfo[]> => {
    const ctx = connectorContext(db, secrets, env);
    return Promise.all(
      ALL_CONNECTORS.map(async (c) => ({
        id: c.id,
        label: c.label,
        capabilities: c.capabilities,
        status: await c.status(ctx).catch((e: Error) => ({ state: "error", detail: e.message })),
      })),
    );
  });

  app.post("/api/sync", async () => syncAll(db, secrets, env));
}
