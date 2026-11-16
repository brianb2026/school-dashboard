import { decodeEntities, htmlToText, type Course, type CourseFile } from "@sd/core";
import { AuthExpiredError, HttpError, type ConnectorContext, type SyncResult } from "../types.js";
import type { BlackboardClient } from "./client.js";
import {
  gradescopeLaunchPaths,
  mapContentTree,
  indexContents,
  isCurrent,
  mapAnnouncements,
  mapContentFiles,
  mapCourse,
  mapGradebook,
  mapInstructors,
  mapLetterScale,
  type BbAnnouncement,
  type BbAttachment,
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
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

function why(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 403) return "not shared with students";
    if (e.status === 404 || e.status === 400) return "not available on this Blackboard";
    return `error ${e.status}`;
  }
  return (e as Error).message || "failed";
}

/**
 * One read-only pass over your Blackboard: current courses, gradebook and
 * your grades, the course total, announcements and the course's content
 * (files, where the syllabus is, links into Gradescope); on a deep pass also
 * instructors and the letter scale. Every optional piece is allowed to fail
 * on its own; what failed is reported in `notes`.
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

  const result: Required<Pick<SyncResult, "courses" | "assignments" | "grades" | "overall" | "announcements" | "files">> & SyncResult = {
    courses: [],
    assignments: [],
    grades: [],
    overall: [],
    announcements: [],
    files: [],
    authoritative: { assignments: [], announcements: [], files: [], overall: [] },
    notes: [],
    extras: { gradescopeLaunch: [] },
  };
  if (me.name?.given?.trim()) result.extras!.studentName = me.name.given.trim();
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

    // The content list first: it says where each gradebook item lives and which ones are Gradescope links.
    const contents =
      (await attempt("course files", label, () => client.all<BbContent>(`/learn/api/public/v1/courses/${cid}/contents?recursive=true&limit=200`, 1000))) ??
      (await attempt("course files (top level)", label, () => client.all<BbContent>(`/learn/api/public/v1/courses/${cid}/contents?limit=200`, 200)));
    const index = contents ? indexContents(contents, baseUrl, bb.id) : undefined;
    if (contents) {
      result.files.push(...mapContentFiles(contents, { courseId: course.id, bbCourseId: bb.id, source, now: ctx.now }));
      result.authoritative!.files!.push(`bbfile:${bb.id}:`);
      result.extras!.gradescopeLaunch!.push(...gradescopeLaunchPaths(contents, bb.id).slice(0, 2));
      (result.contents ??= []).push({ courseId: course.id, items: mapContentTree(contents, baseUrl, bb.id) });
    }

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
      const gb = mapGradebook({
        courseId: course.id,
        bbCourseId: bb.id,
        baseUrl,
        source,
        columns,
        grades: grades ?? [],
        categories: categories ?? [],
        contents: index,
        now: ctx.now,
      });
      result.assignments.push(...gb.assignments);
      result.grades.push(...gb.grades);
      result.overall.push(...gb.overall);
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
    }

    result.courses.push(course);
    known.push(course);
  }

  for (const [key, courses] of skipped) {
    result.notes!.push(courses.size > 1 ? `${key} (${courses.size} courses)` : `${key} (${[...courses][0]})`);
  }
  if (guessed) result.notes!.push("Couldn't tell which classes are this term's, so the most recently opened ones are shown. Hide any that don't belong (Settings → Classes).");
  const syllabi = result.files.filter((f) => f.isSyllabus).length;
  result.notes!.unshift(
    `${result.courses.length} course${result.courses.length === 1 ? "" : "s"}, ${result.assignments.length} gradebook items, ${result.grades.length} grades, ` +
      `${result.files.length} files (${syllabi} syllabus/schedule) (${client.requests} requests)`,
  );
  return result;
}

/**
 * Fetch one course file through the linked session. Blackboard hands out
 * short-lived download addresses, so the address is looked up fresh each time:
 *   …/contents/{id}/attachments   a plain file item
 *   …/contents/{id}#xid-123_1     a file embedded in a document
 *   …/contents/{id}  (":body")    a page whose text is the document
 */
export async function downloadBlackboardFile(client: BlackboardClient, file: CourseFile): Promise<{ bytes: Uint8Array; filename: string }> {
  if (!file.url.startsWith("/learn/api/public/")) throw new Error("Not a Blackboard file");
  if (file.id.endsWith(":body")) {
    const c = await client.json<BbContent>(file.url);
    return { bytes: new TextEncoder().encode(htmlToText(c.body ?? c.description ?? "")), filename: file.name };
  }
  const [path, mark] = file.url.split("#");
  if (mark?.startsWith("xid-")) {
    const c = await client.json<BbContent>(path!);
    let found: string | undefined;
    for (const m of (c.body ?? "").matchAll(/\bhref="([^"]*)"/gi)) {
      const href = decodeEntities(m[1]!);
      if (href.includes(`/${mark}`)) {
        found = href;
        break;
      }
    }
    if (!found) throw new HttpError(404, "That file is no longer in the course");
    const u = new URL(found, client.base);
    if (u.origin !== client.base.origin) throw new Error("Refusing a file address outside Blackboard");
    const got = await client.download(u.pathname + u.search, MAX_FILE_BYTES);
    return { bytes: got.bytes, filename: file.name || got.filename || "file" };
  }
  if (path!.endsWith("/attachments")) {
    const atts = await client.all<BbAttachment>(path!, 20);
    const pick = atts.find((a) => a.fileName === file.name) ?? atts[0];
    if (!pick) throw new HttpError(404, "That file is no longer in the course");
    const got = await client.download(`${path}/${encodeURIComponent(pick.id)}/download`, MAX_FILE_BYTES);
    return { bytes: got.bytes, filename: file.name || pick.fileName || got.filename || "file" };
  }
  const got = await client.download(path!, MAX_FILE_BYTES);
  return { bytes: got.bytes, filename: file.name || got.filename || "file" };
}
