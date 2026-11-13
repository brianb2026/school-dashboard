import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Assignment, Course } from "@sd/core";
import type { SyncResult } from "@sd/connectors";
import { MIGRATIONS } from "./schema.js";

export type Db = DatabaseSync;

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "school.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}

/** Upsert whatever a connector returned. */
export function saveSync(db: Db, r: SyncResult): void {
  db.exec("BEGIN");
  try {
    const course = db.prepare(
      "INSERT INTO courses (id, code, name, term, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, term=excluded.term, data=excluded.data",
    );
    for (const c of r.courses ?? []) course.run(c.id, c.code, c.name, c.term, JSON.stringify(c));

    const asg = db.prepare(
      "INSERT INTO assignments (id, course_id, due_at, status, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, due_at=excluded.due_at, status=excluded.status, data=excluded.data",
    );
    for (const a of r.assignments ?? []) asg.run(a.id, a.courseId, a.dueAt ?? null, a.status, JSON.stringify(a));

    // TODO: grades, schemes, attendance, announcements, messages (same pattern).
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listCourses(db: Db): Course[] {
  return db.prepare("SELECT data FROM courses ORDER BY code").all().map((r) => JSON.parse(String(r.data)) as Course);
}

export function listAssignments(db: Db, fromIso?: string): Assignment[] {
  const rows = fromIso
    ? db.prepare("SELECT data FROM assignments WHERE due_at IS NULL OR due_at >= ? ORDER BY due_at").all(fromIso)
    : db.prepare("SELECT data FROM assignments ORDER BY due_at").all();
  return rows.map((r) => JSON.parse(String(r.data)) as Assignment);
}
