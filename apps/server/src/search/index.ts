import { extractPages } from "@sd/syllabus-parser";
import type { CourseFile } from "@sd/core";
import type { AppContext } from "../app.js";
import { getSetting, listFiles, type Db } from "../db/client.js";
import { loadFile } from "../routes/files.js";

/** Bigger files are left out of the search (and not fetched just for it). */
const MAX_INDEX_BYTES = 25 * 1024 * 1024;
const READABLE = /\.(pdf|pptx|docx|txt|md)$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The version a file's index belongs to: a changed file is read again. */
const versionOf = (f: CourseFile) => `${f.modified ?? ""}`;

export interface SearchHit {
  fileId: string;
  name: string;
  courseId: string;
  /** 1-based page (PDF) or slide (PowerPoint); 1 for single-page kinds. */
  page: number;
  /** Words around the match; the matched words are wrapped in [[ ]]. */
  snippet: string;
}

/**
 * Read a few more course files into the search index. Runs after each sync,
 * a handful at a time with a pause between them, so the school's server sees
 * a trickle, not a flood. Files already opened come from the offline cache.
 */
export async function indexSome(ctx: AppContext, max = 25, gapMs = 1500, load: (ctx: AppContext, f: CourseFile) => Promise<Uint8Array> = loadFile): Promise<number> {
  const { db } = ctx;
  if (getSetting(db, "FILE_SEARCH") === "off") return 0;
  const files = listFiles(db);
  const ids = new Set(files.map((f) => f.id));
  // Forget files that are gone.
  for (const r of db.prepare("SELECT file_id FROM file_text").all()) {
    const id = String(r.file_id);
    if (!ids.has(id)) forget(db, id);
  }
  const state = new Map(db.prepare("SELECT file_id, version, status FROM file_text").all().map((r) => [String(r.file_id), { version: String(r.version), status: String(r.status) }]));
  const todo = files.filter((f) => READABLE.test(f.name) && state.get(f.id)?.version !== versionOf(f));
  let done = 0;
  for (const f of todo.slice(0, max)) {
    let pages: string[] | undefined;
    let status = "ok";
    try {
      const bytes = await load(ctx, f);
      if (bytes.byteLength > MAX_INDEX_BYTES) status = "too-big";
      else pages = await extractPages(bytes, f.name);
      if (!pages) status = status === "ok" ? "no-text" : status;
    } catch {
      status = "failed";
    }
    forget(db, f.id);
    const ins = db.prepare("INSERT INTO file_search (file_id, page, name, body) VALUES (?, ?, ?, ?)");
    (pages ?? []).forEach((text, i) => {
      if (text.trim()) ins.run(f.id, i + 1, f.name, text.slice(0, 200_000));
    });
    db.prepare("INSERT INTO file_text (file_id, course_id, version, pages, status) VALUES (?, ?, ?, ?, ?)").run(f.id, f.courseId, versionOf(f), pages?.length ?? 0, status);
    done++;
    if (gapMs) await sleep(gapMs);
  }
  return done;
}

function forget(db: Db, fileId: string): void {
  db.prepare("DELETE FROM file_search WHERE file_id = ?").run(fileId);
  db.prepare("DELETE FROM file_text WHERE file_id = ?").run(fileId);
}

/** "amortized heap" → every word must appear, each as a word start ("heap" finds "heaps"). */
function ftsQuery(q: string): string | undefined {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(" AND ") : undefined;
}

/** Search inside course files: best matches first, one hit per file page. */
export function searchFiles(db: Db, q: string, visibleCourses: Set<string>, limit = 20): SearchHit[] {
  const match = ftsQuery(q);
  if (!match) return [];
  const courseOf = new Map(db.prepare("SELECT file_id, course_id FROM file_text").all().map((r) => [String(r.file_id), String(r.course_id)]));
  const rows = db
    .prepare("SELECT file_id, page, name, snippet(file_search, 3, '[[', ']]', '…', 14) AS snip FROM file_search WHERE file_search MATCH ? ORDER BY bm25(file_search, 0, 0, 4, 1) LIMIT ?")
    .all(match, limit * 3);
  const out: SearchHit[] = [];
  for (const r of rows) {
    const courseId = courseOf.get(String(r.file_id));
    if (!courseId || !visibleCourses.has(courseId)) continue;
    out.push({ fileId: String(r.file_id), name: String(r.name), courseId, page: Number(r.page), snippet: String(r.snip).replace(/\s+/g, " ").trim() });
    if (out.length >= limit) break;
  }
  return out;
}

/** How far the index has got. */
export function indexStatus(db: Db): { indexed: number; readable: number; on: boolean } {
  const readable = listFiles(db).filter((f) => READABLE.test(f.name)).length;
  const indexed = Number(db.prepare("SELECT count(*) AS n FROM file_text").get()?.n ?? 0);
  return { indexed: Math.min(indexed, readable), readable, on: getSetting(db, "FILE_SEARCH") !== "off" };
}
