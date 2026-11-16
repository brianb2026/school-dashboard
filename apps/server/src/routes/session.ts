import type { FastifyInstance } from "fastify";
import { CANVAS_COOKIES, CANVAS_TOKEN, CookieJar, normalizeBaseUrl, REST_TOKENS, SESSION_COOKIES, canvasUser, sessionUser } from "@sd/connectors";
import type { LinkTarget, SessionInfo, SignInResult } from "@sd/core";
import type { AppContext } from "../app.js";
import { getSetting, listCourses, setSetting } from "../db/client.js";

/**
 * The sign-in screen. Your school sign-in (Blackboard or Canvas) is saved
 * (encrypted) after the first link, so "Continue" is one click: the saved
 * session is checked, renewed quietly from the sign-in browser's remembered
 * single sign-on if it ran out, and only if both fail does the school's own
 * sign-in window open. Passwords are only ever typed by you, on the school's page.
 */
export function sessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, sync, linker, secrets } = ctx;

  app.get("/api/session", async (): Promise<SessionInfo> => {
    const links = await sync.links();
    const lms = links.canvas.linked ? "canvas" : links.blackboard.linked ? "blackboard" : undefined;
    return {
      name: getSetting(db, "STUDENT_NAME"),
      school: ctx.cfg.school,
      linked: lms !== undefined,
      host: lms === "canvas" ? links.canvas.host : links.blackboard.host,
      lms,
      sis: links.sis.linked,
      hasData: listCourses(db).length > 0,
    };
  });

  app.post("/api/signin", async (): Promise<SignInResult> => {
    const env = sync.env();
    const enter = (target: LinkTarget, name?: string): SignInResult => {
      if (name) setSetting(db, "STUDENT_NAME", name.slice(0, 60));
      setSetting(db, target === "canvas" ? "CANVAS_SESSION_EXPIRED" : "BLACKBOARD_SESSION_EXPIRED", "false");
      // Fresh data in the background; the dashboard opens at once with what's saved.
      if (!sync.busy) void sync.run({ force: true }).catch(() => undefined);
      return { state: "in", name: name ?? getSetting(db, "STUDENT_NAME") };
    };
    /** Check a saved session; renew it quietly if it ran out; open the school's window only as a last resort. */
    const tryTarget = async (target: "blackboard" | "canvas", check: () => Promise<{ name?: string } | undefined>): Promise<SignInResult> => {
      const me = await check();
      if (me) return enter(target, me.name);
      if (await linker.renew(target).catch(() => false)) {
        const who = await check();
        if (who) return enter(target, who.name);
      }
      setSetting(db, target === "canvas" ? "CANVAS_SESSION_EXPIRED" : "BLACKBOARD_SESSION_EXPIRED", "true");
      const st = await linker.start(target);
      if (st.phase === "error") return { state: "error", message: st.message };
      return { state: "window", message: st.message };
    };

    const cbase = normalizeBaseUrl(env.CANVAS_BASE_URL);
    if (cbase) {
      // A token you made never expires the way a session does.
      const token = await secrets.get(CANVAS_TOKEN);
      if (token) return enter("canvas", (await canvasUser(cbase, { token }, ctx.fetch))?.name);
      if (await secrets.get(CANVAS_COOKIES)) {
        return tryTarget("canvas", async () => {
          const saved = await secrets.get(CANVAS_COOKIES);
          return saved ? canvasUser(cbase, { jar: CookieJar.parse(saved) }, ctx.fetch) : undefined;
        });
      }
    }

    const base = normalizeBaseUrl(env.BLACKBOARD_BASE_URL);
    const saved = await secrets.get(SESSION_COOKIES);
    // Linked through the official API (an app key in .env): tokens refresh themselves during sync.
    if (!saved && base && (await secrets.get(REST_TOKENS))) return enter("blackboard");
    if (!saved || !base) return { state: "link" };
    return tryTarget("blackboard", async () => {
      const now = await secrets.get(SESSION_COOKIES);
      return now ? sessionUser(base, CookieJar.parse(now), ctx.fetch) : undefined;
    });
  });
}
