import { htmlToText, type Course, type CourseFile } from "@sd/core";
import { AuthExpiredError, HttpError, type ConnectorContext, type SyncResult } from "../types.js";
import type { BlackboardClient } from "./client.js";
import {
  attachmentCandidates,
  isCurrent,
  mapAnnouncements,
  mapAttachment,
  mapAttendance,
  mapCourse,
  mapGradebook,
  mapInlineSyllabus,
  mapInstructors,
  mapLetterScale,
  type BbAnnouncement,
  type BbAttachment,
  type BbAttendanceRecord,
  type BbCategory,
  type BbColumn,
  type BbContent,
  type BbCourseUser,
  type BbGrade,
  type BbMembership,
  type BbSchema,
  type BbSource,
  type BbTerm,
  type BbUser,
} from "./map.js";

const MAX_COURSES = 12;
const MAX_ATTACHMENT_LOOKUPS = 25;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

function why(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 403) return "not shared with students";
    if (e.status === 404) return "not available on this Blackboard";
    return `error ${e.status}`;
  }
  return (e as Error).message || "failed";
}

/**
 * One read-only pass over your Blackboard: current courses, gradebook and
 * your grades, the course total, announcements, and (on a deep pass) files,
 * instructors, the letter scale and attendance. Every optional piece is
 * allowed to fail on its own; what failed is reported in `notes`.
 */
export async function syncBlackboard(client: BlackboardClient, ctx: ConnectorContext, source: BbSource): Promise<SyncResult> {
  const baseUrl = client.base.origin;
  const skipped = new Map<string, Set<string>>();
  let rechecks = 0;
  const attempt = async <T>(what: string, course: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      let reason = why(e);
      if (e instanceof AuthExpiredError) {
        // Some schools answer "sign in" for things students simply may not see.
        // Only treat it as a lost session if the session itself stopped working.
        if (rechecks++ >= 4) throw e;
        const me = await client.json<BbUser>("/learn/api/public/v1/users/me").catch(() => undefined);
        if (!me?.id) throw e;
        reason = "not shared with students";
      }
      const key = `${what}: ${reason}`;
      skipped.set(key, (skipped.get(key) ?? new Set()).add(course));
      return undefined;
    }
  };

  const me = await client.json<BbUser>("/learn/api/public/v1/users/me");
  if (!me?.id) throw new AuthExpiredError();
  const uid = encodeURIComponent(me.id);
  const memberships = await client.all<BbMembership>(`/learn/api/public/v1/users/${uid}/courses?expand=course&limit=100`, 400);

  const terms = new Map<string, BbTerm | undefined>();
  for (const id of new Set(memberships.map((m) => m.course?.termId).filter((x): x is string => Boolean(x)))) {
    if (terms.size >= 12) break;
    terms.set(id, await attempt("term dates", id, () => client.json<BbTerm>(`/learn/api/public/v1/terms/${encodeURIComponent(id)}`)));
  }

  let current = memberships
    .filter((m) => isCurrent(m, m.course?.termId ? terms.get(m.course.termId) : undefined, ctx.now))
    .slice(0, MAX_COURSES);
  let guessed = false;
  if (current.length === 0) {
    // The school's term data didn't single out this term: fall back to the classes you opened most recently.
    const when = (m: BbMembership) => Date.parse(m.lastAccessed ?? m.created ?? m.course?.created ?? "") || 0;
    current = memberships
      .filter((m) => m.course && !m.course.organization && m.availability?.available !== "No" && m.course.availability?.available !== "No")
      .sort((a, b) => when(b) - when(a))
      .slice(0, 8);
    guessed = current.length > 0;
  }

  const result: Required<Pick<SyncResult, "courses" | "assignments" | "grades" | "overall" | "announcements" | "attendanceSummaries" | "files">> & SyncResult = {
    courses: [],
    assignments: [],
    grades: [],
    overall: [],
    announcements: [],
    attendanceSummaries: [],
    files: [],
    authoritative: { assignments: [], announcements: [], files: [], overall: [] },
    notes: [],
  };
  const usedColors = new Set<string>();
  const known: Course[] = [...ctx.knownCourses];

  for (const m of current) {
    const bb = m.course!;
    const term = bb.termId ? terms.get(bb.termId) : undefined;
    const course = mapCourse(bb, term, { baseUrl, source, known, termName: ctx.termName, now: ctx.now, usedColors });
    const prev = known.find((c) => c.id === course.id);
    if (prev?.hidden) continue; // you removed this course; don't spend requests on it
    const cid = encodeURIComponent(bb.id);
    const label = course.code;

    const columns =
      (await attempt("gradebook", label, () => client.all<BbColumn>(`/learn/api/public/v2/courses/${cid}/gradebook/columns?limit=100`))) ??
      (await attempt("gradebook (v1)", label, () => client.all<BbColumn>(`/learn/api/public/v1/courses/${cid}/gradebook/columns?limit=100`)));
    const grades = columns
      ? ((await attempt("your grades", label, () => client.all<BbGrade>(`/learn/api/public/v2/courses/${cid}/gradebook/users/${uid}?limit=100`))) ??
        (await attempt("your grades (v1)", label, () => client.all<BbGrade>(`/learn/api/public/v1/courses/${cid}/gradebook/users/${uid}?limit=100`))))
      : undefined;
    const categories = columns?.some((c) => c.gradebookCategoryId)
      ? await attempt("gradebook categories", label, () => client.all<BbCategory>(`/learn/api/public/v1/courses/${cid}/gradebook/categories?limit=100`))
      : undefined;

    if (columns) {
      const gb = mapGradebook({ courseId: course.id, bbCourseId: bb.id, baseUrl, source, columns, grades: grades ?? [], categories: categories ?? [], now: ctx.now });
      result.assignments.push(...gb.assignments);
      result.grades.push(...gb.grades);
      result.overall.push(...gb.overall);
      if (gb.attendance) result.attendanceSummaries.push(gb.attendance);
      result.authoritative!.assignments!.push(`bb:${bb.id}:`);
      result.authoritative!.overall!.push(course.id);
    }

    const anns = await attempt("announcements", label, () => client.all<BbAnnouncement>(`/learn/api/public/v1/courses/${cid}/announcements?limit=50`, 100));
    if (anns) {
      result.announcements.push(...mapAnnouncements(anns, course.id, bb.id, source, baseUrl, ctx.now));
      result.authoritative!.announcements!.push(`bb:${bb.id}:ann:`);
    }

    if (ctx.deep) {
      const schemas = await attempt("letter scale", label, () => client.all<BbSchema>(`/learn/api/public/v1/courses/${cid}/gradebook/schemas?limit=50`, 50));
      const scale = schemas ? mapLetterScale(schemas) : undefined;
      if (scale) {
        course.letterCutoffs = scale;
        course.letterCutoffsFrom = "blackboard";
      }

      const people = await attempt("instructors", label, () => client.all<BbCourseUser>(`/learn/api/public/v1/courses/${cid}/users?expand=user&limit=100`, 300));
      if (people) course.instructors = mapInstructors(people);

      const att = await attempt("attendance", label, () =>
        client.all<BbAttendanceRecord>(`/learn/api/public/v1/courses/${cid}/meetings/users/${uid}?limit=100`, 300),
      );
      const summary = att ? mapAttendance(att, course.id, source, ctx.now) : undefined;
      if (summary) result.attendanceSummaries.push(summary);

      const contents =
        (await attempt("course files", label, () => client.all<BbContent>(`/learn/api/public/v1/courses/${cid}/contents?recursive=true&limit=200`, 600))) ??
        (await attempt("course files (top level)", label, () => client.all<BbContent>(`/learn/api/public/v1/courses/${cid}/contents?limit=200`, 200)));
      if (contents) {
        const byId = new Map(contents.map((c) => [c.id, c]));
        const fctx = { courseId: course.id, bbCourseId: bb.id, source, now: ctx.now };
        for (const c of contents) {
          const inline = mapInlineSyllabus(c, byId, fctx);
          if (inline) result.files.push(inline);
        }
        for (const c of attachmentCandidates(contents, MAX_ATTACHMENT_LOOKUPS)) {
          const atts = await attempt("file attachments", label, () =>
            client.all<BbAttachment>(`/learn/api/public/v1/courses/${cid}/contents/${encodeURIComponent(c.id)}/attachments`, 20),
          );
          for (const a of atts ?? []) result.files.push(mapAttachment(c, a, byId, fctx));
        }
        result.authoritative!.files!.push(`bbfile:${bb.id}:`);
      }
    }

    result.courses.push(course);
    known.push(course);
  }

  for (const [key, courses] of skipped) {
    result.notes!.push(courses.size > 1 ? `${key} (${courses.size} courses)` : `${key} (${[...courses][0]})`);
  }
  if (guessed) result.notes!.push("Couldn't tell which classes are this term's, so the most recently opened ones are shown. Hide any that don't belong (Settings → Classes).");
  result.notes!.unshift(
    `${result.courses.length} course${result.courses.length === 1 ? "" : "s"}, ${result.assignments.length} gradebook items, ${result.grades.length} grades` +
      (ctx.deep ? `, ${result.files.length} files` : "") +
      ` (${client.requests} requests)`,
  );
  return result;
}

/** Fetch one course file (or a syllabus typed into a page) through the linked session. */
export async function downloadBlackboardFile(client: BlackboardClient, file: CourseFile): Promise<{ bytes: Uint8Array; filename: string }> {
  if (!file.url.startsWith("/learn/api/public/")) throw new Error("Not a Blackboard file");
  if (file.id.endsWith(":body")) {
    const c = await client.json<BbContent>(file.url);
    const text = htmlToText(c.body ?? c.description ?? "");
    return { bytes: new TextEncoder().encode(text), filename: file.name };
  }
  const got = await client.download(file.url, MAX_FILE_BYTES);
  return { bytes: got.bytes, filename: file.name || got.filename || "file" };
}
