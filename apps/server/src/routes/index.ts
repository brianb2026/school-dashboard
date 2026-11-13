import type { FastifyInstance } from "fastify";
import { ALL_CONNECTORS } from "@sd/connectors";
import { assignmentsToIcs, findConflicts, workloadByDay, type AssignmentKind } from "@sd/core";
import { parseSyllabus } from "@sd/syllabus-parser";
import type { SchoolConfig } from "../config.js";
import { listAssignments, listCourses, type Db } from "../db/client.js";
import { keychain } from "../secrets/keychain.js";
import { syncAll } from "../sync/scheduler.js";

export function registerRoutes(app: FastifyInstance, db: Db, cfg: SchoolConfig): void {
  app.get("/api/health", async () => ({ ok: true }));

  /** One call for the whole dashboard. */
  app.get("/api/dashboard", async () => {
    const now = new Date();
    const courses = listCourses(db);
    const assignments = listAssignments(db, new Date(now.getTime() - 7 * 86_400_000).toISOString());
    return {
      school: cfg.school,
      term: cfg.term,
      courses,
      assignments,
      workload: [...workloadByDay(assignments, cfg.timezone).values()].map(({ day, hours, assignments: a }) => ({
        day,
        hours,
        count: a.length,
      })),
      conflicts: findConflicts(
        assignments,
        cfg.timezone,
        cfg.workload.conflictThresholdPerDay,
        cfg.workload.heavyAssignmentKinds as AssignmentKind[],
      ),
      // TODO: grades per course (courseGrade), GPA, attendance, announcements, messages.
    };
  });

  app.get("/api/connectors", async () => {
    const ctx = { env: process.env, secrets: keychain, knownCourses: listCourses(db), now: new Date() };
    return Promise.all(
      ALL_CONNECTORS.map(async (c) => ({ id: c.id, label: c.label, capabilities: c.capabilities, status: await c.status(ctx) })),
    );
  });

  app.post("/api/sync", async () => syncAll(db));

  /** Upload a syllabus (raw body, filename in ?name=). Returns the parse for you to review. */
  app.post<{ Querystring: { name: string } }>("/api/syllabus", async (req) => {
    const bytes = new Uint8Array(req.body as Buffer);
    const parse = await parseSyllabus(bytes, req.query.name, cfg.term.start);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO syllabi (id, filename, uploaded_at, parse) VALUES (?, ?, ?, ?)").run(
      id,
      req.query.name,
      new Date().toISOString(),
      JSON.stringify({ ...parse, text: undefined }),
    );
    return { id, ...parse, text: undefined };
  });

  /** Subscribe to this from Google/Apple Calendar (local machine only). */
  app.get("/calendar.ics", async (_req, reply) => {
    reply.type("text/calendar; charset=utf-8");
    return assignmentsToIcs(listAssignments(db), listCourses(db));
  });
}
