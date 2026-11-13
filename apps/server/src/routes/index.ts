import type { FastifyInstance } from "fastify";
import type { SecretStore } from "@sd/connectors";
import { assignmentsToIcs } from "@sd/core";
import type { SchoolConfig } from "../config.js";
import { listAssignments, listCourses, type Db } from "../db/client.js";
import { courseRoutes } from "./courses.js";
import { buildDashboard } from "./dashboard.js";
import { settingsRoutes } from "./settings.js";
import { syllabusRoutes } from "./syllabus.js";

export function registerRoutes(app: FastifyInstance, db: Db, cfg: SchoolConfig, secrets: SecretStore, env: NodeJS.ProcessEnv): void {
  app.get("/api/health", async () => ({ ok: true }));

  /** One call for the whole Today view. */
  app.get("/api/dashboard", async () => buildDashboard(db, cfg));

  settingsRoutes(app, db, cfg, secrets, env);
  courseRoutes(app, db, cfg);
  syllabusRoutes(app, db, cfg);

  /** Subscribe to this from Google/Apple Calendar (local machine only). */
  app.get("/calendar.ics", async (_req, reply) => {
    reply.type("text/calendar; charset=utf-8");
    return assignmentsToIcs(
      listAssignments(db).filter((a) => a.courseId !== "unassigned"),
      listCourses(db),
    );
  });
}
