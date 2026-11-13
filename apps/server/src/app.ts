import Fastify, { type FastifyInstance } from "fastify";
import type { SecretStore } from "@sd/connectors";
import type { SchoolConfig } from "./config.js";
import type { Db } from "./db/client.js";
import { registerRoutes } from "./routes/index.js";

export interface AppDeps {
  db: Db;
  cfg: SchoolConfig;
  secrets: SecretStore;
  env?: NodeJS.ProcessEnv;
  logger?: boolean;
}

/** Build the API without listening, so tests can call it with app.inject(). */
export function buildApp({ db, cfg, secrets, env = process.env, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: logger ? { level: "info" } : false });
  // Uploads arrive as raw bytes; the filename travels in ?name=.
  app.addContentTypeParser(
    ["application/pdf", "application/octet-stream", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    { parseAs: "buffer", bodyLimit: 25 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );
  // Only the local UI may call this API: reject requests from other web pages,
  // and requests for any other host name (DNS-rebinding protection).
  app.addHook("onRequest", async (req, reply) => {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) {
      return reply.code(403).send({ error: "Unexpected host." });
    }
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
      return reply.code(403).send({ error: "Cross-origin requests are not allowed." });
    }
  });
  registerRoutes(app, db, cfg, secrets, env);
  return app;
}
