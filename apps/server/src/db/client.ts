import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  codesIn,
  matchCourse,
  type Announcement,
  type Assignment,
  type AttendanceRecord,
  type Course,
  type CourseAlias,
  type GradeEntry,
  type GradingScheme,
  type Message,
} from "@sd/core";
import type { SyncResult } from "@sd/connectors";
import { MIGRATIONS } from "./schema.js";

// Loaded with require() because Vite-based tooling doesn't know the newer `node:sqlite` built-in yet.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export type Db = DatabaseSyncType;

/** `dataDir` is a folder (the DB lives in school.sqlite inside it), or ":memory:" for tests. */
export function openDb(dataDir: string): Db {
  let file = dataDir;
  if (dataDir !== ":memory:") {
    mkdirSync(dataDir, { recursive: true });
    file = join(dataDir, "school.sqlite");
  }
  const db = new DatabaseSync(file);
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  for (let i = version; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

const json = <T>(rows: Record<string, unknown>[]): T[] => rows.map((r) => JSON.parse(String(r.data)) as T);

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ---------- courses ----------

export function upsertCourse(db: Db, c: Course): void {
  db.prepare(
    "INSERT INTO courses (id, code, name, term, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, term=excluded.term, data=excluded.data",
  ).run(c.id, c.code, c.name, c.term, JSON.stringify(c));
}

export function listCourses(db: Db): Course[] {
  return json<Course>(db.prepare("SELECT data FROM courses ORDER BY code").all());
}

export function getCourse(db: Db, id: string): Course | undefined {
  const row = db.prepare("SELECT data FROM courses WHERE id = ?").get(id);
  return row ? (JSON.parse(String(row.data)) as Course) : undefined;
}

/** Removes the course; its live-source assignments go back to "Unmatched", syllabus ones are deleted. */
export function deleteCourse(db: Db, id: string): void {
  tx(db, () => {
    db.prepare("DELETE FROM assignments WHERE course_id = ? AND id LIKE 'syllabus:%'").run(id);
    for (const a of json<Assignment>(db.prepare("SELECT data FROM assignments WHERE course_id = ?").all(id))) {
      upsertAssignment(db, { ...a, courseId: "unassigned" });
    }
    db.prepare("DELETE FROM grading_schemes WHERE course_id = ?").run(id);
    db.prepare("DELETE FROM course_aliases WHERE course_id = ?").run(id);
    db.prepare("UPDATE syllabi SET course_id = NULL, confirmed = 0, applied = NULL WHERE course_id = ?").run(id);
    db.prepare("DELETE FROM courses WHERE id = ?").run(id);
  });
}

// ---------- assignments ----------

export function upsertAssignment(db: Db, a: Assignment): void {
  db.prepare(
    "INSERT INTO assignments (id, course_id, due_at, status, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, due_at=excluded.due_at, status=excluded.status, data=excluded.data",
  ).run(a.id, a.courseId, a.dueAt ?? null, a.status, JSON.stringify(a));
}

export function listAssignments(db: Db, fromIso?: string): Assignment[] {
  const rows = fromIso
    ? db.prepare("SELECT data FROM assignments WHERE due_at IS NULL OR due_at >= ? ORDER BY due_at").all(fromIso)
    : db.prepare("SELECT data FROM assignments ORDER BY due_at").all();
  return json<Assignment>(rows);
}

export function listUnassigned(db: Db): Assignment[] {
  return json<Assignment>(db.prepare("SELECT data FROM assignments WHERE course_id = 'unassigned' ORDER BY due_at").all());
}

// ---------- aliases + matching ----------

export function listAliases(db: Db): CourseAlias[] {
  return db
    .prepare("SELECT pattern, course_id FROM course_aliases ORDER BY pattern")
    .all()
    .map((r) => ({ pattern: String(r.pattern), courseId: String(r.course_id) }));
}

export function addAlias(db: Db, alias: CourseAlias): void {
  db.prepare("INSERT INTO course_aliases (pattern, course_id) VALUES (?, ?) ON CONFLICT(pattern) DO UPDATE SET course_id=excluded.course_id").run(
    alias.pattern.trim(),
    alias.courseId,
  );
}

export function deleteAlias(db: Db, pattern: string): void {
  db.prepare("DELETE FROM course_aliases WHERE pattern = ?").run(pattern);
}

/** Try to place every "Unmatched" assignment. Returns how many found a course. */
export function rematchUnassigned(db: Db): number {
  const courses = listCourses(db);
  const aliases = listAliases(db);
  let matched = 0;
  tx(db, () => {
    for (const a of listUnassigned(db)) {
      const courseId = matchCourse(a.courseHint ?? a.title, courses, aliases);
      if (courseId) {
        upsertAssignment(db, { ...a, courseId });
        matched++;
      }
    }
  });
  return matched;
}

/** What to remember when you place an unmatched item: its course code as written, else its title. */
export function suggestedPattern(a: Assignment): string {
  const text = a.courseHint ?? a.title;
  const re = /\b([A-Za-z]{2,5})[\s\-_.]?(\d{2,4}[A-Za-z]?)\b/;
  const m = codesIn(text).length ? re.exec(text) : null;
  return m ? m[0] : a.title;
}

// ---------- grades, schemes, the rest ----------

export function upsertScheme(db: Db, s: GradingScheme): void {
  db.prepare("INSERT INTO grading_schemes (course_id, data) VALUES (?, ?) ON CONFLICT(course_id) DO UPDATE SET data=excluded.data").run(
    s.courseId,
    JSON.stringify(s),
  );
}

export function listSchemes(db: Db): GradingScheme[] {
  return json<GradingScheme>(db.prepare("SELECT data FROM grading_schemes").all());
}

export function listGrades(db: Db): GradeEntry[] {
  return json<GradeEntry>(db.prepare("SELECT data FROM grades").all());
}

export function listAnnouncements(db: Db, limit = 30): Announcement[] {
  return json<Announcement>(db.prepare("SELECT data FROM announcements ORDER BY posted_at DESC LIMIT ?").all(limit));
}

export function listMessages(db: Db, limit = 30): Message[] {
  return json<Message>(db.prepare("SELECT data FROM messages ORDER BY received_at DESC LIMIT ?").all(limit));
}

/** Upsert whatever a connector returned. */
export function saveSync(db: Db, r: SyncResult): void {
  tx(db, () => {
    for (const c of r.courses ?? []) upsertCourse(db, c);
    for (const a of r.assignments ?? []) {
      // Keep a course you (or an alias) already chose when the source still doesn't know it.
      const prev = a.courseId === "unassigned" ? db.prepare("SELECT course_id FROM assignments WHERE id = ?").get(a.id) : undefined;
      upsertAssignment(db, prev ? { ...a, courseId: String(prev.course_id) } : a);
    }
    for (const s of r.schemes ?? []) upsertScheme(db, s);
    const grade = db.prepare(
      "INSERT INTO grades (assignment_id, source, course_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(assignment_id, source) DO UPDATE SET course_id=excluded.course_id, data=excluded.data",
    );
    for (const g of r.grades ?? []) grade.run(g.assignmentId, g.source.source, g.courseId, JSON.stringify(g));
    const att = db.prepare(
      "INSERT INTO attendance (course_id, date, source, status) VALUES (?, ?, ?, ?) ON CONFLICT(course_id, date, source) DO UPDATE SET status=excluded.status",
    );
    for (const x of r.attendance ?? ([] as AttendanceRecord[])) att.run(x.courseId, x.date, x.source.source, x.status);
    const ann = db.prepare(
      "INSERT INTO announcements (id, course_id, posted_at, read, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, posted_at=excluded.posted_at, data=excluded.data",
    );
    for (const x of r.announcements ?? []) ann.run(x.id, x.courseId ?? null, x.postedAt, x.read ? 1 : 0, JSON.stringify(x));
    const msg = db.prepare(
      "INSERT INTO messages (id, thread_id, course_id, received_at, unread, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, unread=excluded.unread, data=excluded.data",
    );
    for (const x of r.messages ?? []) msg.run(x.id, x.threadId, x.courseId ?? null, x.receivedAt, x.unread ? 1 : 0, JSON.stringify(x));
  });
}

// ---------- settings (non-secret) ----------

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? String(row.value) : undefined;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

export function allSettings(db: Db): Record<string, string> {
  return Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [String(r.key), String(r.value)]));
}

export function lastSyncAt(db: Db): string | undefined {
  const row = db.prepare("SELECT MAX(at) AS at FROM sync_log WHERE ok = 1 AND connector != 'manual'").get();
  return row?.at ? String(row.at) : undefined;
}
