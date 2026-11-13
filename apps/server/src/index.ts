import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { isLoopback } from "@sd/connectors";
import { buildApp } from "./app.js";
import { loadSchoolConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { macNotifier } from "./notify.js";
import { Vault, fileKey, keychainKey } from "./secrets/vault.js";

const PORT = Number(process.env.PORT ?? 5179);
const HOST = process.env.HOST ?? "127.0.0.1";
// This server holds your school data and saved sign-ins. It only ever listens on this machine.
if (!isLoopback(HOST)) {
  console.error(`Refusing to listen on ${HOST}. The dashboard only runs on 127.0.0.1 so nothing else on the network can reach it.`);
  process.exit(1);
}

const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const db = openDb(dataDir);
const secrets = new Vault(join(dataDir, "secrets.enc"), process.platform === "darwin" && process.env.VAULT_KEY !== "file" ? keychainKey() : fileKey(join(dataDir, ".vault-key")));
const app = buildApp({
  db,
  cfg: loadSchoolConfig(),
  secrets,
  notifier: macNotifier,
  dataDir,
  webDist: resolve("apps/web/dist"),
  logger: process.env.LOG_REQUESTS === "1",
});
app.ctx.sync.start();

await app.listen({ port: PORT, host: HOST });
const url = `http://127.0.0.1:${PORT}`;
console.log(`School dashboard is running at ${url}  (Ctrl-C to stop)`);
if (process.env.OPEN_BROWSER === "1" && process.platform === "darwin") execFile("/usr/bin/open", [url], () => undefined);
