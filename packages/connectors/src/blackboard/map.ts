/**
 * Pure mapping from Blackboard Learn REST JSON to the dashboard's model.
 * No network here, so every rule can be tested against recorded shapes.
 * Field names follow the public API docs (developer.anthology.com); the
 * Ultra-specific shapes (documents with embedded files, LTI links) were
 * checked against a real Learn Ultra site.
 */
import {
  courseKey,
  decodeEntities,
  htmlToText,
  type Announcement,
  type Assignment,
  type ContentItem,
  type Course,
  type CourseFile,
  type CourseOverall,
  type GradeEntry,
  type LetterCutoff,
  type Person,
  type SourceRef,
} from "@sd/core";
import { guessKind } from "../kinds.js";

export type BbSource = "blackboard-session" | "blackboard-rest";

export interface BbUser {
  id: string;
  userName?: string;
  name?: { given?: string; family?: string };
  contact?: { email?: string };
}
interface BbDuration {
  type?: string;
  start?: string;
  end?: string;
}
export interface BbCourse {
  id: string;
  courseId?: string;
  name?: string;
  termId?: string;
  organization?: boolean;
  created?: string;
  availability?: { available?: string; duration?: BbDuration };
}
export interface BbMembership {
  courseId: string;
  courseRoleId?: string;
  created?: string;
  lastAccessed?: string;
  availability?: { available?: string };
  course?: BbCourse;
}
export interface BbTerm {
  id: string;
  name?: string;
  availability?: { duration?: BbDuration };
}
export interface BbColumn {
  id: string;
  name?: string;
  displayName?: string;
  contentId?: string;
  score?: { possible?: number };
  grading?: { type?: string; due?: string };
  gradebookCategoryId?: string;
  includeInCalculations?: boolean;
  availability?: { available?: string };
}
export interface BbGrade {
  columnId: string;
  status?: string;
  score?: number;
  text?: string;
  displayGrade?: { scaleType?: string; score?: number; possible?: number; text?: string };
  exempt?: boolean;
  lastRelevantDate?: string;
}
export interface BbCategory {
  id: string;
  title?: string;
}
export interface BbSchema {
  id: string;
  title?: string;
  scaleType?: string;
  symbols?: { text?: string; lowerBound?: number }[];
}
export interface BbAnnouncement {
  id: string;
  title?: string;
  body?: string;
  draft?: boolean;
  created?: string;
  modified?: string;
  creator?: string;
  availability?: { duration?: BbDuration };
}
export interface BbContent {
  id: string;
  parentId?: string;
  title?: string;
  body?: string;
  description?: string;
  modified?: string;
  availability?: { available?: string };
  contentHandler?: { id?: string; url?: string; file?: { fileName?: string }; customParameters?: Record<string, string> };
  links?: { href?: string; rel?: string }[];
}
export interface BbAttachment {
  id: string;
  fileName?: string;
  mimeType?: string;
}
export interface BbCourseUser {
  courseRoleId?: string;
  user?: BbUser;
}

const DAY = 86_400_000;
const SEASON = /^(FALL|FA|SPRING|SPR|SP|SUMMER|SUM|SU|WINTER|WIN|WI|TERM|SEM|AY|FY)$/;
const COLORS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];

/** "CSC172.2026FALL.80123", "2027SP-CHEM-101-01", "Intro (MTH 161)" → "CSC 172", "CHEM 101", "MTH 161". */
export function displayCode(course: BbCourse): string {
  for (const text of [course.courseId ?? "", course.name ?? ""]) {
    for (const m of text.matchAll(/(?<![A-Za-z])([A-Za-z]{2,5})[\s\-_.]?(\d{2,4}[A-Za-z]?)(?!\d)/g)) {
      const letters = m[1]!.toUpperCase();
      // "FALL2026", "SP27" are terms, not course codes.
      if (SEASON.test(letters) || (/^(19|20)\d\d$/.test(m[2]!) && letters.length <= 2)) continue;
      return `${letters} ${m[2]!.toUpperCase()}`;
    }
  }
  return (course.courseId ?? course.name ?? course.id).slice(0, 18);
}

function cleanName(course: BbCourse, code: string): string {
  const raw = (course.name ?? course.courseId ?? code).trim();
  const [letters, num] = code.split(" ");
  const lead = new RegExp(`^\\(?${letters}[\\s\\-_.]?${num ?? ""}\\)?(?:[\\s.\\-_]*\\d{1,3})?\\s*[:\\-–—|]*\\s*`, "i");
  const out = raw
    .replace(lead, "")
    // "Linear Algebra (MATH235.01.FALL2026STATEU)": the registrar's id in brackets is noise.
    .replace(/\s*\([A-Za-z]{2,5}[\s\-_.]?\d{2,4}[A-Za-z]?[.\-_ ][^)]*\)\s*$/, "")
    .replace(/\s*\((?:fall|spring|summer|winter)[^)]*\)\s*$/i, "")
    .trim();
  return out || raw;
}

/** "FALL2026STATEU", "2027SP" → "Fall 2026", "Spring 2027". Anything else is left alone. */
export function prettyTerm(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const m = /(fall|spring|summer|winter)\s*[-_ ]?\s*(20\d\d)/i.exec(name) ?? /(20\d\d)\s*[-_ ]?\s*(fall|spring|summer|winter)/i.exec(name);
  if (!m) return name;
  const season = (/^\d/.test(m[1]!) ? m[2]! : m[1]!).toLowerCase();
  const year = /^\d/.test(m[1]!) ? m[1]! : m[2]!;
  return `${season[0]!.toUpperCase()}${season.slice(1)} ${year}`;
}

/** Is this enrollment for a class happening now (not last year's, not a club page)? */
export function isCurrent(m: BbMembership, term: BbTerm | undefined, now: Date): boolean {
  const c = m.course;
  if (!c || c.organization) return false;
  if (m.availability?.available === "No") return false;
  if (c.availability?.available === "No" || c.availability?.available === "Disabled") return false;
  const t = now.getTime();
  const termRange = term?.availability?.duration;
  const range = termRange?.start || termRange?.end ? termRange : c.availability?.duration;
  if (range && (range.start || range.end)) {
    const start = range.start ? Date.parse(range.start) - 21 * DAY : -Infinity;
    const end = range.end ? Date.parse(range.end) + 21 * DAY : Infinity;
    return t >= start && t <= end;
  }
  if (m.lastAccessed) return t - Date.parse(m.lastAccessed) < 120 * DAY;
  const made = m.created ?? c.created;
  return made ? t - Date.parse(made) < 240 * DAY : true;
}

export interface CourseMapContext {
  baseUrl: string;
  source: BbSource;
  known: Course[];
  termName: string;
  now: Date;
  /** Colors already handed out in this sync. */
  usedColors: Set<string>;
}

/** An existing course this Blackboard course belongs to: linked before, or added by hand with the same code. */
export function existingCourse(bb: BbCourse, code: string, known: Course[]): Course | undefined {
  const isBb = (s: SourceRef) => s.source === "blackboard-session" || s.source === "blackboard-rest";
  const linked = known.find((c) => c.sources.some((s) => isBb(s) && s.externalId === bb.id));
  if (linked) return linked;
  const key = courseKey(code);
  if (!key) return undefined;
  return known.find((c) => courseKey(c.code) === key && !c.sources.some((s) => isBb(s) && s.externalId));
}

export function mapCourse(bb: BbCourse, term: BbTerm | undefined, ctx: CourseMapContext): Course {
  const code = displayCode(bb);
  const prev = existingCourse(bb, code, ctx.known);
  const taken = new Set([...ctx.known.map((c) => c.color), ...ctx.usedColors]);
  const color = prev?.color ?? COLORS.find((c) => !taken.has(c)) ?? COLORS[(ctx.known.length + ctx.usedColors.size) % COLORS.length]!;
  ctx.usedColors.add(color);
  const url = `${ctx.baseUrl}/ultra/courses/${encodeURIComponent(bb.id)}/outline`;
  return {
    id: prev?.id ?? `bb:${bb.id}`,
    code,
    name: cleanName(bb, code),
    term: prettyTerm(term?.name) ?? prev?.term ?? ctx.termName,
    credits: prev?.credits ?? 3,
    level: prev?.level ?? "regular",
    color,
    instructors: [],
    meetings: prev?.meetings ?? [],
    url,
    sources: [{ source: ctx.source, externalId: bb.id, url, fetchedAt: ctx.now.toISOString() }],
  };
}

function totalKind(name: string): CourseOverall["kind"] | undefined {
  if (/weighted\s*total/i.test(name)) return "weighted-total";
  if (/\b(overall|course|final|current|semester|term)\s+(grade|average|score|total)\b/i.test(name)) return "overall";
  if (/^(running\s+)?total(\s+points)?$/i.test(name.trim())) return "total";
  return undefined;
}

function numeric(g: BbGrade | undefined, col: BbColumn): { score: number; possible: number } | undefined {
  if (!g) return undefined;
  const score = g.displayGrade?.score ?? g.score;
  const possible = g.displayGrade?.possible ?? col.score?.possible;
  if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
  if (typeof possible !== "number" || !(possible > 0)) return undefined;
  return { score, possible };
}

// ---------- course content: where things are, what they link to ----------

export interface ContentIndex {
  byId: Map<string, BbContent>;
  /** Address of one content item in the Blackboard site. */
  urlOf(contentId: string | undefined): string | undefined;
  /** "gradescope:1234567" when the item is a link to that Gradescope assignment. */
  refsOf(contentId: string | undefined): string[];
}

export function indexContents(contents: BbContent[], baseUrl: string, bbCourseId: string): ContentIndex {
  const byId = new Map(contents.map((c) => [c.id, c]));
  return {
    byId,
    urlOf(id) {
      const c = id ? byId.get(id) : undefined;
      if (!c) return undefined;
      const q = new URLSearchParams({ redirectType: "nautilus", courseId: bbCourseId, contentId: c.id });
      if (c.parentId) q.set("parentId", c.parentId);
      return `${baseUrl}/ultra/redirect?${q.toString()}`;
    },
    refsOf(id) {
      const gs = /^assignment-(\d+)$/.exec((id ? byId.get(id) : undefined)?.contentHandler?.customParameters?.custom_gradescope_resource_id ?? "");
      return gs ? [`gradescope:${gs[1]}`] : [];
    },
  };
}

/**
 * Links that open Gradescope straight from Blackboard (an assignment that
 * "is a link to a Gradescope assignment"). Opening one with your Blackboard
 * sign-in lands in your Gradescope account with no second login.
 */
export function gradescopeLaunchPaths(contents: BbContent[], bbCourseId: string): string[] {
  return contents
    .filter((c) => c.availability?.available !== "No" && c.contentHandler?.id === "resource/x-bb-blti-link")
    .filter(
      (c) =>
        /gradescope|gs-proxy/i.test(c.contentHandler?.url ?? "") ||
        Boolean(c.contentHandler?.customParameters?.custom_gradescope_resource_id) ||
        /gradescope/i.test(c.description ?? ""),
    )
    .map((c) => `/webapps/blackboard/execute/blti/launchLink?course_id=${encodeURIComponent(bbCourseId)}&content_id=${encodeURIComponent(c.id)}`);
}

export interface GradebookInput {
  /** Dashboard course id. */
  courseId: string;
  bbCourseId: string;
  baseUrl: string;
  source: BbSource;
  columns: BbColumn[];
  grades: BbGrade[];
  categories: BbCategory[];
  contents?: ContentIndex;
  now: Date;
}

export interface GradebookOutput {
  assignments: Assignment[];
  grades: GradeEntry[];
  overall: CourseOverall[];
}

/** Gradebook columns + your grades → assignments, grade entries, the course total. */
export function mapGradebook(i: GradebookInput): GradebookOutput {
  const fetchedAt = i.now.toISOString();
  const gradesUrl = `${i.baseUrl}/ultra/courses/${encodeURIComponent(i.bbCourseId)}/grades`;
  const byCol = new Map(i.grades.map((g) => [g.columnId, g]));
  const cats = new Map(i.categories.map((c) => [c.id, c.title]));
  const out: GradebookOutput = { assignments: [], grades: [], overall: [] };

  for (const col of i.columns) {
    const name = (col.displayName || col.name || "").trim();
    if (!name || col.availability?.available === "No") continue;
    const g = byCol.get(col.id);
    const url = i.contents?.urlOf(col.contentId) ?? gradesUrl;
    const ref: SourceRef = { source: i.source, externalId: col.id, url, fetchedAt };
    const kind = totalKind(name);
    const calculated = col.grading?.type === "Calculated";

    if (kind || calculated) {
      // Course totals are the instructor's own number; other calculated columns are averages we don't need.
      if (!kind) continue;
      const n = numeric(g, col);
      const text = (g?.displayGrade?.text ?? g?.text ?? "").trim();
      const pctText = /^(\d{1,3}(?:\.\d+)?)\s*%$/.exec(text);
      const percent = n ? (n.score / n.possible) * 100 : pctText ? Number(pctText[1]) : undefined;
      const letter = /^[A-F][+-]?$/.test(text) ? text : undefined;
      if (percent !== undefined || letter) out.overall.push({ courseId: i.courseId, kind, label: name, percent, letter, source: ref });
      continue;
    }

    const n = numeric(g, col);
    const due = col.grading?.due;
    const pastDue = due ? Date.parse(due) < i.now.getTime() : false;
    const status: Assignment["status"] = g?.exempt
      ? "excused"
      : n || g?.status === "Graded"
        ? "graded"
        : g?.status === "NeedsGrading"
          ? "submitted"
          : pastDue && col.grading?.type === "Attempts"
            ? "missing"
            : "upcoming";
    const id = `bb:${i.bbCourseId}:${col.id}`;
    const refs = i.contents?.refsOf(col.contentId) ?? [];
    out.assignments.push({
      id,
      courseId: i.courseId,
      title: name,
      kind: guessKind(name),
      category: col.gradebookCategoryId ? cats.get(col.gradebookCategoryId) : undefined,
      dueAt: due,
      pointsPossible: col.score?.possible,
      status,
      submittable: false,
      countsTowardGrade: col.includeInCalculations === false ? false : undefined,
      url,
      externalRefs: refs.length ? refs : undefined,
      contentId: col.contentId,
      attachments: [],
      sources: [ref],
    });
    if (n) {
      out.grades.push({
        assignmentId: id,
        courseId: i.courseId,
        score: n.score,
        pointsPossible: n.possible,
        dropped: g?.exempt || undefined,
        gradedAt: g?.lastRelevantDate,
        source: ref,
      });
    }
  }
  return out;
}

/** A Blackboard letter schema ("A ≥ 94, A- ≥ 90, …") → this course's letter cutoffs. */
export function mapLetterScale(schemas: BbSchema[]): LetterCutoff[] | undefined {
  const letterish = (s: BbSchema) => (s.symbols ?? []).filter((x) => /^[A-F][+-]?$/.test((x.text ?? "").trim()) && typeof x.lowerBound === "number");
  const pick = [...schemas]
    .filter((s) => letterish(s).length >= 3 && letterish(s).some((x) => x.text!.trim() === "A"))
    .sort((a, b) => Number(/letter/i.test(b.title ?? "")) - Number(/letter/i.test(a.title ?? "")))[0];
  if (!pick) return undefined;
  const cut = letterish(pick)
    .map((x) => ({ letter: x.text!.trim(), min: x.lowerBound! }))
    .sort((a, b) => b.min - a.min);
  cut[cut.length - 1]!.min = 0;
  return cut;
}

export function mapAnnouncements(list: BbAnnouncement[], courseId: string, bbCourseId: string, source: BbSource, baseUrl: string, now: Date): Announcement[] {
  return list
    .filter((a) => !a.draft)
    .map((a) => ({
      id: `bb:${bbCourseId}:ann:${a.id}`,
      courseId,
      title: htmlToText(a.title ?? "") || "(no title)",
      body: htmlToText(a.body ?? ""),
      postedAt: a.availability?.duration?.start ?? a.created ?? a.modified ?? now.toISOString(),
      author: a.creator,
      read: false,
      source: {
        source,
        externalId: a.id,
        url: `${baseUrl}/ultra/courses/${encodeURIComponent(bbCourseId)}/announcements`,
        fetchedAt: now.toISOString(),
      },
    }));
}

export function mapInstructors(users: BbCourseUser[]): Person[] {
  return users
    .filter((u) => /instructor|teachingassistant|ta\b|grader|faculty/i.test(u.courseRoleId ?? "") && u.user)
    .map((u) => ({
      name: [u.user!.name?.given, u.user!.name?.family].filter(Boolean).join(" ") || u.user!.userName || "Instructor",
      email: u.user!.contact?.email,
      role: /instructor|faculty/i.test(u.courseRoleId ?? "") ? ("instructor" as const) : ("ta" as const),
    }));
}

// ---------- files ----------

const SYLLABUS = /syllab/i;
/** Pages worth reading for dates even though they aren't "the syllabus". */
const SCHEDULE = /syllab|schedule|calendar/i;
const READABLE = /\.(pdf|docx|txt|md)$/i;
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/plain",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

function mimeOf(name: string, given?: string): string | undefined {
  return given || MIME[name.toLowerCase().split(".").pop() ?? ""];
}

export function folderTrail(item: BbContent, byId: Map<string, BbContent>): string[] {
  const trail: string[] = [];
  let p = item.parentId ? byId.get(item.parentId) : undefined;
  for (let depth = 0; p && depth < 8; depth++) {
    if (p.title && !/^root$/i.test(p.title)) trail.unshift(htmlToText(p.title));
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return trail;
}

export interface FileMapContext {
  courseId: string;
  bbCourseId: string;
  source: BbSource;
  now: Date;
}

/** Files embedded in an Ultra document: `<a data-bbfile="{…}" href="…/bbcswebdav/…/xid-123_1?…">`. */
export function embeddedFiles(html: string): { xid: string; name: string; mimeType?: string }[] {
  const out: { xid: string; name: string; mimeType?: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bdata-bbfile="([^"]*)"[^>]*>/gi)) {
    const tag = m[0];
    if (/data-bbtype="image"/i.test(tag)) continue;
    let meta: { linkName?: string; displayName?: string; mimeType?: string } = {};
    try {
      meta = JSON.parse(decodeEntities(m[1]!)) as typeof meta;
    } catch {
      continue;
    }
    const name = (meta.displayName || meta.linkName || "").trim();
    const xid = /\/xid-(\d+_\d+)/.exec(decodeEntities(/\bhref="([^"]*)"/i.exec(tag)?.[1] ?? ""))?.[1];
    if (!name || !xid || /^image\//i.test(meta.mimeType ?? "")) continue;
    out.push({ xid, name, mimeType: meta.mimeType });
  }
  return out;
}

/**
 * Every file a course offers, read from the content list alone (no extra
 * requests): plain file items, and files embedded in documents — which is
 * where Ultra courses keep the syllabus ("Course Overview → Syllabus").
 */
export function mapContentFiles(contents: BbContent[], ctx: FileMapContext): CourseFile[] {
  const byId = new Map(contents.map((c) => [c.id, c]));
  const cid = encodeURIComponent(ctx.bbCourseId);
  const fetchedAt = ctx.now.toISOString();
  const files: CourseFile[] = [];
  const seen = new Set<string>();
  const push = (f: CourseFile) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    files.push(f);
  };

  for (const c of contents) {
    if (c.availability?.available === "No") continue;
    const folder = folderTrail(c, byId);
    const inSyllabusPlace = folder.some((seg) => SYLLABUS.test(seg)) || SYLLABUS.test(c.title ?? "");
    const base = `/learn/api/public/v1/courses/${cid}/contents/${encodeURIComponent(c.id)}`;

    if (c.contentHandler?.id === "resource/x-bb-file") {
      const name = c.contentHandler.file?.fileName || c.title || "file";
      push({
        id: `bbfile:${ctx.bbCourseId}:${c.id}:file`,
        courseId: ctx.courseId,
        name,
        folder,
        mimeType: mimeOf(name),
        url: `${base}/attachments`,
        isSyllabus: READABLE.test(name) && (SYLLABUS.test(name) || inSyllabusPlace),
        modified: c.modified,
        contentId: c.id,
        source: { source: ctx.source, externalId: c.id, fetchedAt },
      });
    }

    const body = c.body ?? "";
    for (const e of embeddedFiles(body)) {
      push({
        id: `bbfile:${ctx.bbCourseId}:${c.id}:x${e.xid}`,
        courseId: ctx.courseId,
        name: e.name,
        folder,
        mimeType: mimeOf(e.name, e.mimeType),
        url: `${base}#xid-${e.xid}`,
        isSyllabus: READABLE.test(e.name) && (SYLLABUS.test(e.name) || inSyllabusPlace),
        modified: c.modified,
        contentId: c.id,
        source: { source: ctx.source, externalId: e.xid, fetchedAt },
      });
    }

    // A syllabus or schedule typed straight into a page: its text is the "file".
    const label = c.title && c.title !== "ultraDocumentBody" ? c.title : (byId.get(c.parentId ?? "")?.title ?? c.title ?? "");
    if (body && SCHEDULE.test(`${label} ${folder[folder.length - 1] ?? ""}`)) {
      // Count only what was typed: a page that just holds the syllabus file is not itself a syllabus.
      const text = htmlToText(body.replace(/<a\b[^>]*\bdata-bbfile=[^>]*>[\s\S]*?<\/a>/gi, " "));
      if (text.length >= 200) {
        push({
          id: `bbfile:${ctx.bbCourseId}:${c.id}:body`,
          courseId: ctx.courseId,
          name: `${htmlToText(label).slice(0, 60) || "Syllabus"}.txt`,
          folder,
          mimeType: "text/plain",
          url: base,
          isSyllabus: true,
          modified: c.modified,
          contentId: c.id,
          source: { source: ctx.source, externalId: c.id, fetchedAt },
        });
      }
    }
  }
  return files;
}

// ---------- the course page itself ----------

const KIND_BY_HANDLER: Record<string, ContentItem["kind"]> = {
  "resource/x-bb-folder": "folder",
  "resource/x-bb-lesson": "folder",
  "resource/x-bb-module-page": "folder",
  "resource/x-bb-document": "page",
  "resource/x-bb-blankpage": "page",
  "resource/x-bb-file": "file",
  "resource/x-bb-externallink": "link",
  "resource/x-bb-assignment": "assignment",
  "resource/x-bb-asmt-test-link": "test",
  "resource/x-bb-asmt-survey-link": "test",
  "resource/x-bb-blti-link": "tool",
  "resource/x-bb-forumlink": "discussion",
  "resource/x-bb-discussion": "discussion",
};

/** The tool behind an LTI link, by its address or title. */
const TOOLS: [RegExp, string][] = [
  [/gradescope|gs-proxy/i, "Gradescope"],
  [/qwickly/i, "Qwickly"],
  [/panopto/i, "Panopto"],
  [/zoom/i, "Zoom"],
  [/webwork/i, "WeBWorK"],
  [/mheducation|mcgraw|connect\.mheducation/i, "McGraw Hill"],
  [/pearson|mylab|mastering/i, "Pearson"],
  [/cengage|webassign/i, "Cengage"],
  [/perusall/i, "Perusall"],
  [/piazza/i, "Piazza"],
  [/top ?hat/i, "Top Hat"],
  [/collaborate/i, "Class Collaborate"],
];

/**
 * The course content as Blackboard shows it: folders, pages, files, links,
 * assignments, tests and tools (Gradescope, Qwickly attendance, …), in
 * Blackboard's order. Ultra keeps a page's text in a hidden child named
 * "ultraDocumentBody"; that child is folded into its page. Items you can't
 * see in Blackboard (not available) are left out.
 */
export function mapContentTree(contents: BbContent[], baseUrl: string, bbCourseId: string): ContentItem[] {
  const shown = contents.filter((c) => c.availability?.available !== "No");
  const byId = new Map(shown.map((c) => [c.id, c]));
  const index = indexContents(shown, baseUrl, bbCourseId);
  const isBody = (c: BbContent) => /^ultraDocumentBody$/i.test(c.title ?? "");
  const bodiesOf = new Map<string, BbContent[]>();
  for (const c of shown) if (isBody(c) && c.parentId) bodiesOf.set(c.parentId, [...(bodiesOf.get(c.parentId) ?? []), c]);
  const hasRealChildren = new Set(shown.filter((c) => !isBody(c) && c.parentId).map((c) => c.parentId!));

  const out: ContentItem[] = [];
  for (const c of shown) {
    if (isBody(c)) continue;
    // A child of something we left out moves up to the nearest shown folder (or the top).
    let parentId = c.parentId;
    while (parentId && !byId.has(parentId)) parentId = undefined;
    const handler = c.contentHandler?.id ?? "";
    let kind: ContentItem["kind"] = KIND_BY_HANDLER[handler] ?? "other";
    const bodies = bodiesOf.get(c.id) ?? [];
    // An Ultra "document" is stored as a folder holding only its body: it's a page.
    if (kind === "folder" && bodies.length > 0 && !hasRealChildren.has(c.id)) kind = "page";
    const html = [c.body ?? "", ...bodies.map((b) => b.body ?? "")].join(" ");
    const text = htmlToText(html.replace(/<a\b[^>]*\bdata-bbfile=[^>]*>[\s\S]*?<\/a>/gi, " ")).replace(/\s+/g, " ").trim();
    const linkUrl = c.contentHandler?.url;
    const href = kind === "link" && linkUrl && /^https?:\/\//i.test(linkUrl) ? linkUrl : undefined;
    const toolText = `${linkUrl ?? ""} ${c.title ?? ""} ${c.description ?? ""} ${Object.keys(c.contentHandler?.customParameters ?? {}).join(" ")}`;
    const tool = kind === "tool" ? TOOLS.find(([re]) => re.test(toolText))?.[1] : undefined;
    out.push({
      id: c.id,
      ...(parentId ? { parentId } : {}),
      title: htmlToText(c.title ?? "") || (kind === "page" ? "Page" : "Untitled"),
      kind,
      url: index.urlOf(c.id),
      ...(href ? { href } : {}),
      ...(text ? { text: text.slice(0, 600) } : {}),
      ...(tool ? { tool } : {}),
      ...(bodies.length ? { bodyIds: bodies.map((b) => b.id) } : {}),
      ...(c.modified ? { modified: c.modified } : {}),
    });
  }
  return out;
}
