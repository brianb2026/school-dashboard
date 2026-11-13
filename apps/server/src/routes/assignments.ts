import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { zonedToIso, type Assignment, type AssignmentPatch, type AttendanceMark, type NewAssignment } from "@sd/core";
import type { AppContext } from "../app.js";
import { deleteAssignment, deleteAttendance, deleteGrade, getAssignment, getCourse, setOverride, upsertAssignment, upsertAttendance, upsertGrade } from "../db/client.js";

const KINDS = new Set(["homework", "quiz", "exam", "project", "paper", "lab", "discussion", "reading", "other"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MARKS = new Set(["present", "late", "absent", "excused"]);

export function assignmentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, cfg } = ctx;

  /** Add something Blackboard doesn't know about. */
  app.post<{ Body: Partial<NewAssignment> }>("/api/assignments", async (req, reply) => {
    const b = req.body ?? {};
    const title = String(b.title ?? "").trim().slice(0, 160);
    if (!title) return reply.code(400).send({ error: "Give it a title." });
    if (!b.courseId || !getCourse(db, b.courseId)) return reply.code(400).send({ error: "Pick one of your courses." });
    if (!KINDS.has(b.kind ?? "")) return reply.code(400).send({ error: "Pick a type." });
    if (!DATE.test(b.date ?? "") || Number.isNaN(Date.parse(b.date!))) return reply.code(400).send({ error: "Pick a due date." });
    if (b.time && !HHMM.test(b.time)) return reply.code(400).send({ error: "That time doesn't look right." });
    const points = b.pointsPossible === undefined || b.pointsPossible === null ? undefined : Number(b.pointsPossible);
    if (points !== undefined && !(points > 0 && points <= 100_000)) return reply.code(400).send({ error: "Points should be a positive number." });
    const a: Assignment = {
      id: `manual:${randomUUID()}`,
      courseId: b.courseId,
      title,
      kind: b.kind!,
      dueAt: zonedToIso(b.date!, b.time || "23:59", cfg.timezone),
      pointsPossible: points,
      status: "upcoming",
      submittable: false,
      attachments: [],
      sources: [{ source: "manual", fetchedAt: new Date().toISOString() }],
    };
    upsertAssignment(db, a);
    return a;
  });

  /** Your own marks on any assignment: done, effort, grading category, hidden. Kept across syncs. */
  app.patch<{ Params: { id: string }; Body: AssignmentPatch }>("/api/assignments/:id", async (req, reply) => {
    if (!getAssignment(db, req.params.id)) return reply.code(404).send({ error: "No such assignment." });
    const b = req.body ?? {};
    const patch: AssignmentPatch = {};
    if (b.done !== undefined) {
      if (typeof b.done !== "boolean") return reply.code(400).send({ error: "Bad value." });
      patch.done = b.done;
    }
    if (b.hidden !== undefined) {
      if (typeof b.hidden !== "boolean") return reply.code(400).send({ error: "Bad value." });
      patch.hidden = b.hidden;
    }
    if (b.effortHours !== undefined) {
      if (b.effortHours !== null && !(typeof b.effortHours === "number" && b.effortHours >= 0 && b.effortHours <= 100)) {
        return reply.code(400).send({ error: "Effort should be between 0 and 100 hours." });
      }
      patch.effortHours = b.effortHours;
    }
    if (b.category !== undefined) {
      if (b.category !== null && (typeof b.category !== "string" || !b.category.trim() || b.category.length > 80)) return reply.code(400).send({ error: "Bad category." });
      patch.category = b.category === null ? null : b.category.trim();
    }
    return setOverride(db, req.params.id, patch);
  });

  /** Only things you added yourself can be deleted; synced items can be hidden instead. */
  app.delete<{ Params: { id: string } }>("/api/assignments/:id", async (req, reply) => {
    const a = getAssignment(db, req.params.id);
    if (!a) return reply.code(404).send({ error: "No such assignment." });
    if (!a.sources.every((s) => s.source === "manual")) return reply.code(400).send({ error: "This came from a linked source. Hide it instead." });
    deleteAssignment(db, a.id);
    return { ok: true };
  });

  /** Type in a score yourself (for work graded on paper, or before it is posted). Yours wins over the synced one. */
  app.put<{ Params: { id: string }; Body: { score?: number; pointsPossible?: number } }>("/api/grades/:id", async (req, reply) => {
    const a = getAssignment(db, req.params.id);
    if (!a) return reply.code(404).send({ error: "No such assignment." });
    const score = Number(req.body?.score);
    const possible = Number(req.body?.pointsPossible ?? a.pointsPossible);
    if (!Number.isFinite(score) || score < 0 || score > 100_000) return reply.code(400).send({ error: "Enter the score as a number." });
    if (!(possible > 0 && possible <= 100_000)) return reply.code(400).send({ error: "Enter what it was out of." });
    upsertGrade(db, {
      assignmentId: a.id,
      courseId: a.courseId,
      score,
      pointsPossible: possible,
      gradedAt: new Date().toISOString(),
      source: { source: "manual", fetchedAt: new Date().toISOString() },
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/grades/:id", async (req) => {
    deleteGrade(db, req.params.id, "manual");
    return { ok: true };
  });

  /** One-tap check-in log, for classes whose attendance isn't in Blackboard. */
  app.post<{ Body: Partial<AttendanceMark> }>("/api/attendance", async (req, reply) => {
    const b = req.body ?? {};
    if (!b.courseId || !getCourse(db, b.courseId)) return reply.code(400).send({ error: "Pick one of your courses." });
    if (!DATE.test(b.date ?? "") || Number.isNaN(Date.parse(b.date!))) return reply.code(400).send({ error: "Pick a date." });
    if (!MARKS.has(b.status ?? "")) return reply.code(400).send({ error: "Pick present, late, absent or excused." });
    upsertAttendance(db, { courseId: b.courseId, date: b.date!, status: b.status!, source: { source: "manual", fetchedAt: new Date().toISOString() } });
    return { ok: true };
  });

  app.delete<{ Querystring: { courseId?: string; date?: string } }>("/api/attendance", async (req) => {
    deleteAttendance(db, String(req.query.courseId ?? ""), String(req.query.date ?? ""), "manual");
    return { ok: true };
  });
}
