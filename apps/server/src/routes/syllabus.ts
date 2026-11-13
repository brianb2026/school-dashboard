import type { FastifyInstance } from "fastify";
import {
  categoryFor,
  matchCourse,
  zonedToIso,
  type Assignment,
  type ConfirmSyllabus,
  type Course,
  type GradingScheme,
  type SyllabusRecord,
} from "@sd/core";
import { parseSyllabus } from "@sd/syllabus-parser";
import type { SchoolConfig } from "../config.js";
import { getCourse, listCourses, tx, upsertAssignment, upsertCourse, upsertScheme, type Db } from "../db/client.js";
import { cleanCourse, createCourse } from "./courses.js";

const KINDS = new Set(["homework", "quiz", "exam", "project", "paper", "lab", "discussion", "reading", "other"]);

function rowToRecord(row: Record<string, unknown>): SyllabusRecord {
  return {
    id: String(row.id),
    filename: String(row.filename),
    uploadedAt: String(row.uploaded_at),
    confirmed: Boolean(row.confirmed),
    courseId: row.course_id ? String(row.course_id) : undefined,
    applied: row.applied ? (JSON.parse(String(row.applied)) as ConfirmSyllabus) : undefined,
    parse: JSON.parse(String(row.parse)),
  };
}

function getSyllabus(db: Db, id: string): SyllabusRecord | undefined {
  const row = db.prepare("SELECT * FROM syllabi WHERE id = ?").get(id);
  return row ? rowToRecord(row) : undefined;
}

/** Check a review submission; returns an error message or nothing. */
export function validateConfirm(body: ConfirmSyllabus | undefined): string | undefined {
  if (!body) return "Nothing to save.";
  if (!body.courseId && !body.newCourse) return "Pick a course or create one.";
  for (const w of body.weights ?? []) {
    if (!w.name?.trim()) return "Every grading category needs a name.";
    if (!(w.weight > 0 && w.weight <= 100)) return `"${w.name}" needs a weight between 0 and 100.`;
  }
  const total = (body.weights ?? []).reduce((s, w) => s + w.weight, 0);
  if (body.weights?.length && Math.abs(total - 100) > 0.5) return `Weights add up to ${total}%, not 100%.`;
  for (const it of body.items ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) return `"${it.title}" has an invalid date.`;
    if (it.time && !/^\d{2}:\d{2}$/.test(it.time)) return `"${it.title}" has an invalid time.`;
    if (!it.title?.trim()) return "Every item needs a title.";
    if (!KINDS.has(it.kind)) return `"${it.title}" has an unknown type.`;
  }
  return undefined;
}

export function syllabusRoutes(app: FastifyInstance, db: Db, cfg: SchoolConfig): void {
  /** Upload (raw body, filename in ?name=). Nothing is applied until you confirm the review. */
  app.post<{ Querystring: { name?: string } }>("/api/syllabus", async (req, reply) => {
    const name = req.query.name ?? "";
    if (!/\.(pdf|docx|txt|md)$/i.test(name)) return reply.code(400).send({ error: "Upload a PDF, DOCX, TXT or MD file." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: "The file is empty." });
    let parse;
    try {
      parse = await parseSyllabus(new Uint8Array(req.body), name, cfg.term.start);
    } catch (e) {
      return reply.code(422).send({ error: `Couldn't read that file: ${(e as Error).message}` });
    }
    const { text: _text, ...stored } = parse;
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO syllabi (id, filename, uploaded_at, parse) VALUES (?, ?, ?, ?)").run(
      id,
      name,
      new Date().toISOString(),
      JSON.stringify(stored),
    );
    const rec = getSyllabus(db, id)!;
    const hint = [parse.course.code, parse.course.title].filter(Boolean).join(" ");
    return { ...rec, suggestedCourseId: hint ? matchCourse(hint, listCourses(db)) : undefined };
  });

  app.get("/api/syllabi", async () => db.prepare("SELECT * FROM syllabi ORDER BY uploaded_at DESC").all().map(rowToRecord));

  app.get<{ Params: { id: string } }>("/api/syllabus/:id", async (req, reply) => {
    const rec = getSyllabus(db, req.params.id);
    if (!rec) return reply.code(404).send({ error: "No such syllabus." });
    const hint = [rec.parse.course.code, rec.parse.course.title].filter(Boolean).join(" ");
    return { ...rec, suggestedCourseId: hint ? matchCourse(hint, listCourses(db)) : undefined };
  });

  /** Apply the reviewed syllabus: grading scheme, dated items, instructor info. Safe to repeat. */
  app.post<{ Params: { id: string }; Body: ConfirmSyllabus }>("/api/syllabus/:id/confirm", async (req, reply) => {
    const rec = getSyllabus(db, req.params.id);
    if (!rec) return reply.code(404).send({ error: "No such syllabus." });
    const body = req.body;
    const err = validateConfirm(body);
    if (err) return reply.code(400).send({ error: err });

    let course: Course | undefined;
    if (body.newCourse) {
      const nc = cleanCourse(body.newCourse);
      if (typeof nc === "string") return reply.code(400).send({ error: nc });
      const made = createCourse(db, cfg, nc);
      if (typeof made === "string") return reply.code(409).send({ error: made });
      course = made;
    } else {
      course = getCourse(db, body.courseId!);
      if (!course) return reply.code(400).send({ error: "Pick one of your courses." });
    }

    const now = new Date().toISOString();
    const source = { source: "syllabus" as const, externalId: rec.id, fetchedAt: now };
    const categories = body.weights.map((w) => ({ name: w.name.trim(), weight: w.weight, dropLowest: w.dropLowest || undefined }));

    tx(db, () => {
      if (categories.length) {
        const scheme: GradingScheme = { courseId: course!.id, categories, source };
        upsertScheme(db, scheme);
      }
      db.prepare("DELETE FROM assignments WHERE id LIKE ?").run(`syllabus:${rec.id}:%`);
      body.items.forEach((it, i) => {
        const a: Assignment = {
          id: `syllabus:${rec.id}:${i}`,
          courseId: course!.id,
          title: it.title.trim(),
          kind: it.kind,
          category: categoryFor(it.kind, it.title, categories),
          dueAt: zonedToIso(it.date, it.time || "23:59", cfg.timezone),
          status: "upcoming",
          submittable: false,
          attachments: [],
          sources: [source],
        };
        upsertAssignment(db, a);
      });
      const known = new Set(course!.instructors.map((p) => p.email?.toLowerCase()));
      const instructors = [
        ...course!.instructors,
        ...body.instructorEmails
          .map((e) => e.trim())
          .filter((e) => e && !known.has(e.toLowerCase()))
          .map((email) => ({ name: email.split("@")[0]!, email, role: "instructor" as const })),
      ];
      upsertCourse(db, {
        ...course!,
        instructors,
        policies: { officeHours: body.officeHours?.trim() || undefined, latePolicy: body.latePolicy?.trim() || undefined },
        sources: course!.sources.some((s) => s.source === "syllabus" && s.externalId === rec.id) ? course!.sources : [...course!.sources, source],
      });
      const applied: ConfirmSyllabus = { ...body, courseId: course!.id, newCourse: undefined };
      db.prepare("UPDATE syllabi SET course_id = ?, confirmed = 1, applied = ? WHERE id = ?").run(course!.id, JSON.stringify(applied), rec.id);
    });
    return { courseId: course.id, items: body.items.length, categories: categories.length };
  });

  app.delete<{ Params: { id: string } }>("/api/syllabus/:id", async (req, reply) => {
    const rec = getSyllabus(db, req.params.id);
    if (!rec) return reply.code(404).send({ error: "No such syllabus." });
    tx(db, () => {
      db.prepare("DELETE FROM assignments WHERE id LIKE ?").run(`syllabus:${rec.id}:%`);
      for (const row of db.prepare("SELECT course_id, data FROM grading_schemes").all()) {
        const s = JSON.parse(String(row.data)) as GradingScheme;
        if (s.source.source === "syllabus" && s.source.externalId === rec.id) {
          db.prepare("DELETE FROM grading_schemes WHERE course_id = ?").run(String(row.course_id));
        }
      }
      db.prepare("DELETE FROM syllabi WHERE id = ?").run(rec.id);
    });
    return { ok: true };
  });
}
