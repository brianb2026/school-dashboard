import { ALL_CONNECTORS, type ConnectorContext } from "@sd/connectors";
import { listCourses, saveSync, type Db } from "../db/client.js";
import { keychain } from "../secrets/keychain.js";

export interface SyncReport {
  connector: string;
  ok: boolean;
  detail?: string;
}

/** Run every configured connector once, in order. Failures are logged, not fatal. */
export async function syncAll(db: Db): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const c of ALL_CONNECTORS) {
    const ctx: ConnectorContext = { env: process.env, secrets: keychain, knownCourses: listCourses(db), now: new Date() };
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
  const log = db.prepare("INSERT INTO sync_log (connector, at, ok, detail) VALUES (?, ?, ?, ?)");
  const at = new Date().toISOString();
  for (const r of reports) log.run(r.connector, at, r.ok ? 1 : 0, r.detail ?? null);
  return reports;
}

/** Background sync every `minutes` (default 30). Polite to school servers. */
export function startScheduler(db: Db, minutes = 30): () => void {
  const t = setInterval(() => void syncAll(db), minutes * 60_000);
  return () => clearInterval(t);
}
