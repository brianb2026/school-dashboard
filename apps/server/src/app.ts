import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { normalizeBaseUrl, presetLmsFor, SIS_COOKIES, SIS_PRESETS, type FetchLike, type SecretStore } from "@sd/connectors";
import type { SchoolConfig } from "./config.js";
import { deleteSetting, getSetting, setSetting, type Db } from "./db/client.js";
import { silentNotifier, type Notifier } from "./notify.js";
import { registerRoutes } from "./routes/index.js";
import { launchChrome, type Launcher } from "./signin/chrome.js";
import { Linker } from "./signin/link.js";
import type { ProfileHost } from "./profiles.js";
import { indexSome } from "./search/index.js";
import { SyncService, gradescopeLaunch } from "./sync/scheduler.js";

export interface AppDeps {
  db: Db;
  cfg: SchoolConfig;
  secrets: SecretStore & { wipe?: () => Promise<void> };
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  launch?: Launcher;
  notifier?: Notifier;
  /** Where cached files and the sign-in browser profile live. Undefined in tests = nothing on disk. */
  dataDir?: string;
  /** Built web UI to serve (production). Without it only the API is served. */
  webDist?: string;
  logger?: boolean;
  /** How often to check whether the sign-in window is signed in yet (tests use a short value). */
  linkPollMs?: number;
  renewMs?: number;
  /** Read course files into the search index after each sync (tests turn it off). */
  indexFiles?: boolean;
  /** Pause between files while indexing. */
  indexGapMs?: number;
  /** Several profiles on this Mac (index.ts); absent in tests = just this one. */
  profiles?: ProfileHost;
}

/** What every route gets. */
export interface AppContext {
  db: Db;
  cfg: SchoolConfig;
  secrets: AppDeps["secrets"];
  env: NodeJS.ProcessEnv;
  fetch: FetchLike;
  sync: SyncService;
  linker: Linker;
  dataDir?: string;
  profiles?: ProfileHost;
  notifier: Notifier;
}

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
};

/**
 * Fix addresses saved by an earlier version: a school's Canvas information
 * site saved as if it were Canvas, or an SIS front door that wasn't known yet.
 */
function repairSchoolAddresses(db: Db): void {
  const cv = normalizeBaseUrl(getSetting(db, "CANVAS_BASE_URL"));
  const real = cv ? presetLmsFor(cv) : undefined;
  if (real) setSetting(db, "CANVAS_BASE_URL", real);
  const preset = SIS_PRESETS[getSetting(db, "SCHOOL_PRESET") ?? ""];
  if (preset?.sisStart && !getSetting(db, "SIS_START_URL")) setSetting(db, "SIS_START_URL", preset.sisStart);
}

/** Build the API without listening, so tests can call it with app.inject(). */
export function buildApp(deps: AppDeps): FastifyInstance & { ctx: AppContext } {
  const env = deps.env ?? process.env;
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const app = Fastify({
    logger: deps.logger
      ? {
          level: "info",
          // One-time sign-in codes arrive in the query string; never log it.
          serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split("?")[0] }) },
        }
      : false,
    bodyLimit: 1024 * 1024,
  });

  repairSchoolAddresses(deps.db);
  const sync = new SyncService({ db: deps.db, cfg: deps.cfg, secrets: deps.secrets, env, fetch: fetchImpl, notifier: deps.notifier ?? silentNotifier });
  const linker = new Linker({
    db: deps.db,
    secrets: deps.secrets,
    env: () => sync.env(),
    fetch: fetchImpl,
    launch: deps.launch ?? launchChrome,
    dataDir: deps.dataDir,
    pollMs: deps.linkPollMs,
    renewMs: deps.renewMs,
    gradescopeLaunch: () => gradescopeLaunch(deps.db),
    onlyBase: normalizeBaseUrl(env.DEMO_ONLY_BASE),
    onLinked: async (target) => {
      deleteSetting(deps.db, `RENEW_AFTER_${target}`);
      deleteSetting(deps.db, `RENEW_TRIES_${target}`);
      await sync.runFresh({ deep: true });
      if (target === "canvas" || target === "blackboard") wantSis();
    },
  });
  sync.renew = (target) => linker.renew(target);
  // Once Blackboard is in and it has a link into Gradescope, fetch Gradescope too, without being asked.
  // Deferred a moment so a Blackboard link that is just finishing can report "done" first.
  // Tried quietly first (no window at all); a window only opens if that doesn't get in.
  sync.wantGradescope = () => {
    if (env.DEMO_ONLY_BASE) return;
    const t = setTimeout(() => {
      void (async () => {
        if (await linker.renew("gradescope")) {
          setSetting(deps.db, "GRADESCOPE_SESSION_EXPIRED", "false");
          await sync.runFresh();
        } else await linker.start("gradescope");
      })().catch(() => undefined);
    }, deps.linkPollMs ?? 1500);
    t.unref();
  };
  // A school whose SIS is known (a preset) gets it linked right after its Canvas or Blackboard,
  // quietly first: the sign-in browser usually still holds the school's single sign-on.
  const wantSis = () => {
    const e = sync.env();
    if (!normalizeBaseUrl(e.SIS_BASE_URL) || e.SIS_AUTOLINK_OFF === "true") return;
    const t = setTimeout(() => {
      void (async () => {
        if (await deps.secrets.get(SIS_COOKIES)) return;
        if (await linker.renew("sis")) {
          setSetting(deps.db, "SIS_SESSION_EXPIRED", "false");
          await sync.runFresh({ deep: true });
        } else await linker.start("sis");
      })().catch(() => undefined);
    }, deps.linkPollMs ?? 1500);
    t.unref();
  };
  let indexing = false;
  if (deps.indexFiles !== false) {
    sync.afterRun = async () => {
      if (indexing) return;
      indexing = true;
      try {
        await indexSome(ctx, 25, deps.indexGapMs ?? 1500);
      } finally {
        indexing = false;
      }
    };
  }
  const ctx: AppContext = { db: deps.db, cfg: deps.cfg, secrets: deps.secrets, env, fetch: fetchImpl, sync, linker, dataDir: deps.dataDir, profiles: deps.profiles, notifier: deps.notifier ?? silentNotifier };

  // Uploads arrive as raw bytes; the filename travels in ?name=.
  app.addContentTypeParser(
    ["application/pdf", "application/octet-stream", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"],
    { parseAs: "buffer", bodyLimit: 25 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  // Only this machine's own UI may use the API.
  app.addHook("onRequest", async (req, reply) => {
    // Any other host name means DNS rebinding or a misrouted request.
    if (!LOCAL_HOST.test(req.headers.host ?? "")) return reply.code(403).send({ error: "Unexpected host." });
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/")) return;
    const origin = req.headers.origin;
    const own = origin === `http://${req.headers.host}`;
    const dev = env.SD_DEV === "1" && origin !== undefined && LOCAL_ORIGIN.test(origin);
    if (origin && !own && !dev) return reply.code(403).send({ error: "Cross-origin requests are not allowed." });
    // Browsers label requests made by other sites; refuse those even without an Origin header (e.g. <img>, links).
    if (req.headers["sec-fetch-site"] === "cross-site") return reply.code(403).send({ error: "Cross-site requests are not allowed." });
    // Changes must be JSON or a raw upload: a plain HTML form on another site can send neither.
    if (req.method !== "GET" && req.method !== "HEAD") {
      const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      const hasBody = Number(req.headers["content-length"] ?? 0) > 0;
      if (hasBody && (type === "application/x-www-form-urlencoded" || type === "multipart/form-data")) {
        return reply.code(415).send({ error: "Unsupported content type." });
      }
    }
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    if (!reply.hasHeader("x-frame-options")) reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-resource-policy", "same-origin");
    if (!reply.hasHeader("content-security-policy")) reply.header("content-security-policy", CSP);
    if (req.url.startsWith("/api/") || req.url.startsWith("/auth/")) reply.header("cache-control", "no-store");
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) app.log.error(err);
    // Never echo internals (paths, SQL) to the page.
    void reply.code(status).send({ error: status === 500 ? "Something went wrong on the server. Check the terminal for details." : err.message });
  });

  registerRoutes(app, ctx);

  // Production: serve the built UI from the same origin (one address, no dev server).
  const root = deps.webDist ? resolve(deps.webDist) : undefined;
  if (root && existsSync(join(root, "index.html"))) {
    app.get("/*", async (req, reply) => {
      let rel: string;
      try {
        rel = decodeURIComponent(req.url.split("?")[0]!);
      } catch {
        return reply.code(400).send({ error: "Bad address" });
      }
      // Unknown API paths are errors, not the app shell.
      if (rel.startsWith("/api/") || rel.startsWith("/auth/") || rel.includes("\0")) return reply.code(404).send({ error: "Not found" });
      let file = resolve(root, `.${rel}`);
      // Stay inside the build folder, whatever the path says.
      if (file !== root && !file.startsWith(root + sep)) return reply.code(404).send({ error: "Not found" });
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (extname(rel)) return reply.code(404).send({ error: "Not found" });
        file = join(root, "index.html");
      }
      reply.type(TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
      if (file.includes(`${sep}assets${sep}`)) reply.header("cache-control", "public, max-age=31536000, immutable");
      return reply.send(readFileSync(file));
    });
  }

  return Object.assign(app, { ctx });
}
