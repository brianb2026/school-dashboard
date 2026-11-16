import "./load-env.js";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { isLoopback } from "@sd/connectors";
import { buildApp } from "./app.js";
import { loadSchoolConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { macNotifier } from "./notify.js";
import { isProfile, listProfiles, newProfile, profileDir, readActive, vaultAccount, writeActive, type ProfileHost } from "./profiles.js";
import { Vault, fileKey, keychainKey } from "./secrets/vault.js";

const PORT = Number(process.env.PORT ?? 5179);
const HOST = process.env.HOST ?? "127.0.0.1";
// This server holds your school data and saved sign-ins. It only ever listens on this machine.
if (!isLoopback(HOST)) {
  console.error(`Refusing to listen on ${HOST}. The dashboard only runs on 127.0.0.1 so nothing else on the network can reach it.`);
  process.exit(1);
}

const root = resolve(process.env.DATA_DIR ?? "./data");
const cfg = loadSchoolConfig();
let current: { id: string; close: () => Promise<void> } | undefined;
let swapping = false;

const host: ProfileHost = {
  active: () => current?.id ?? readActive(root),
  list: () => listProfiles(root, current?.id ?? readActive(root)),
  create: () => newProfile(root),
  switchTo(id) {
    if (swapping || !isProfile(root, id) || id === current?.id) return;
    swapping = true;
    // A moment later, so the answer to "switch" reaches the page first.
    setTimeout(() => {
      void (async () => {
        try {
          await current?.close();
          await open(id);
        } catch (e) {
          console.error(`Couldn't open that profile: ${(e as Error).message}. Going back.`);
          await open(readActive(root)).catch(() => process.exit(1));
        } finally {
          swapping = false;
        }
      })();
    }, 150);
  },
};

/** Open one profile: its own database, its own encrypted sign-ins, its own sign-in browser. */
async function open(id: string): Promise<void> {
  const dataDir = profileDir(root, id);
  const db = openDb(dataDir);
  const key = process.platform === "darwin" && process.env.VAULT_KEY !== "file" ? keychainKey("school-dashboard", vaultAccount(id)) : fileKey(join(dataDir, ".vault-key"));
  const app = buildApp({
    db,
    cfg,
    secrets: new Vault(join(dataDir, "secrets.enc"), key),
    notifier: macNotifier,
    dataDir,
    webDist: resolve("apps/web/dist"),
    logger: process.env.LOG_REQUESTS === "1",
    profiles: host,
  });
  const stopSync = app.ctx.sync.start();
  await app.listen({ port: PORT, host: HOST });
  writeActive(root, id);
  current = {
    id,
    close: async () => {
      stopSync();
      await app.ctx.linker.cancel().catch(() => undefined);
      await app.close();
      db.close();
    },
  };
}

await open(readActive(root));
const url = `http://127.0.0.1:${PORT}`;
console.log(`School dashboard is running at ${url}  (Ctrl-C to stop)`);
if (process.env.OPEN_BROWSER === "1" && process.platform === "darwin") execFile("/usr/bin/open", [url], () => undefined);
