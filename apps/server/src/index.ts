import Fastify from "fastify";
import { loadSchoolConfig } from "./config.js";
import { openDb } from "./db/client.js";
import { registerRoutes } from "./routes/index.js";
import { startScheduler } from "./sync/scheduler.js";

const PORT = Number(process.env.PORT ?? 5179);
// Bind to loopback only. This server holds your school data; it must not be reachable from the network.
const HOST = process.env.HOST ?? "127.0.0.1";

const app = Fastify({ logger: { level: "info" } });
app.addContentTypeParser(
  ["application/pdf", "application/octet-stream", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  { parseAs: "buffer", bodyLimit: 25 * 1024 * 1024 },
  (_req, body, done) => done(null, body),
);

const db = openDb(process.env.DATA_DIR ?? "./data");
registerRoutes(app, db, loadSchoolConfig());
startScheduler(db);

await app.listen({ port: PORT, host: HOST });
