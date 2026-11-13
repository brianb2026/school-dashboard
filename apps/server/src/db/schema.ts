/**
 * SQLite schema (node:sqlite, built into Node 22.13+; no native build step).
 * Each table keeps the typed columns the UI filters/sorts on, plus `data`
 * holding the full record as JSON so the model can grow without migrations.
 * Primary keys are "<source>:<externalId>" so re-syncs upsert instead of duplicating.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    term TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assignments_due ON assignments (due_at);
  CREATE TABLE IF NOT EXISTS grades (
    assignment_id TEXT NOT NULL,
    source TEXT NOT NULL,
    course_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (assignment_id, source)
  );
  CREATE TABLE IF NOT EXISTS grading_schemes (
    course_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attendance (
    course_id TEXT NOT NULL,
    date TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY (course_id, date, source)
  );
  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    course_id TEXT,
    posted_at TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    course_id TEXT,
    received_at TEXT NOT NULL,
    unread INTEGER NOT NULL DEFAULT 1,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS syllabi (
    id TEXT PRIMARY KEY,
    course_id TEXT,
    filename TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    parse TEXT NOT NULL,      -- SyllabusParse JSON, pending your review
    confirmed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sync_log (
    connector TEXT NOT NULL,
    at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    detail TEXT
  );
  `,
];
