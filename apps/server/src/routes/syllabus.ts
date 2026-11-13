import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { matchCourse, type ConfirmSyllabus, type Course } from "@sd/core";
import { parseSyllabus } from "@sd/syllabus-parser";
import type { AppContext } from "../app.js";
import { getCourse, getScheme, listCourses } from "../db/client.js";
import { applySyllabus, autoBody, getSyllabus, listSyllabi, removeSyllabus, validateConfirm } from "../syllabus-apply.js";
import { cleanCourse, createCourse } from "./courses.js";

export function syllabusRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, cfg } = ctx;
  const suggest = (parse: { course: { code?: string; title?: string } }): string | undefined => {
    const hint = [parse.course.code, parse.course.title].filter(Boolean).join(" ");
    return hint ? matchCourse(hint, listCourses(db).filter((c) => !c.hidden)) : undefined;
  };

  /**
   * Upload (raw body, filename in ?name=). If the file clearly belongs to one
   * of your courses and its weights add up to 100%, it is applied at once and
   * you can still review it; anything less certain waits for your review.
   */
  app.post<{ Querystring: { name?: string } }>("/api/syllabus", async (req, reply) => {
    const name = String(req.query.name ?? "").replace(/[\\/]/g, "_").slice(0, 200);
    if (!/\.(pdf|docx|txt|md)$/i.test(name)) return reply.code(400).send({ error: "Upload a PDF, DOCX, TXT or MD file." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: "The file is empty." });
    let parse;
    try {
      parse = await parseSyllabus(new Uint8Array(req.body), name, cfg.term.start);
    } catch {
      return reply.code(422).send({ error: "Couldn't read that file. If it's a scan, try a text PDF or the Word version." });
    }
    const { text: _text, ...stored } = parse;
    const id = randomUUID();
    db.prepare("INSERT INTO syllabi (id, filename, uploaded_at, parse, content_hash) VALUES (?, ?, ?, ?, ?)").run(
      id,
      name,
      new Date().toISOString(),
      JSON.stringify(stored),
      createHash("sha256").update(req.body).digest("hex"),
    );
    let rec = getSyllabus(db, id)!;
    const suggestedCourseId = suggest(rec.parse);
    const course = suggestedCourseId ? getCourse(db, suggestedCourseId) : undefined;
    if (course) {
      // Remember which class it belongs to even when nothing is applied yet.
      db.prepare("UPDATE syllabi SET course_id = ? WHERE id = ?").run(course.id, id);
      if (rec.parse.weights.confident && !getScheme(db, course.id)) applySyllabus(db, cfg, rec, course, autoBody(rec.parse, course.id), true);
      rec = getSyllabus(db, id)!;
    }
    return { ...rec, suggestedCourseId };
  });

  app.get("/api/syllabi", async () => listSyllabi(db));

  app.get<{ Params: { id: string } }>("/api/syllabus/:id", async (req, reply) => {
    const rec = getSyllabus(db, req.params.id);
    if (!rec) return reply.code(404).send({ error: "No such syllabus." });
    return { ...rec, suggestedCourseId: rec.courseId ?? suggest(rec.parse) };
  });

  /** Apply the reviewed syllabus. Safe to repeat. */
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
    return applySyllabus(db, cfg, rec, course, body, false);
  });

  app.delete<{ Params: { id: string } }>("/api/syllabus/:id", async (req, reply) => {
    const rec = getSyllabus(db, req.params.id);
    if (!rec) return reply.code(404).send({ error: "No such syllabus." });
    removeSyllabus(db, rec);
    return { ok: true };
  });
}
