/**
 * Pure mapping from Blackboard Learn REST JSON to the dashboard's model.
 * No network here, so every rule can be tested against recorded shapes.
 * Field names follow the public API docs (developer.anthology.com).
 */
import {
  courseKey,
  htmlToText,
  type Announcement,
  type Assignment,
  type AttendanceSummary,
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
  contentHandler?: { id?: string; file?: { fileName?: string } };
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
export interface BbAttendanceRecord {
  status?: string;
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
  const out = raw.replace(lead, "").replace(/\s*\((?:fall|spring|summer|winter)[^)]*\)\s*$/i, "").trim();
  return out || raw;
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
  const linked = known.find((c) => c.sources.some((s) => s.source.startsWith("blackboard-") && s.source !== "blackboard-ical" && s.externalId === bb.id));
  if (linked) return linked;
  const key = courseKey(code);
  if (!key) return undefined;
  return known.find((c) => courseKey(c.code) === key && !c.sources.some((s) => (s.source === "blackboard-session" || s.source === "blackboard-rest") && s.externalId));
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
    term: term?.name ?? prev?.term ?? ctx.termName,
    credits: prev?.credits ?? 3,
    level: prev?.level ?? "regular",
    color,
    instructors: [],
    meetings: prev?.meetings ?? [],
    url,
    sources: [{ source: ctx.source, externalId: bb.id, url, fetchedAt: ctx.now.toISOString() }],
  };
}

export const ATTENDANCE_COLUMN = /\b(qwickly|attendance)\b/i;

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

export interface GradebookInput {
  /** Dashboard course id. */
  courseId: string;
  bbCourseId: string;
  baseUrl: string;
  source: BbSource;
  columns: BbColumn[];
  grades: BbGrade[];
  categories: BbCategory[];
  now: Date;
}

export interface GradebookOutput {
  assignments: Assignment[];
  grades: GradeEntry[];
  overall: CourseOverall[];
  attendance?: AttendanceSummary;
}

/** Gradebook columns + your grades → assignments, grade entries, the course total, attendance. */
export function mapGradebook(i: GradebookInput): GradebookOutput {
  const fetchedAt = i.now.toISOString();
  const url = `${i.baseUrl}/ultra/courses/${encodeURIComponent(i.bbCourseId)}/grades`;
  const byCol = new Map(i.grades.map((g) => [g.columnId, g]));
  const cats = new Map(i.categories.map((c) => [c.id, c.title]));
  const out: GradebookOutput = { assignments: [], grades: [], overall: [] };

  for (const col of i.columns) {
    const name = (col.displayName || col.name || "").trim();
    if (!name || col.availability?.available === "No") continue;
    const g = byCol.get(col.id);
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
    if (ATTENDANCE_COLUMN.test(name) && n) {
      out.attendance = {
        courseId: i.courseId,
        percent: (n.score / n.possible) * 100,
        label: `${name}: ${n.score} of ${n.possible}`,
        source: { ...ref, source: /qwickly/i.test(name) ? "qwickly" : i.source },
      };
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
  cut[cut.length - 1]!.min = Math.min(cut[cut.length - 1]!.min, 0) || 0;
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

export function mapAttendance(records: BbAttendanceRecord[], courseId: string, source: BbSource, now: Date): AttendanceSummary | undefined {
  if (!records.length) return undefined;
  const count = (s: string) => records.filter((r) => (r.status ?? "").toLowerCase() === s).length;
  const present = count("present");
  const late = count("late");
  const absent = count("absent");
  const excused = count("excused");
  const counted = present + late + absent;
  return {
    courseId,
    present,
    late,
    absent,
    excused,
    total: records.length,
    percent: counted > 0 ? ((present + late) / counted) * 100 : undefined,
    label: `${present + late} of ${counted} classes`,
    source: { source, fetchedAt: now.toISOString() },
  };
}

const SYLLABUS = /syllab/i;
const READABLE = /\.(pdf|docx|txt|md)$/i;

export function folderTrail(item: BbContent, byId: Map<string, BbContent>): string[] {
  const trail: string[] = [];
  let p = item.parentId ? byId.get(item.parentId) : undefined;
  for (let depth = 0; p && depth < 8; depth++) {
    if (p.title && !/^root$/i.test(p.title)) trail.unshift(htmlToText(p.title));
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return trail;
}

/** Which content items are worth asking for their attachments (one request each, so be picky). */
export function attachmentCandidates(contents: BbContent[], limit: number): BbContent[] {
  const score = (c: BbContent) => (SYLLABUS.test(c.title ?? "") ? 0 : c.contentHandler?.id === "resource/x-bb-file" ? 1 : 2);
  return contents
    .filter((c) => c.availability?.available !== "No")
    .filter((c) => c.contentHandler?.id === "resource/x-bb-file" || c.contentHandler?.id === "resource/x-bb-document" || SYLLABUS.test(c.title ?? ""))
    .filter((c) => c.contentHandler?.id !== "resource/x-bb-folder")
    .sort((a, b) => score(a) - score(b))
    .slice(0, limit);
}

export interface FileMapContext {
  courseId: string;
  bbCourseId: string;
  source: BbSource;
  now: Date;
}

export function mapAttachment(content: BbContent, att: BbAttachment, byId: Map<string, BbContent>, ctx: FileMapContext): CourseFile {
  const name = att.fileName || content.contentHandler?.file?.fileName || content.title || "file";
  const cid = encodeURIComponent(ctx.bbCourseId);
  return {
    id: `bbfile:${ctx.bbCourseId}:${content.id}:${att.id}`,
    courseId: ctx.courseId,
    name,
    folder: folderTrail(content, byId),
    mimeType: att.mimeType,
    url: `/learn/api/public/v1/courses/${cid}/contents/${encodeURIComponent(content.id)}/attachments/${encodeURIComponent(att.id)}/download`,
    isSyllabus: (SYLLABUS.test(name) || SYLLABUS.test(content.title ?? "")) && READABLE.test(name),
    modified: content.modified,
    source: { source: ctx.source, externalId: att.id, fetchedAt: ctx.now.toISOString() },
  };
}

/**
 * A syllabus typed straight into a Blackboard page (no file): treated as a
 * text file whose "download" is the page body.
 */
export function mapInlineSyllabus(content: BbContent, byId: Map<string, BbContent>, ctx: FileMapContext): CourseFile | undefined {
  if (!SYLLABUS.test(content.title ?? "")) return undefined;
  const text = htmlToText(content.body ?? content.description ?? "");
  if (text.length < 400) return undefined;
  return {
    id: `bbfile:${ctx.bbCourseId}:${content.id}:body`,
    courseId: ctx.courseId,
    name: `${htmlToText(content.title ?? "Syllabus").slice(0, 60)}.txt`,
    folder: folderTrail(content, byId),
    mimeType: "text/plain",
    url: `/learn/api/public/v1/courses/${encodeURIComponent(ctx.bbCourseId)}/contents/${encodeURIComponent(content.id)}`,
    isSyllabus: true,
    modified: content.modified,
    source: { source: ctx.source, externalId: content.id, fetchedAt: ctx.now.toISOString() },
  };
}
