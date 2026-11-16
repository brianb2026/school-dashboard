import {
  htmlToText,
  type Announcement,
  type Assignment,
  type AssignmentStatus,
  type ContentItem,
  type Course,
  type CourseFile,
  type CourseOverall,
  type GradeEntry,
  type GradingScheme,
  type Person,
} from "@sd/core";
import { displayCode, prettyTerm } from "../blackboard/map.js";
import { normalizeBaseUrl } from "../blackboard/session.js";
import { guessKind } from "../kinds.js";
import { CookieJar, type FetchLike } from "../net.js";
import { AuthExpiredError, type Connector, type ConnectorContext, type SyncResult } from "../types.js";
import { CanvasClient } from "./client.js";

/** Vault keys: the session from your own sign-in, or a personal access token you made in Canvas. */
export const CANVAS_COOKIES = "canvas.session.cookies";
export const CANVAS_TOKEN = "canvas.token";
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const DAY = 86_400_000;
const COLORS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];

// ---------- Canvas API shapes (the fields used here; see canvas.instructure.com/doc/api) ----------

export interface CvTerm {
  name?: string;
  start_at?: string | null;
  end_at?: string | null;
}
export interface CvEnrollment {
  type?: string;
  computed_current_score?: number | null;
  computed_current_grade?: string | null;
}
export interface CvCourse {
  id: string;
  name?: string;
  course_code?: string;
  workflow_state?: string;
  start_at?: string | null;
  end_at?: string | null;
  access_restricted_by_date?: boolean;
  apply_assignment_group_weights?: boolean;
  syllabus_body?: string | null;
  term?: CvTerm;
  enrollments?: CvEnrollment[];
  teachers?: { display_name?: string }[];
}
export interface CvSubmission {
  score?: number | null;
  grade?: string | null;
  workflow_state?: string;
  submitted_at?: string | null;
  graded_at?: string | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean | null;
}
export interface CvAssignment {
  id: string;
  name?: string;
  due_at?: string | null;
  points_possible?: number | null;
  html_url?: string;
  submission_types?: string[];
  omit_from_final_grade?: boolean;
  quiz_id?: string;
  discussion_topic?: { id?: string };
  published?: boolean;
  submission?: CvSubmission;
}
export interface CvGroup {
  id: string;
  name?: string;
  group_weight?: number;
  rules?: { drop_lowest?: number };
  assignments?: CvAssignment[];
}
export interface CvAnnouncement {
  id: string;
  title?: string;
  message?: string;
  posted_at?: string;
  context_code?: string;
  read_state?: string;
  html_url?: string;
  author?: { display_name?: string };
}
export interface CvModuleItem {
  id: string;
  title?: string;
  type?: string;
  content_id?: string;
  html_url?: string;
  external_url?: string;
  indent?: number;
}
export interface CvModule {
  id: string;
  name?: string;
  published?: boolean;
  items?: CvModuleItem[];
}
export interface CvFile {
  id: string;
  display_name?: string;
  filename?: string;
  folder_id?: string;
  "content-type"?: string;
  updated_at?: string;
  url?: string;
}
export interface CvFolder {
  id: string;
  full_name?: string;
}

// ---------- mapping ----------

/** Is this a class happening now (not last year's, not one that hasn't opened)? */
export function canvasCurrent(c: CvCourse, now: Date): boolean {
  if (c.access_restricted_by_date || c.workflow_state === "deleted") return false;
  const start = c.term?.start_at ?? c.start_at;
  const end = c.term?.end_at ?? c.end_at;
  const t = now.getTime();
  if (start && t < Date.parse(start) - 21 * DAY) return false;
  if (end && t > Date.parse(end) + 21 * DAY) return false;
  return true;
}

function statusOf(s: CvSubmission | undefined, due: string | null | undefined, now: Date): AssignmentStatus {
  if (!s) return due && Date.parse(due) < now.getTime() ? "late" : "upcoming";
  if (s.excused) return "excused";
  if (s.workflow_state === "graded" && s.score !== null && s.score !== undefined) return "graded";
  if (s.submitted_at || s.workflow_state === "submitted" || s.workflow_state === "pending_review") return "submitted";
  if (s.missing) return "missing";
  if (s.late || (due && Date.parse(due) < now.getTime())) return "late";
  return "upcoming";
}

function kindOf(a: CvAssignment) {
  const types = a.submission_types ?? [];
  if (types.includes("online_quiz") || a.quiz_id) return "quiz" as const;
  if (types.includes("discussion_topic")) return "discussion" as const;
  return guessKind(a.name ?? "");
}

/** Canvas links an assignment to its module item by the thing it is: a quiz, a discussion, or the assignment. */
export function contentKey(a: CvAssignment): string {
  if (a.quiz_id) return `q:${a.quiz_id}`;
  if (a.discussion_topic?.id) return `d:${a.discussion_topic.id}`;
  return `a:${a.id}`;
}

export interface CanvasCourseData {
  course: CvCourse;
  groups: CvGroup[];
  modules?: CvModule[];
  files?: CvFile[];
  folders?: CvFolder[];
}

/** One Canvas course → the dashboard's model. Pure, so every rule is testable. */
export function mapCanvasCourse(data: CanvasCourseData, ctx: { baseUrl: string; known: Course[]; usedColors: Set<string>; now: Date; termName: string }): Required<Pick<SyncResult, "courses" | "assignments" | "grades" | "overall" | "files" | "schemes">> & { contents: ContentItem[] } {
  const c = data.course;
  const fetchedAt = ctx.now.toISOString();
  const code = displayCode({ id: c.id, courseId: c.course_code, name: c.name });
  const id = `canvas:${c.id}`;
  const prev = ctx.known.find((k) => k.id === id);
  const taken = new Set([...ctx.known.map((k) => k.color), ...ctx.usedColors]);
  const color = prev?.color ?? COLORS.find((x) => !taken.has(x)) ?? COLORS[ctx.usedColors.size % COLORS.length]!;
  ctx.usedColors.add(color);
  const url = `${ctx.baseUrl}/courses/${encodeURIComponent(c.id)}`;
  const source = { source: "canvas" as const, externalId: c.id, url, fetchedAt };
  const instructors: Person[] = (c.teachers ?? []).filter((t) => t.display_name).map((t) => ({ name: t.display_name!, role: "instructor" as const }));
  const name = (c.name ?? code).replace(new RegExp(`^${code.replace(" ", "[\\s\\-_]?")}[\\s\\-:–—|0-9]*`, "i"), "").trim() || c.name || code;

  const course: Course = {
    id,
    code,
    name,
    term: prettyTerm(c.term?.name) ?? prev?.term ?? ctx.termName,
    credits: prev?.credits ?? 3,
    level: prev?.level ?? "regular",
    color,
    instructors,
    meetings: prev?.meetings ?? [],
    url,
    sources: [source],
  };

  const assignments: Assignment[] = [];
  const grades: GradeEntry[] = [];
  for (const g of data.groups) {
    for (const a of g.assignments ?? []) {
      if (a.published === false) continue;
      const aid = `cv:${c.id}:${a.id}`;
      const s = a.submission;
      const status = statusOf(s, a.due_at, ctx.now);
      const possible = typeof a.points_possible === "number" ? a.points_possible : undefined;
      assignments.push({
        id: aid,
        courseId: id,
        title: a.name?.trim() || "(no title)",
        kind: kindOf(a),
        category: g.name,
        dueAt: a.due_at ?? undefined,
        pointsPossible: possible,
        status,
        submittable: false,
        countsTowardGrade: !a.omit_from_final_grade,
        url: a.html_url,
        contentId: contentKey(a),
        attachments: [],
        sources: [{ source: "canvas", externalId: a.id, url: a.html_url, fetchedAt }],
      });
      if (status === "graded" && typeof s?.score === "number" && possible && possible > 0) {
        grades.push({
          assignmentId: aid,
          courseId: id,
          score: s.score,
          pointsPossible: possible,
          gradedAt: s.graded_at ?? undefined,
          source: { source: "canvas", externalId: a.id, fetchedAt },
        });
      }
    }
  }

  // Weights only when the course actually uses them ("weight final grade by group").
  const weighted = data.groups.filter((g) => (g.group_weight ?? 0) > 0);
  const schemes: GradingScheme[] =
    c.apply_assignment_group_weights && weighted.length
      ? [{ courseId: id, categories: weighted.map((g) => ({ name: g.name ?? "Group", weight: g.group_weight!, ...(g.rules?.drop_lowest ? { dropLowest: g.rules.drop_lowest } : {}) })), source }]
      : [];

  const mine = (c.enrollments ?? []).find((e) => e.type === "student" || e.type === "StudentEnrollment") ?? c.enrollments?.[0];
  const overall: CourseOverall[] =
    typeof mine?.computed_current_score === "number"
      ? [{ courseId: id, kind: "weighted-total", label: "Total", percent: mine.computed_current_score, letter: mine.computed_current_grade ?? undefined, source }]
      : [];

  const { files, contents } = mapCanvasContent(data, id, ctx.baseUrl, fetchedAt);
  return { courses: [course], assignments, grades, overall, files, schemes, contents };
}

const ITEM_KIND: Record<string, ContentItem["kind"]> = {
  File: "file",
  Page: "page",
  Assignment: "assignment",
  Quiz: "test",
  Discussion: "discussion",
  ExternalUrl: "link",
  ExternalTool: "tool",
  SubHeader: "other",
};
const TOOLS: [RegExp, string][] = [
  [/gradescope/i, "Gradescope"],
  [/qwickly/i, "Qwickly"],
  [/panopto/i, "Panopto"],
  [/zoom/i, "Zoom"],
  [/perusall/i, "Perusall"],
  [/piazza/i, "Piazza"],
  [/top ?hat/i, "Top Hat"],
  [/mcgraw|connect/i, "McGraw Hill"],
  [/pearson|mylab|mastering/i, "Pearson"],
  [/webassign|cengage/i, "Cengage"],
];
const SYLLABUS = /syllab|course\s*(schedule|outline|calendar)/i;
const READABLE = /\.(pdf|docx|txt|md)$/i;

/** Modules become the course page's folders; files come from the Files list when students may see it, else from modules. */
function mapCanvasContent(data: CanvasCourseData, courseId: string, baseUrl: string, fetchedAt: string): { files: CourseFile[]; contents: ContentItem[] } {
  const c = data.course;
  const cid = encodeURIComponent(c.id);
  const folderOf = new Map((data.folders ?? []).map((f) => [f.id, (f.full_name ?? "").split("/").slice(1).filter(Boolean)]));
  const files: CourseFile[] = [];
  const seen = new Set<string>();
  const addFile = (id: string, name: string, folder: string[], modified?: string, contentId?: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    files.push({
      id: `cvfile:${c.id}:${id}`,
      courseId,
      name,
      folder,
      url: `/api/v1/courses/${cid}/files/${encodeURIComponent(id)}`,
      isSyllabus: READABLE.test(name) && (SYLLABUS.test(name) || folder.some((x) => SYLLABUS.test(x))),
      modified,
      contentId,
      source: { source: "canvas", externalId: id, fetchedAt },
    });
  };
  for (const f of data.files ?? []) addFile(f.id, f.display_name || f.filename || "file", folderOf.get(f.folder_id ?? "") ?? [], f.updated_at);

  const contents: ContentItem[] = [];
  for (const m of data.modules ?? []) {
    if (m.published === false) continue;
    const mid = `m:${m.id}`;
    contents.push({ id: mid, title: m.name?.trim() || "Module", kind: "folder", url: `${baseUrl}/courses/${cid}/modules/${encodeURIComponent(m.id)}` });
    for (const it of m.items ?? []) {
      const kind = ITEM_KIND[it.type ?? ""] ?? "other";
      // Same ids the assignments carry (contentKey), so dates and scores line up beside them.
      const id =
        it.type === "Assignment" ? `a:${it.content_id}` : it.type === "Quiz" ? `q:${it.content_id}` : it.type === "Discussion" ? `d:${it.content_id}` : `i:${it.id}`;
      const title = it.title?.trim() || "Untitled";
      const href = kind === "link" && it.external_url && /^https?:\/\//i.test(it.external_url) ? it.external_url : undefined;
      const tool = kind === "tool" ? TOOLS.find(([re]) => re.test(`${title} ${it.external_url ?? ""}`))?.[1] : undefined;
      contents.push({ id, parentId: mid, title, kind, url: it.html_url, ...(href ? { href } : {}), ...(tool ? { tool } : {}) });
      // A file shown in a module is downloadable even when the Files list is hidden from students.
      if (it.type === "File" && it.content_id) {
        const known = files.find((f) => f.id === `cvfile:${c.id}:${it.content_id}`);
        if (known) known.contentId ??= id;
        else addFile(it.content_id, title, [m.name?.trim() || "Modules"], undefined, id);
      }
    }
  }

  // The syllabus typed into Canvas's Syllabus page: its text is the "file".
  const body = c.syllabus_body ?? "";
  if (htmlToText(body).length >= 200) {
    files.push({
      id: `cvfile:${c.id}:syllabus-body`,
      courseId,
      name: "Syllabus (Canvas page).txt",
      folder: ["Syllabus"],
      mimeType: "text/plain",
      url: `/api/v1/courses/${cid}?include[]=syllabus_body`,
      isSyllabus: true,
      source: { source: "canvas", externalId: `${c.id}:syllabus`, fetchedAt },
    });
  }
  return { files, contents };
}

export function mapCanvasAnnouncement(a: CvAnnouncement, fetchedAt: string): Announcement {
  const course = /^course_(.+)$/.exec(a.context_code ?? "")?.[1];
  return {
    id: `cv:ann:${a.id}`,
    courseId: course ? `canvas:${course}` : undefined,
    title: htmlToText(a.title ?? "") || "(no title)",
    body: htmlToText(a.message ?? ""),
    postedAt: a.posted_at ?? fetchedAt,
    author: a.author?.display_name,
    read: a.read_state === "read",
    source: { source: "canvas", externalId: a.id, url: a.html_url, fetchedAt },
  };
}

// ---------- the connector ----------

async function openCanvas(ctx: ConnectorContext): Promise<{ client: CanvasClient; jar?: CookieJar } | undefined> {
  const baseUrl = normalizeBaseUrl(ctx.env.CANVAS_BASE_URL);
  if (!baseUrl) return undefined;
  const token = await ctx.secrets.get(CANVAS_TOKEN);
  const gap = ctx.env.CANVAS_REQUEST_GAP_MS ? Number(ctx.env.CANVAS_REQUEST_GAP_MS) : undefined;
  if (token) return { client: new CanvasClient({ baseUrl, fetch: ctx.fetch, token, minIntervalMs: gap }) };
  const saved = await ctx.secrets.get(CANVAS_COOKIES);
  if (!saved) return undefined;
  const jar = CookieJar.parse(saved);
  return { client: new CanvasClient({ baseUrl, fetch: ctx.fetch, jar, minIntervalMs: gap }), jar };
}

/** Who this Canvas session (or token) belongs to; undefined = not signed in. */
export async function canvasUser(baseUrl: string, auth: { jar?: CookieJar; token?: string }, fetchImpl: FetchLike): Promise<{ id: string; name?: string } | undefined> {
  if (!auth.token && (!auth.jar || auth.jar.size === 0)) return undefined;
  try {
    const client = new CanvasClient({ baseUrl, fetch: fetchImpl, ...auth, minIntervalMs: 0, timeoutMs: 10_000 });
    const me = await client.json<{ id?: string; name?: string; short_name?: string }>("/api/v1/users/self");
    if (!me?.id) return undefined;
    return { id: String(me.id), name: (me.short_name || me.name || "").trim().split(/\s+/)[0] || undefined };
  } catch {
    return undefined;
  }
}

/**
 * Canvas through your own sign-in (or a token you made). Read-only: courses,
 * assignments with your scores, assignment-group weights, the course total
 * Canvas shows you, announcements, modules (the course page) and files.
 */
export const canvas: Connector = {
  id: "canvas",
  label: "Canvas",
  capabilities: ["courses", "assignments", "grades", "announcements", "download"],
  async status(ctx) {
    if (!normalizeBaseUrl(ctx.env.CANVAS_BASE_URL)) return { state: "not-configured", detail: "Not linked yet" };
    if (!(await ctx.secrets.get(CANVAS_TOKEN)) && !(await ctx.secrets.get(CANVAS_COOKIES))) return { state: "not-configured", detail: "Not linked yet" };
    if (ctx.env.CANVAS_SESSION_EXPIRED === "true") return { state: "needs-sign-in", detail: "Sign-in expired. Reconnect to keep syncing." };
    return { state: "ready" };
  },
  async sync(ctx) {
    const s = await openCanvas(ctx);
    if (!s) return {};
    try {
      return await syncCanvas(s.client, ctx);
    } finally {
      if (s.jar?.dirty) await ctx.secrets.set(CANVAS_COOKIES, s.jar.serialize());
    }
  },
  async download(ctx, file) {
    const s = await openCanvas(ctx);
    if (!s) throw new Error("Canvas is not linked");
    try {
      if (file.id.endsWith(":syllabus-body")) {
        const course = await s.client.json<CvCourse>(file.url);
        return { bytes: new TextEncoder().encode(htmlToText(course.syllabus_body ?? "")), filename: file.name };
      }
      const meta = await s.client.json<CvFile>(file.url);
      if (!meta.url) throw new Error("Canvas gave no download address for this file");
      const got = await s.client.download(meta.url, MAX_FILE_BYTES);
      return { bytes: got.bytes, filename: meta.display_name || meta.filename || file.name };
    } finally {
      if (s.jar?.dirty) await ctx.secrets.set(CANVAS_COOKIES, s.jar.serialize());
    }
  },
};

export async function syncCanvas(client: CanvasClient, ctx: ConnectorContext): Promise<SyncResult> {
  const baseUrl = client.base.origin;
  const fetchedAt = ctx.now.toISOString();
  const me = await client.json<{ id?: string; name?: string; short_name?: string }>("/api/v1/users/self");
  if (!me?.id) throw new AuthExpiredError();
  const result: SyncResult & Required<Pick<SyncResult, "courses" | "assignments" | "grades" | "overall" | "files" | "schemes" | "announcements" | "notes">> = {
    courses: [],
    assignments: [],
    grades: [],
    overall: [],
    files: [],
    schemes: [],
    announcements: [],
    contents: [],
    notes: [],
    authoritative: { assignments: [], announcements: [], files: [], overall: [] },
    extras: {},
  };
  const first = (me.short_name || me.name || "").trim().split(/\s+/)[0];
  if (first) result.extras!.studentName = first;

  const all = await client.all<CvCourse>("/api/v1/courses?enrollment_state=active&include[]=term&include[]=total_scores&include[]=teachers&include[]=syllabus_body&per_page=100", 200);
  const current = all.filter((c) => canvasCurrent(c, ctx.now));
  const usedColors = new Set<string>();
  const skipped = new Map<string, string[]>();
  const attempt = async <T>(what: string, label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AuthExpiredError) throw e;
      skipped.set(what, [...(skipped.get(what) ?? []), label]);
      return undefined;
    }
  };

  for (const c of current) {
    const prev = ctx.knownCourses.find((k) => k.id === `canvas:${c.id}`);
    if (prev?.hidden) continue;
    const cid = encodeURIComponent(c.id);
    const label = displayCode({ id: c.id, courseId: c.course_code, name: c.name });
    const groups = (await attempt("assignments", label, () => client.all<CvGroup>(`/api/v1/courses/${cid}/assignment_groups?include[]=assignments&include[]=submission&per_page=100`, 300))) ?? [];
    const modules = ctx.deep ? await attempt("modules", label, () => client.all<CvModule>(`/api/v1/courses/${cid}/modules?include[]=items&per_page=100`, 300)) : undefined;
    const files = ctx.deep ? await attempt("files (hidden from students)", label, () => client.all<CvFile>(`/api/v1/courses/${cid}/files?per_page=100`, 500)) : undefined;
    const folders = files ? await attempt("folders", label, () => client.all<CvFolder>(`/api/v1/courses/${cid}/folders?per_page=100`, 300)) : undefined;
    const m = mapCanvasCourse({ course: c, groups, modules, files, folders }, { baseUrl, known: ctx.knownCourses, usedColors, now: ctx.now, termName: ctx.termName });
    result.courses.push(...m.courses);
    result.assignments.push(...m.assignments);
    result.grades.push(...m.grades);
    result.overall.push(...m.overall);
    result.schemes.push(...m.schemes);
    result.authoritative!.assignments!.push(`cv:${c.id}:`);
    result.authoritative!.overall!.push(`canvas:${c.id}`);
    if (ctx.deep) {
      result.files.push(...m.files);
      result.authoritative!.files!.push(`cvfile:${c.id}:`);
      if (modules) result.contents!.push({ courseId: `canvas:${c.id}`, items: m.contents });
    }
  }

  if (current.length) {
    const codes = current.map((c) => `context_codes[]=course_${encodeURIComponent(c.id)}`).join("&");
    const start = new Date(ctx.now.getTime() - 120 * DAY).toISOString().slice(0, 10);
    const anns = await attempt("announcements", "all classes", () => client.all<CvAnnouncement>(`/api/v1/announcements?${codes}&start_date=${start}&per_page=50`, 150));
    if (anns) {
      result.announcements.push(...anns.map((a) => mapCanvasAnnouncement(a, fetchedAt)));
      result.authoritative!.announcements!.push("cv:ann:");
    }
  }
  for (const [what, labels] of skipped) result.notes.push(`${what}: not shared with students (${labels.length} course${labels.length === 1 ? "" : "s"})`);
  return result;
}
