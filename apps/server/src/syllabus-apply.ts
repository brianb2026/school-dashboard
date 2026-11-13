import {
  categoryFor,
  zonedToIso,
  type Assignment,
  type ConfirmSyllabus,
  type Course,
  type GradingScheme,
  type LetterCutoff,
  type SyllabusRecord,
} from "@sd/core";
import type { SchoolConfig } from "./config.js";
import { tx, upsertAssignment, upsertCourse, upsertScheme, type Db } from "./db/client.js";

const KINDS = new Set(["homework", "quiz", "exam", "project", "paper", "lab", "discussion", "reading", "other"]);

export function rowToRecord(row: Record<string, unknown>): SyllabusRecord {
  return {
    id: String(row.id),
    filename: String(row.filename),
    uploadedAt: String(row.uploaded_at),
    confirmed: Boolean(row.confirmed),
    auto: Boolean(row.auto),
    courseId: row.course_id ? String(row.course_id) : undefined,
    applied: row.applied ? (JSON.parse(String(row.applied)) as ConfirmSyllabus) : undefined,
    parse: JSON.parse(String(row.parse)),
  };
}

export function getSyllabus(db: Db, id: string): SyllabusRecord | undefined {
  const row = db.prepare("SELECT * FROM syllabi WHERE id = ?").get(id);
  return row ? rowToRecord(row) : undefined;
}

export function listSyllabi(db: Db): SyllabusRecord[] {
  return db.prepare("SELECT * FROM syllabi ORDER BY uploaded_at DESC").all().map(rowToRecord);
}

function validScale(scale: LetterCutoff[] | undefined): scale is LetterCutoff[] {
  return (
    Array.isArray(scale) &&
    scale.length >= 2 &&
    scale.length <= 15 &&
    scale.every((c) => typeof c?.letter === "string" && c.letter.length > 0 && c.letter.length <= 3 && typeof c.min === "number" && c.min >= 0 && c.min <= 100)
  );
}

/** Check a review submission; returns an error message or nothing. */
export function validateConfirm(body: ConfirmSyllabus | undefined): string | undefined {
  if (!body || typeof body !== "object") return "Nothing to save.";
  if (!body.courseId && !body.newCourse) return "Pick a course or create one.";
  if (!Array.isArray(body.weights) || !Array.isArray(body.items) || !Array.isArray(body.instructorEmails)) return "Something is missing from the form.";
  if (body.weights.length > 30 || body.items.length > 300) return "That's more than a syllabus should have.";
  for (const w of body.weights) {
    if (typeof w?.name !== "string" || !w.name.trim()) return "Every grading category needs a name.";
    if (!(typeof w.weight === "number" && w.weight > 0 && w.weight <= 100)) return `"${w.name}" needs a weight between 0 and 100.`;
    if (w.dropLowest !== undefined && !(Number.isInteger(w.dropLowest) && w.dropLowest >= 0 && w.dropLowest <= 20)) return `"${w.name}": drop lowest should be a small whole number.`;
  }
  const names = body.weights.map((w) => w.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "Two grading categories have the same name.";
  const total = body.weights.reduce((s, w) => s + w.weight, 0);
  if (body.weights.length && Math.abs(total - 100) > 0.5) return `Weights add up to ${Math.round(total * 100) / 100}%, not 100%.`;
  for (const it of body.items) {
    if (typeof it?.title !== "string" || !it.title.trim()) return "Every item needs a title.";
    if (typeof it.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(it.date) || Number.isNaN(Date.parse(it.date))) return `"${it.title}" has an invalid date.`;
    if (it.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(it.time)) return `"${it.title}" has an invalid time.`;
    if (!KINDS.has(it.kind)) return `"${it.title}" has an unknown type.`;
  }
  if (body.instructorEmails.some((e) => typeof e !== "string" || e.length > 200)) return "Check the instructor email.";
  if (body.letterScale !== undefined && !validScale(body.letterScale)) return "The letter scale doesn't look right.";
  return undefined;
}

/** What the parser found, as if you had accepted every line in the review screen. */
export function autoBody(parse: SyllabusRecord["parse"], courseId: string): ConfirmSyllabus {
  return {
    courseId,
    weights: parse.weights.weights.map((w) => ({ name: w.name, weight: w.weight })),
    items: parse.dates.map((d) => ({ date: d.date, title: d.title, kind: d.kind })),
    instructorEmails: parse.policies.instructorEmails,
    officeHours: parse.policies.officeHours,
    latePolicy: parse.policies.latePolicy,
    letterScale: parse.letterScale,
  };
}

/**
 * Put a reviewed (or auto-accepted) syllabus to work: grading weights, dated
 * items, instructor contact, policies, and when the syllabus gives them the
 * letter scale, credits and class times. Safe to repeat: it replaces what the
 * same syllabus added before.
 */
export function applySyllabus(
  db: Db,
  cfg: SchoolConfig,
  rec: SyllabusRecord,
  course: Course,
  body: ConfirmSyllabus,
  auto: boolean,
): { courseId: string; items: number; categories: number } {
  const now = new Date().toISOString();
  const source = { source: "syllabus" as const, externalId: rec.id, fetchedAt: now };
  const categories = body.weights.map((w) => ({ name: w.name.trim(), weight: w.weight, dropLowest: w.dropLowest || undefined }));
  const prefix = `syllabus:${rec.id}:`;

  tx(db, () => {
    if (categories.length) {
      const scheme: GradingScheme = { courseId: course.id, categories, source };
      upsertScheme(db, scheme);
    }
    db.prepare("DELETE FROM assignments WHERE substr(id, 1, ?) = ?").run(prefix.length, prefix);
    body.items.forEach((it, i) => {
      const a: Assignment = {
        id: `${prefix}${i}`,
        courseId: course.id,
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

    const known = new Set(course.instructors.map((p) => p.email?.toLowerCase()));
    const added = [...new Set(body.instructorEmails.map((e) => e.trim()).filter((e) => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e)))]
      .filter((e) => !known.has(e.toLowerCase()))
      .map((email) => ({ name: email.split("@")[0]!, email, role: "instructor" as const }));
    const edited = new Set(course.edited ?? []);
    const next: Course = {
      ...course,
      instructors: [...course.instructors, ...added],
      policies: { officeHours: body.officeHours?.trim().slice(0, 300) || undefined, latePolicy: body.latePolicy?.trim().slice(0, 600) || undefined },
      sources: course.sources.some((s) => s.source === "syllabus" && s.externalId === rec.id) ? course.sources : [...course.sources, source],
    };
    // The instructor's own scale beats the school default; Blackboard's schema or your edit beats the syllabus.
    if (body.letterScale && (!course.letterCutoffsFrom || course.letterCutoffsFrom === "syllabus")) {
      next.letterCutoffs = [...body.letterScale].sort((a, b) => b.min - a.min);
      next.letterCutoffsFrom = "syllabus";
    }
    if (rec.parse.credits && !edited.has("credits")) next.credits = rec.parse.credits;
    if (rec.parse.meetings?.length && course.meetings.length === 0) next.meetings = rec.parse.meetings;
    upsertCourse(db, next);

    const applied: ConfirmSyllabus = { ...body, courseId: course.id, newCourse: undefined };
    db.prepare("UPDATE syllabi SET course_id = ?, confirmed = 1, auto = ?, applied = ? WHERE id = ?").run(course.id, auto ? 1 : 0, JSON.stringify(applied), rec.id);
  });
  return { courseId: course.id, items: body.items.length, categories: categories.length };
}

/** Undo what a syllabus added (its dated items and, if it supplied them, the weights). */
export function removeSyllabus(db: Db, rec: SyllabusRecord): void {
  const prefix = `syllabus:${rec.id}:`;
  tx(db, () => {
    db.prepare("DELETE FROM assignments WHERE substr(id, 1, ?) = ?").run(prefix.length, prefix);
    for (const row of db.prepare("SELECT course_id, data FROM grading_schemes").all()) {
      const s = JSON.parse(String(row.data)) as GradingScheme;
      if (s.source.source === "syllabus" && s.source.externalId === rec.id) {
        db.prepare("DELETE FROM grading_schemes WHERE course_id = ?").run(String(row.course_id));
      }
    }
    db.prepare("DELETE FROM syllabi WHERE id = ?").run(rec.id);
  });
}
