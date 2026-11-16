import { createHash, randomUUID } from "node:crypto";
import type { CourseFile } from "@sd/core";
import type { Connector, ConnectorContext } from "@sd/connectors";
import { PARSER_VERSION, parseSyllabus } from "@sd/syllabus-parser";
import type { SchoolConfig } from "../config.js";
import { getCourse, getScheme, type Db } from "../db/client.js";
import { applySyllabus, autoBody, getSyllabus, removeSyllabus, rowToRecord } from "../syllabus-apply.js";

/** The syllabus file itself first, then schedule pages. */
const RANK = (f: CourseFile) => (/syllab/i.test(f.name) ? 0 : 2) + (/\.pdf$/i.test(f.name) ? 0 : /\.docx$/i.test(f.name) ? 0.5 : 1);

export interface PullResult {
  /** Grading weights put to use. */
  applied: number;
  /** Pages that only added dates (schedule, exam dates, readings). */
  dated: number;
  /** Weights were found but don't add up; waiting for a look. */
  review: number;
  failed: number;
}

/**
 * Syllabi and schedule pages found in a course ("Course Overview → Syllabus",
 * "Course Schedule", …) are fetched through the same sign-in and read on this
 * machine. Dated items (exams, readings, things due) are added straight away.
 * Grading weights are used when they add up to 100% and you haven't set your
 * own; otherwise the syllabus waits in Syllabi for a quick check.
 * A file is fetched once, and again only if it changes (or the reader improves).
 */
export async function pullSyllabi(db: Db, cfg: SchoolConfig, connector: Connector, ctx: ConnectorContext, files: CourseFile[]): Promise<PullResult> {
  const out: PullResult = { applied: 0, dated: 0, review: 0, failed: 0 };
  if (!connector.download) return out;
  const byCourse = new Map<string, CourseFile[]>();
  for (const f of files) if (f.isSyllabus) byCourse.set(f.courseId, [...(byCourse.get(f.courseId) ?? []), f]);

  for (const [courseId, list] of byCourse) {
    for (const f of [...list].sort((a, b) => RANK(a) - RANK(b)).slice(0, 6)) {
      // The file as it is now, read by the reader as it is now.
      const key = `${f.id}@${f.modified ?? ""}#p${PARSER_VERSION}`;
      if (db.prepare("SELECT 1 AS x FROM syllabi WHERE source_file = ?").get(key)) continue;
      let bytes: Uint8Array;
      let filename: string;
      try {
        ({ bytes, filename } = await connector.download(ctx, f));
      } catch {
        // The data is already saved; a file that won't download is tried again next time.
        out.failed++;
        continue;
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const same = db.prepare("SELECT id, auto, source_file FROM syllabi WHERE content_hash = ? AND course_id IS ?").get(hash, courseId);
      // Same bytes as one already here: nothing to do, unless it was read automatically by an older reader.
      const stale = same && Number(same.auto) === 1 && !String(same.source_file ?? "").endsWith(`#p${PARSER_VERSION}`);
      if (same && !stale) {
        db.prepare("UPDATE syllabi SET source_file = ? WHERE id = ?").run(key, String(same.id));
        continue;
      }
      let parse;
      try {
        parse = await parseSyllabus(bytes, filename, cfg.term.start);
      } catch {
        out.failed++;
        continue;
      }
      // A newer version of the same file replaces what the old one added (unless you edited that one yourself).
      const prefix = `${f.id}@`;
      for (const row of db.prepare("SELECT * FROM syllabi WHERE substr(source_file, 1, ?) = ? AND auto = 1").all(prefix.length, prefix)) {
        removeSyllabus(db, rowToRecord(row));
      }
      const { text: _text, ...stored } = parse;
      const id = randomUUID();
      db.prepare("INSERT INTO syllabi (id, course_id, filename, uploaded_at, parse, source_file, content_hash, auto) VALUES (?, ?, ?, ?, ?, ?, ?, 1)").run(
        id,
        courseId,
        filename,
        ctx.now.toISOString(),
        JSON.stringify(stored),
        key,
        hash,
      );
      const course = getCourse(db, courseId);
      const rec = getSyllabus(db, id);
      if (!course || !rec) continue;

      // Never overwrite weights you typed or confirmed yourself.
      const scheme = getScheme(db, courseId);
      const prior = scheme?.source.source === "syllabus" && scheme.source.externalId ? getSyllabus(db, scheme.source.externalId) : undefined;
      const replaceable = !scheme || prior?.auto === true;
      const useWeights = parse.weights.confident && replaceable;
      const body = autoBody(rec.parse, courseId);
      if (!useWeights) body.weights = [];
      if (useWeights || body.items.length) {
        applySyllabus(db, cfg, rec, course, body, true);
        if (useWeights) out.applied++;
        else out.dated++;
      }
      if (!useWeights && parse.weights.weights.length > 0 && !scheme) out.review++;
    }
  }
  return out;
}
