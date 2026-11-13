import { buildApp } from "./app.js";
import { loadSchoolConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { keychain } from "./secrets/keychain.js";
import { startScheduler } from "./sync/scheduler.js";

const PORT = Number(process.env.PORT ?? 5179);
// Bind to loopback only. This server holds your school data; it must not be reachable from the network.
const HOST = process.env.HOST ?? "127.0.0.1";

const db = openDb(process.env.DATA_DIR ?? "./data");
const app = buildApp({ db, cfg: loadSchoolConfig(), secrets: keychain, logger: true });
startScheduler(db, keychain);

await app.listen({ port: PORT, host: HOST });
