import type { FastifyInstance } from "fastify";
import { courseKey, type Course, type CourseLevel, type NewCourse, type UnmatchedItem } from "@sd/core";
import type { SchoolConfig } from "../config.js";
import {
  addAlias,
  deleteAlias,
  deleteCourse,
  getCourse,
  listAliases,
  listCourses,
  listUnassigned,
  rematchUnassigned,
  suggestedPattern,
  upsertCourse,
  type Db,
} from "../db/client.js";

const LEVELS: CourseLevel[] = ["regular", "honors", "ap", "ib", "de"];
const COLORS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];

/** Validate a new/edited course; returns an error message or the cleaned value. */
export function cleanCourse(body: Partial<NewCourse> | undefined): NewCourse | string {
  const code = body?.code?.trim() ?? "";
  const name = body?.name?.trim() ?? "";
  if (!code || !courseKey(code)) return "Course code should look like CHEM 101.";
  if (!name) return "Give the course a name.";
  const credits = Number(body?.credits ?? 3);
  if (!Number.isFinite(credits) || credits < 0 || credits > 12) return "Credits should be between 0 and 12.";
  const level = LEVELS.includes(body?.level as CourseLevel) ? (body!.level as CourseLevel) : "regular";
  const color = COLORS.includes(body?.color ?? "") ? body!.color! : "c1";
  return { code, name, credits, level, color };
}

export function createCourse(db: Db, cfg: SchoolConfig, nc: NewCourse): Course | string {
  const key = courseKey(nc.code)!;
  if (listCourses(db).some((c) => courseKey(c.code) === key)) return `You already have ${nc.code}.`;
  const course: Course = {
    id: `manual:${key.toLowerCase()}`,
    ...nc,
    term: cfg.term.name,
    instructors: [],
    meetings: [],
    sources: [{ source: "manual", fetchedAt: new Date().toISOString() }],
  };
  upsertCourse(db, course);
  return course;
}

export function courseRoutes(app: FastifyInstance, db: Db, cfg: SchoolConfig): void {
  app.get("/api/courses", async () => listCourses(db));

  app.post<{ Body: Partial<NewCourse> }>("/api/courses", async (req, reply) => {
    const nc = cleanCourse(req.body);
    if (typeof nc === "string") return reply.code(400).send({ error: nc });
    const course = createCourse(db, cfg, nc);
    if (typeof course === "string") return reply.code(409).send({ error: course });
    const matched = rematchUnassigned(db);
    return { course, matched };
  });

  app.patch<{ Params: { id: string }; Body: Partial<NewCourse> }>("/api/courses/:id", async (req, reply) => {
    const prev = getCourse(db, req.params.id);
    if (!prev) return reply.code(404).send({ error: "No such course." });
    const nc = cleanCourse({ ...prev, ...req.body });
    if (typeof nc === "string") return reply.code(400).send({ error: nc });
    const course = { ...prev, ...nc };
    upsertCourse(db, course);
    return { course, matched: rematchUnassigned(db) };
  });

  app.delete<{ Params: { id: string } }>("/api/courses/:id", async (req, reply) => {
    if (!getCourse(db, req.params.id)) return reply.code(404).send({ error: "No such course." });
    deleteCourse(db, req.params.id);
    return { ok: true };
  });

  app.get("/api/unmatched", async (): Promise<UnmatchedItem[]> =>
    listUnassigned(db).map((a) => ({ id: a.id, title: a.title, courseHint: a.courseHint, dueAt: a.dueAt, suggestedPattern: suggestedPattern(a) })),
  );

  app.get("/api/aliases", async () => listAliases(db));

  /** "Items containing `pattern` belong to `courseId`" — then re-place everything unmatched. */
  app.post<{ Body: { pattern?: string; courseId?: string } }>("/api/aliases", async (req, reply) => {
    const pattern = req.body?.pattern?.trim() ?? "";
    const courseId = req.body?.courseId ?? "";
    if (pattern.length < 2) return reply.code(400).send({ error: "Pattern is too short." });
    if (!getCourse(db, courseId)) return reply.code(400).send({ error: "Pick one of your courses." });
    addAlias(db, { pattern, courseId });
    return { matched: rematchUnassigned(db) };
  });

  app.delete<{ Querystring: { pattern: string } }>("/api/aliases", async (req) => {
    deleteAlias(db, req.query.pattern);
    return { ok: true };
  });
}
