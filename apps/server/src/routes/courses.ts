import type { FastifyInstance } from "fastify";
import {
  courseKey,
  type Course,
  type CourseLevel,
  type CoursePatch,
  type GradingCategory,
  type LetterCutoff,
  type Meeting,
  type NewCourse,
  type UnmatchedItem,
} from "@sd/core";
import type { AppContext } from "../app.js";
import type { SchoolConfig } from "../config.js";
import {
  addAlias,
  deleteAlias,
  deleteCourse,
  deleteScheme,
  getCourse,
  listAliases,
  listCourses,
  listUnassigned,
  rematchUnassigned,
  suggestedPattern,
  upsertCourse,
  upsertScheme,
  type Db,
} from "../db/client.js";

const LEVELS: CourseLevel[] = ["regular", "honors", "ap", "ib", "de"];
const COLORS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
const SOURCES = ["auto", "blackboard", "syllabus", "points"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate a new/edited course; returns an error message or the cleaned value. */
export function cleanCourse(body: Partial<NewCourse> | undefined): NewCourse | string {
  const code = String(body?.code ?? "").trim().slice(0, 24);
  const name = String(body?.name ?? "").trim().slice(0, 120);
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

function cleanMeetings(v: unknown): Meeting[] | string {
  if (!Array.isArray(v) || v.length > 30) return "Class times don't look right.";
  const out: Meeting[] = [];
  for (const m of v as Partial<Meeting>[]) {
    if (!Number.isInteger(m?.weekday) || m.weekday! < 0 || m.weekday! > 6) return "Pick a day for each class time.";
    if (!HHMM.test(m.start ?? "") || !HHMM.test(m.end ?? "")) return "Class times need a start and an end.";
    if (m.end! <= m.start!) return "A class should end after it starts.";
    out.push({ weekday: m.weekday!, start: m.start!, end: m.end!, location: typeof m.location === "string" && m.location.trim() ? m.location.trim().slice(0, 80) : undefined });
  }
  return out;
}

function cleanScale(v: unknown): LetterCutoff[] | string {
  if (!Array.isArray(v) || v.length < 2 || v.length > 15) return "A letter scale needs at least two letters.";
  const out: LetterCutoff[] = [];
  for (const c of v as Partial<LetterCutoff>[]) {
    const letter = String(c?.letter ?? "").trim();
    if (!letter || letter.length > 3 || typeof c.min !== "number" || !(c.min >= 0 && c.min <= 100)) return "Each letter needs a minimum between 0 and 100.";
    out.push({ letter, min: c.min });
  }
  if (new Set(out.map((c) => c.letter)).size !== out.length) return "A letter appears twice.";
  return out.sort((a, b) => b.min - a.min);
}

export function cleanCategories(v: unknown): GradingCategory[] | string {
  if (!Array.isArray(v) || v.length === 0 || v.length > 30) return "Add at least one grading category.";
  const out: GradingCategory[] = [];
  for (const c of v as Partial<GradingCategory>[]) {
    const name = String(c?.name ?? "").trim().slice(0, 80);
    if (!name) return "Every grading category needs a name.";
    if (typeof c.weight !== "number" || !(c.weight > 0 && c.weight <= 100)) return `"${name}" needs a weight between 0 and 100.`;
    const drop = c.dropLowest === undefined || c.dropLowest === null ? undefined : Number(c.dropLowest);
    if (drop !== undefined && !(Number.isInteger(drop) && drop >= 0 && drop <= 20)) return `"${name}": drop lowest should be a small whole number.`;
    out.push({ name, weight: c.weight, dropLowest: drop || undefined });
  }
  if (new Set(out.map((c) => c.name.toLowerCase())).size !== out.length) return "Two grading categories have the same name.";
  const total = out.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(total - 100) > 0.5) return `Weights add up to ${Math.round(total * 100) / 100}%, not 100%.`;
  return out;
}

export function courseRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, cfg } = ctx;

  app.get("/api/courses", async () => listCourses(db).filter((c) => !c.hidden));

  app.post<{ Body: Partial<NewCourse> }>("/api/courses", async (req, reply) => {
    const nc = cleanCourse(req.body);
    if (typeof nc === "string") return reply.code(400).send({ error: nc });
    const course = createCourse(db, cfg, nc);
    if (typeof course === "string") return reply.code(409).send({ error: course });
    return { course, matched: rematchUnassigned(db) };
  });

  /** Change a course. What you change here is remembered and never overwritten by a sync. */
  app.patch<{ Params: { id: string }; Body: CoursePatch }>("/api/courses/:id", async (req, reply) => {
    const prev = getCourse(db, req.params.id);
    if (!prev) return reply.code(404).send({ error: "No such course." });
    const b = req.body ?? {};
    const nc = cleanCourse({ ...prev, ...b });
    if (typeof nc === "string") return reply.code(400).send({ error: nc });
    const edited = new Set(prev.edited ?? []);
    for (const k of ["code", "name", "credits", "level"] as const) if (b[k] !== undefined && b[k] !== prev[k]) edited.add(k);
    const course: Course = { ...prev, ...nc, edited: [...edited] };
    if (b.gradeSource !== undefined) {
      if (!SOURCES.includes(b.gradeSource)) return reply.code(400).send({ error: "Unknown grade source." });
      course.gradeSource = b.gradeSource === "auto" ? undefined : b.gradeSource;
    }
    if (b.meetings !== undefined) {
      const m = cleanMeetings(b.meetings);
      if (typeof m === "string") return reply.code(400).send({ error: m });
      course.meetings = m;
    }
    if (b.letterCutoffs !== undefined) {
      if (b.letterCutoffs === null) {
        course.letterCutoffs = undefined;
        course.letterCutoffsFrom = undefined;
      } else {
        const s = cleanScale(b.letterCutoffs);
        if (typeof s === "string") return reply.code(400).send({ error: s });
        course.letterCutoffs = s;
        course.letterCutoffsFrom = "manual";
      }
    }
    if (b.hidden !== undefined) course.hidden = b.hidden === true ? true : undefined;
    upsertCourse(db, course);
    return { course, matched: rematchUnassigned(db) };
  });

  /**
   * Remove a course. One that came from Blackboard is hidden instead of
   * deleted, so the next sync doesn't bring it straight back.
   */
  app.delete<{ Params: { id: string } }>("/api/courses/:id", async (req, reply) => {
    const c = getCourse(db, req.params.id);
    if (!c) return reply.code(404).send({ error: "No such course." });
    if (c.sources.some((s) => s.source === "blackboard-session" || s.source === "blackboard-rest")) {
      upsertCourse(db, { ...c, hidden: true });
      return { ok: true, hidden: true };
    }
    deleteCourse(db, c.id);
    return { ok: true, hidden: false };
  });

  /** Set the grading weights by hand (also how the Grades view edits them). */
  app.put<{ Params: { id: string }; Body: { categories?: unknown } }>("/api/courses/:id/scheme", async (req, reply) => {
    if (!getCourse(db, req.params.id)) return reply.code(404).send({ error: "No such course." });
    const cats = cleanCategories(req.body?.categories);
    if (typeof cats === "string") return reply.code(400).send({ error: cats });
    upsertScheme(db, { courseId: req.params.id, categories: cats, source: { source: "manual", fetchedAt: new Date().toISOString() } });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/courses/:id/scheme", async (req) => {
    deleteScheme(db, req.params.id);
    return { ok: true };
  });

  app.get("/api/unmatched", async (): Promise<UnmatchedItem[]> =>
    listUnassigned(db).map((a) => ({ id: a.id, title: a.title, courseHint: a.courseHint, dueAt: a.dueAt, suggestedPattern: suggestedPattern(a) })),
  );

  app.get("/api/aliases", async () => listAliases(db));

  /** "Items containing `pattern` belong to `courseId`", then re-place everything unmatched. */
  app.post<{ Body: { pattern?: string; courseId?: string } }>("/api/aliases", async (req, reply) => {
    const pattern = String(req.body?.pattern ?? "").trim().slice(0, 120);
    const courseId = String(req.body?.courseId ?? "");
    if (pattern.length < 2) return reply.code(400).send({ error: "Pattern is too short." });
    if (!getCourse(db, courseId)) return reply.code(400).send({ error: "Pick one of your courses." });
    addAlias(db, { pattern, courseId });
    return { matched: rematchUnassigned(db) };
  });

  app.delete<{ Querystring: { pattern?: string } }>("/api/aliases", async (req) => {
    deleteAlias(db, String(req.query.pattern ?? ""));
    return { ok: true };
  });
}
