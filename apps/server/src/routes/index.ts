import type { FastifyInstance } from "fastify";
import { API_VERSION, assignmentsToIcs } from "@sd/core";
import type { AppContext } from "../app.js";
import { assignmentRoutes } from "./assignments.js";
import { courseRoutes } from "./courses.js";
import { fileRoutes } from "./files.js";
import { inboxRoutes } from "./inbox.js";
import { linkRoutes } from "./link.js";
import { menubarRoutes } from "./menubar.js";
import { profileRoutes } from "./profiles.js";
import { sessionRoutes } from "./session.js";
import { settingsRoutes } from "./settings.js";
import { syllabusRoutes } from "./syllabus.js";

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/health", async () => ({ ok: true, api: API_VERSION }));

  /** One call for every view. */
  app.get("/api/dashboard", async () => ctx.sync.dashboard());

  settingsRoutes(app, ctx);
  linkRoutes(app, ctx);
  sessionRoutes(app, ctx);
  profileRoutes(app, ctx);
  menubarRoutes(app, ctx);
  courseRoutes(app, ctx);
  assignmentRoutes(app, ctx);
  inboxRoutes(app, ctx);
  fileRoutes(app, ctx);
  syllabusRoutes(app, ctx);

  /** Your open deadlines as a calendar. Apple Calendar on this Mac can subscribe; for Google, download and import. */
  app.get("/calendar.ics", async (_req, reply) => {
    const d = await ctx.sync.dashboard();
    reply.type("text/calendar; charset=utf-8");
    reply.header("content-disposition", 'inline; filename="school-deadlines.ics"');
    return assignmentsToIcs(
      d.assignments.filter((a) => a.courseId !== "unassigned"),
      d.courses,
    );
  });
}
