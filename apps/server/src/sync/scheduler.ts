import { ALL_CONNECTORS, type ConnectorContext, type SecretStore } from "@sd/connectors";
import type { SyncReport } from "@sd/core";
import { allSettings, listCourses, rematchUnassigned, saveSync, type Db } from "../db/client.js";

/** Settings saved from the UI override .env, under the same names connectors already read. */
export function effectiveEnv(db: Db, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, ...allSettings(db) };
}

export function connectorContext(db: Db, secrets: SecretStore, env?: NodeJS.ProcessEnv): ConnectorContext {
  return { env: effectiveEnv(db, env), secrets, knownCourses: listCourses(db), now: new Date() };
}

/** Run every configured connector once, in order. Failures are logged, not fatal. */
export async function syncAll(db: Db, secrets: SecretStore, env?: NodeJS.ProcessEnv): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const c of ALL_CONNECTORS) {
    const ctx = connectorContext(db, secrets, env);
    const status = await c.status(ctx).catch((e: Error) => ({ state: "error" as const, detail: e.message }));
    if (status.state !== "ready") {
      reports.push({ connector: c.id, ok: false, detail: status.detail ?? status.state });
      continue;
    }
    try {
      saveSync(db, await c.sync(ctx));
      reports.push({ connector: c.id, ok: true });
    } catch (e) {
      reports.push({ connector: c.id, ok: false, detail: (e as Error).message });
    }
  }
  rematchUnassigned(db);
  const log = db.prepare("INSERT INTO sync_log (connector, at, ok, detail) VALUES (?, ?, ?, ?)");
  const at = new Date().toISOString();
  for (const r of reports) log.run(r.connector, at, r.ok ? 1 : 0, r.detail ?? null);
  return reports;
}

/** Background sync every `minutes` (default 30). Polite to school servers. */
export function startScheduler(db: Db, secrets: SecretStore, minutes = 30): () => void {
  const t = setInterval(() => void syncAll(db, secrets), minutes * 60_000);
  return () => clearInterval(t);
}
