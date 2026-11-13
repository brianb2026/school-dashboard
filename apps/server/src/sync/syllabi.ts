import { createHash, randomUUID } from "node:crypto";
import type { CourseFile } from "@sd/core";
import type { Connector, ConnectorContext } from "@sd/connectors";
import { parseSyllabus } from "@sd/syllabus-parser";
import type { SchoolConfig } from "../config.js";
import { getCourse, getScheme, type Db } from "../db/client.js";
import { applySyllabus, autoBody, getSyllabus } from "../syllabus-apply.js";

const RANK = (name: string) => (/\.pdf$/i.test(name) ? 0 : /\.docx$/i.test(name) ? 1 : 2);

export interface PullResult {
  applied: number;
  review: number;
  failed: number;
}

/**
 * Syllabi found in a course's files are downloaded through the same sign-in,
 * read on this machine, and when the grading weights add up to 100% put to
 * work straight away. Anything less certain waits in Syllabi for a quick look.
 * A file is fetched once; it is fetched again only if it changes.
 */
export async function pullSyllabi(db: Db, cfg: SchoolConfig, connector: Connector, ctx: ConnectorContext, files: CourseFile[]): Promise<PullResult> {
  const out: PullResult = { applied: 0, review: 0, failed: 0 };
  if (!connector.download) return out;
  const byCourse = new Map<string, CourseFile[]>();
  for (const f of files) if (f.isSyllabus) byCourse.set(f.courseId, [...(byCourse.get(f.courseId) ?? []), f]);

  for (const [courseId, list] of byCourse) {
    const candidates = [...list].sort((a, b) => RANK(a.name) - RANK(b.name)).slice(0, 2);
    for (const f of candidates) {
      const key = `${f.id}@${f.modified ?? ""}`;
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
      const same = db.prepare("SELECT id FROM syllabi WHERE content_hash = ? AND course_id IS ?", ).get(hash, courseId);
      if (same) {
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
      const replaceable = !scheme || (prior?.auto === true && scheme.source.source === "syllabus");
      if (parse.weights.confident && replaceable) {
        applySyllabus(db, cfg, rec, course, autoBody(rec.parse, courseId), true);
        out.applied++;
        break; // this course is set; no need for a second candidate
      }
      out.review++;
    }
  }
  return out;
}
