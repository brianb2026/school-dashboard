import { chmodSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import {
  matchCourse,
  type Announcement,
  type ContentItem,
  type SisRecord,
  type Assignment,
  type AssignmentPatch,
  type Course,
  type CourseAlias,
  type CourseFile,
  type CourseOverall,
  type GradeEntry,
  type GradingScheme,
  type Message,
  type Person,
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
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    file = join(dataDir, "school.sqlite");
  }
  const db = new DatabaseSync(file);
  if (file !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
    // Your school data: readable by you only.
    try {
      chmodSync(dataDir, 0o700);
      chmodSync(file, 0o600);
    } catch {
      /* best effort (e.g. Windows) */
    }
  }
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

const open = new WeakSet<Db>();
/** Run in a transaction. A nested call on the same database joins the outer one. */
export function tx<T>(db: Db, fn: () => T): T {
  if (open.has(db)) return fn();
  db.exec("BEGIN");
  open.add(db);
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    open.delete(db);
  }
}

// ---------- courses ----------

export function upsertCourse(db: Db, c: Course): void {
  db.prepare(
    "INSERT INTO courses (id, code, name, term, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, term=excluded.term, data=excluded.data",
  ).run(c.id, c.code, c.name, c.term, JSON.stringify(c));
}

/** Every course, hidden ones included. */
export function listCourses(db: Db): Course[] {
  return json<Course>(db.prepare("SELECT data FROM courses ORDER BY code").all());
}

export function getCourse(db: Db, id: string): Course | undefined {
  const row = db.prepare("SELECT data FROM courses WHERE id = ?").get(id);
  return row ? (JSON.parse(String(row.data)) as Course) : undefined;
}

/**
 * A course as a source reports it, folded into what is already stored.
 * Your own choices (color, credits, level, hidden, anything in `edited`,
 * syllabus policies, class times) always survive.
 */
export function mergeSyncedCourse(prev: Course | undefined, fresh: Course): Course {
  if (!prev) return fresh;
  const edited = new Set(prev.edited ?? []);
  const people = new Map<string, Person>();
  for (const p of [...prev.instructors, ...fresh.instructors]) {
    const key = (p.email ?? p.name).toLowerCase();
    people.set(key, { ...people.get(key), ...p });
  }
  const freshScale = fresh.letterCutoffs && prev.letterCutoffsFrom !== "manual";
  return {
    ...prev,
    code: edited.has("code") ? prev.code : fresh.code,
    name: edited.has("name") ? prev.name : fresh.name,
    term: fresh.term || prev.term,
    url: fresh.url ?? prev.url,
    instructors: [...people.values()],
    meetings: prev.meetings.length ? prev.meetings : fresh.meetings,
    letterCutoffs: freshScale ? fresh.letterCutoffs : prev.letterCutoffs,
    letterCutoffsFrom: freshScale ? fresh.letterCutoffsFrom : prev.letterCutoffsFrom,
    sources: [...fresh.sources, ...prev.sources.filter((s) => !fresh.sources.some((f) => f.source === s.source && f.externalId === s.externalId))],
  };
}

/** Removes the course and what hangs off it; live-source assignments go back to "Unmatched". */
export function deleteCourse(db: Db, id: string): void {
  tx(db, () => {
    db.prepare("DELETE FROM assignments WHERE course_id = ? AND (id LIKE 'syllabus:%' OR id LIKE 'manual:%')").run(id);
    for (const a of json<Assignment>(db.prepare("SELECT data FROM assignments WHERE course_id = ?").all(id))) {
      upsertAssignment(db, { ...a, courseId: "unassigned" });
    }
    for (const t of ["grading_schemes", "course_aliases", "grades", "course_overall", "files"]) {
      db.prepare(`DELETE FROM ${t} WHERE course_id = ?`).run(id);
    }
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

export function getAssignment(db: Db, id: string): Assignment | undefined {
  const row = db.prepare("SELECT data FROM assignments WHERE id = ?").get(id);
  return row ? (JSON.parse(String(row.data)) as Assignment) : undefined;
}

export function listAssignments(db: Db): Assignment[] {
  return json<Assignment>(db.prepare("SELECT data FROM assignments ORDER BY due_at").all());
}

export function listUnassigned(db: Db): Assignment[] {
  return json<Assignment>(db.prepare("SELECT data FROM assignments WHERE course_id = 'unassigned' ORDER BY due_at").all());
}

export function deleteAssignment(db: Db, id: string): void {
  tx(db, () => {
    db.prepare("DELETE FROM assignments WHERE id = ?").run(id);
    db.prepare("DELETE FROM grades WHERE assignment_id = ?").run(id);
    db.prepare("DELETE FROM assignment_overrides WHERE assignment_id = ?").run(id);
  });
}

export function listOverrides(db: Db): Map<string, AssignmentPatch> {
  return new Map(
    db
      .prepare("SELECT assignment_id, data FROM assignment_overrides")
      .all()
      .map((r) => [String(r.assignment_id), JSON.parse(String(r.data)) as AssignmentPatch]),
  );
}

/** Merge a change into your marks for one assignment; null or false clears a field. */
export function setOverride(db: Db, id: string, patch: AssignmentPatch): AssignmentPatch {
  const row = db.prepare("SELECT data FROM assignment_overrides WHERE assignment_id = ?").get(id);
  const next: Record<string, unknown> = { ...(row ? (JSON.parse(String(row.data)) as AssignmentPatch) : {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined || next[k] === false) delete next[k];
  if (Object.keys(next).length === 0) db.prepare("DELETE FROM assignment_overrides WHERE assignment_id = ?").run(id);
  else {
    db.prepare("INSERT INTO assignment_overrides (assignment_id, data) VALUES (?, ?) ON CONFLICT(assignment_id) DO UPDATE SET data=excluded.data").run(
      id,
      JSON.stringify(next),
    );
  }
  return next as AssignmentPatch;
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
  const courses = listCourses(db).filter((c) => !c.hidden);
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
  const m = /\b([A-Za-z]{2,5})[\s\-_.]?(\d{2,4}[A-Za-z]?)\b/.exec(text);
  return m ? m[0] : a.title;
}

// ---------- grades, schemes, totals ----------

export function upsertScheme(db: Db, s: GradingScheme): void {
  db.prepare("INSERT INTO grading_schemes (course_id, data) VALUES (?, ?) ON CONFLICT(course_id) DO UPDATE SET data=excluded.data").run(
    s.courseId,
    JSON.stringify(s),
  );
}

export function listSchemes(db: Db): GradingScheme[] {
  return json<GradingScheme>(db.prepare("SELECT data FROM grading_schemes").all());
}

export function getScheme(db: Db, courseId: string): GradingScheme | undefined {
  const row = db.prepare("SELECT data FROM grading_schemes WHERE course_id = ?").get(courseId);
  return row ? (JSON.parse(String(row.data)) as GradingScheme) : undefined;
}

export function deleteScheme(db: Db, courseId: string): void {
  db.prepare("DELETE FROM grading_schemes WHERE course_id = ?").run(courseId);
}

export function upsertGrade(db: Db, g: GradeEntry): void {
  db.prepare(
    "INSERT INTO grades (assignment_id, source, course_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(assignment_id, source) DO UPDATE SET course_id=excluded.course_id, data=excluded.data",
  ).run(g.assignmentId, g.source.source, g.courseId, JSON.stringify(g));
}

export function deleteGrade(db: Db, assignmentId: string, source: string): void {
  db.prepare("DELETE FROM grades WHERE assignment_id = ? AND source = ?").run(assignmentId, source);
}

export function listGrades(db: Db): GradeEntry[] {
  return json<GradeEntry>(db.prepare("SELECT data FROM grades").all());
}

export function listOverall(db: Db): CourseOverall[] {
  return json<CourseOverall>(db.prepare("SELECT data FROM course_overall").all());
}

// ---------- announcements, messages, files ----------

/** Newest first, minus the ones you dismissed; the `read` flag you set is kept across re-syncs. */
export function listAnnouncements(db: Db, limit = 60): Announcement[] {
  return db
    .prepare("SELECT data, read FROM announcements WHERE dismissed = 0 ORDER BY posted_at DESC LIMIT ?")
    .all(limit)
    .map((r) => ({ ...(JSON.parse(String(r.data)) as Announcement), read: Boolean(r.read) }));
}

export function markAnnouncementRead(db: Db, id: string, read: boolean): boolean {
  return Number(db.prepare("UPDATE announcements SET read = ? WHERE id = ?").run(read ? 1 : 0, id).changes) > 0;
}

/** Dismissing also marks it read; un-dismissing (undo) leaves it read. */
export function dismissAnnouncement(db: Db, id: string, dismissed: boolean): boolean {
  const sql = dismissed ? "UPDATE announcements SET dismissed = 1, read = 1 WHERE id = ?" : "UPDATE announcements SET dismissed = 0 WHERE id = ?";
  return Number(db.prepare(sql).run(id).changes) > 0;
}

export interface ChangeRow {
  id: number;
  at: string;
  kind: "grade" | "due-moved" | "new-assignment" | "file" | "announcement";
  courseId?: string;
  ref: string;
  data: { title?: string; name?: string; from?: string; to?: string; dueAt?: string; score?: number; possible?: number; was?: number };
  seen: boolean;
  notified: boolean;
}

/** Changes from the last `days` days, newest first. */
export function listChanges(db: Db, days = 14): ChangeRow[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db
    .prepare("SELECT * FROM changes WHERE at >= ? ORDER BY id DESC LIMIT 300")
    .all(since)
    .map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      kind: String(r.kind) as ChangeRow["kind"],
      courseId: r.course_id === null ? undefined : String(r.course_id),
      ref: String(r.ref),
      data: JSON.parse(String(r.data)) as ChangeRow["data"],
      seen: Number(r.seen) === 1,
      notified: Number(r.notified) === 1,
    }));
}

export function markChangesSeen(db: Db, upTo: number): void {
  db.prepare("UPDATE changes SET seen = 1 WHERE id <= ?").run(upTo);
}

export function markChangeNotified(db: Db, id: number): void {
  db.prepare("UPDATE changes SET notified = 1 WHERE id = ?").run(id);
}

/** The last record read from the SIS, if any. */
export function getSisRecord(db: Db): SisRecord | undefined {
  const row = db.prepare("SELECT data FROM sis_record WHERE id = 1").get();
  return row ? (JSON.parse(String(row.data)) as SisRecord) : undefined;
}

/** A course's content tree as of the last sync (empty until one has run). */
export function getContents(db: Db, courseId: string): { items: ContentItem[]; fetchedAt?: string } {
  const row = db.prepare("SELECT data, fetched_at FROM course_contents WHERE course_id = ?").get(courseId);
  return row ? { items: JSON.parse(String(row.data)) as ContentItem[], fetchedAt: String(row.fetched_at) } : { items: [] };
}

export function listMessages(db: Db, limit = 60): Message[] {
  return json<Message>(db.prepare("SELECT data FROM messages ORDER BY received_at DESC LIMIT ?").all(limit));
}

export function listFiles(db: Db): CourseFile[] {
  return json<CourseFile>(db.prepare("SELECT data FROM files").all());
}

export function getFile(db: Db, id: string): CourseFile | undefined {
  const row = db.prepare("SELECT data FROM files WHERE id = ?").get(id);
  return row ? (JSON.parse(String(row.data)) as CourseFile) : undefined;
}

// ---------- saving a sync ----------

/** Delete rows under an id prefix that the source no longer reports. Uses substr, not LIKE: ids contain "_". */
function prune(db: Db, table: string, idCol: string, prefixes: string[] | undefined, keep: Set<string>, extra = ""): string[] {
  const gone: string[] = [];
  for (const p of prefixes ?? []) {
    if (!p) continue;
    for (const r of db.prepare(`SELECT ${idCol} AS id FROM ${table} WHERE substr(${idCol}, 1, ?) = ? ${extra}`).all(p.length, p)) {
      const id = String(r.id);
      if (!keep.has(id)) gone.push(id);
    }
  }
  const del = db.prepare(`DELETE FROM ${table} WHERE ${idCol} = ? ${extra}`);
  for (const id of gone) del.run(id);
  return gone;
}

/** Store whatever a connector returned, and drop what it no longer has. */
/** Sources whose dates are the school's own (a syllabus re-read or your own entry moving isn't news). */
const DATED_SOURCES = new Set(["blackboard-session", "blackboard-rest", "blackboard-ical", "canvas", "gradescope"]);

/**
 * Save one source's sync. With `record`, also note what changed (a new
 * grade, a deadline that moved, new work, files, announcements) for the
 * "What changed" list. A source's first sync is saved without notes, so
 * linking something doesn't bury you in old news.
 */
export function saveSync(db: Db, r: SyncResult, opts: { record?: boolean } = {}): void {
  const at = new Date().toISOString();
  const note = db.prepare("INSERT INTO changes (at, kind, course_id, ref, data) VALUES (?, ?, ?, ?, ?)");
  const record = (kind: string, courseId: string | undefined, ref: string, data: object) => {
    if (opts.record) note.run(at, kind, courseId ?? null, ref, JSON.stringify(data));
  };
  tx(db, () => {
    // Courses seen before this sync: things in a course that just appeared aren't "new" to you.
    const knownCourse = new Set(listCourses(db).map((c) => c.id));
    for (const c of r.courses ?? []) upsertCourse(db, mergeSyncedCourse(getCourse(db, c.id), c));

    const prevA = db.prepare("SELECT course_id, data FROM assignments WHERE id = ?");
    for (const a of r.assignments ?? []) {
      const before = prevA.get(a.id);
      const old = before ? (JSON.parse(String(before.data)) as Assignment) : undefined;
      // Keep a course you (or an alias) already chose when the source still doesn't know it.
      const courseId = a.courseId === "unassigned" && before ? String(before.course_id) : a.courseId;
      upsertAssignment(db, { ...a, courseId });
      const dated = a.sources.some((s) => DATED_SOURCES.has(s.source));
      if (!dated || !knownCourse.has(courseId)) continue;
      if (!old) record("new-assignment", courseId, a.id, { title: a.title, dueAt: a.dueAt, kind: a.kind });
      else if (old.dueAt && a.dueAt && Math.abs(Date.parse(old.dueAt) - Date.parse(a.dueAt)) > 60_000) {
        record("due-moved", courseId, a.id, { title: a.title, from: old.dueAt, to: a.dueAt });
      }
    }
    const prevG = db.prepare("SELECT data FROM grades WHERE assignment_id = ? AND source = ?");
    for (const g of r.grades ?? []) {
      const before = prevG.get(g.assignmentId, g.source.source);
      const old = before ? (JSON.parse(String(before.data)) as GradeEntry) : undefined;
      upsertGrade(db, g);
      if (g.score === undefined || !knownCourse.has(g.courseId)) continue;
      if (!old || old.score !== g.score || old.pointsPossible !== g.pointsPossible) {
        const title = (r.assignments ?? []).find((a) => a.id === g.assignmentId)?.title;
        record("grade", g.courseId, g.assignmentId, { title, score: g.score, possible: g.pointsPossible, ...(old?.score !== undefined ? { was: old.score } : {}) });
      }
    }
    for (const s of r.schemes ?? []) upsertScheme(db, s);

    const auth = r.authoritative;
    if (auth?.assignments?.length) {
      const keepA = new Set((r.assignments ?? []).map((a) => a.id));
      const gone = prune(db, "assignments", "id", auth.assignments, keepA);
      const delG = db.prepare("DELETE FROM grades WHERE assignment_id = ? AND source != 'manual'");
      for (const id of gone) delG.run(id);
      // A score the instructor took back disappears too (your own entries stay).
      const keepG = new Set((r.grades ?? []).map((g) => g.assignmentId));
      prune(db, "grades", "assignment_id", auth.assignments, keepG, "AND source != 'manual'");
    }

    for (const id of auth?.overall ?? []) db.prepare("DELETE FROM course_overall WHERE course_id = ?").run(id);
    const ov = db.prepare(
      "INSERT INTO course_overall (course_id, source, kind, data) VALUES (?, ?, ?, ?) ON CONFLICT(course_id, source, kind) DO UPDATE SET data=excluded.data",
    );
    for (const o of r.overall ?? []) ov.run(o.courseId, o.source.source, o.kind, JSON.stringify(o));

    const seenAnn = db.prepare("SELECT 1 AS x FROM announcements WHERE id = ?");
    for (const x of r.announcements ?? []) {
      if (!seenAnn.get(x.id) && (!x.courseId || knownCourse.has(x.courseId))) record("announcement", x.courseId, x.id, { title: x.title });
    }
    const ann = db.prepare(
      "INSERT INTO announcements (id, course_id, posted_at, read, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, posted_at=excluded.posted_at, data=excluded.data",
    );
    for (const x of r.announcements ?? []) ann.run(x.id, x.courseId ?? null, x.postedAt, x.read ? 1 : 0, JSON.stringify(x));
    prune(db, "announcements", "id", auth?.announcements, new Set((r.announcements ?? []).map((x) => x.id)));

    const msg = db.prepare(
      "INSERT INTO messages (id, thread_id, course_id, received_at, unread, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, unread=excluded.unread, data=excluded.data",
    );
    for (const x of r.messages ?? []) msg.run(x.id, x.threadId, x.courseId ?? null, x.receivedAt, x.unread ? 1 : 0, JSON.stringify(x));
    if (auth?.messages) prune(db, "messages", "id", ["gmail:"], new Set((r.messages ?? []).map((x) => x.id)));

    const seenFile = db.prepare("SELECT 1 AS x FROM files WHERE id = ?");
    for (const f of r.files ?? []) {
      if (!seenFile.get(f.id) && knownCourse.has(f.courseId)) record("file", f.courseId, f.id, { name: f.name });
    }
    const file = db.prepare(
      "INSERT INTO files (id, course_id, is_syllabus, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, is_syllabus=excluded.is_syllabus, data=excluded.data",
    );
    for (const f of r.files ?? []) file.run(f.id, f.courseId, f.isSyllabus ? 1 : 0, JSON.stringify(f));
    prune(db, "files", "id", auth?.files, new Set((r.files ?? []).map((f) => f.id)));

    const now = new Date().toISOString();
    const page = db.prepare(
      "INSERT INTO course_contents (course_id, fetched_at, data) VALUES (?, ?, ?) ON CONFLICT(course_id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data",
    );
    for (const c of r.contents ?? []) page.run(c.courseId, now, JSON.stringify(c.items));
    if (r.sis) {
      db.prepare("INSERT INTO sis_record (id, fetched_at, data) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data").run(
        r.sis.fetchedAt,
        JSON.stringify(r.sis),
      );
    }
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

export function deleteSetting(db: Db, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

export function allSettings(db: Db): Record<string, string> {
  return Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [String(r.key), String(r.value)]));
}

// ---------- sync log, notifications ----------

export function logSync(db: Db, connector: string, ok: boolean, detail?: string, notes?: string[]): void {
  db.prepare("INSERT INTO sync_log (connector, at, ok, detail, notes) VALUES (?, ?, ?, ?, ?)").run(
    connector,
    new Date().toISOString(),
    ok ? 1 : 0,
    detail ?? null,
    notes?.length ? JSON.stringify(notes) : null,
  );
  // Keep the log small.
  db.prepare("DELETE FROM sync_log WHERE rowid NOT IN (SELECT rowid FROM sync_log ORDER BY rowid DESC LIMIT 500)").run();
}

/** Last time a real source (not your own uploads) synced. */
export function lastSyncAt(db: Db): string | undefined {
  const row = db.prepare("SELECT MAX(at) AS at FROM sync_log WHERE ok = 1 AND connector != 'manual'").get();
  return row?.at ? String(row.at) : undefined;
}

export function lastSync(db: Db, connector: string): { at: string; ok: boolean; detail?: string; notes?: string[] } | undefined {
  const row = db.prepare("SELECT at, ok, detail, notes FROM sync_log WHERE connector = ? ORDER BY rowid DESC LIMIT 1").get(connector);
  if (!row) return undefined;
  return {
    at: String(row.at),
    ok: Boolean(row.ok),
    detail: row.detail ? String(row.detail) : undefined,
    notes: row.notes ? (JSON.parse(String(row.notes)) as string[]) : undefined,
  };
}

export function wasNotified(db: Db, key: string): boolean {
  return Boolean(db.prepare("SELECT 1 AS x FROM notified WHERE key = ?").get(key));
}

export function markNotified(db: Db, keys: string[]): void {
  const at = new Date().toISOString();
  const ins = db.prepare("INSERT OR IGNORE INTO notified (key, at) VALUES (?, ?)");
  tx(db, () => {
    for (const k of keys) ins.run(k, at);
  });
}

const TABLES = [
  "courses", "assignments", "grades", "grading_schemes", "announcements", "messages", "syllabi", "sync_log",
  "settings", "course_aliases", "course_overall", "files", "assignment_overrides", "notified", "course_contents", "sis_record", "changes", "file_text", "file_search",
];

/** Delete every row of school data (the "wipe my data" button). */
export function wipeAll(db: Db): void {
  tx(db, () => {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`);
  });
  try {
    db.exec("VACUUM");
  } catch {
    /* fine: rows are gone either way */
  }
}
