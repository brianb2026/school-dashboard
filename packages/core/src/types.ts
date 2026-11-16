/**
 * Domain model shared by every connector, the server, and the web UI.
 * Every record carries `source` so the UI can show where a fact came from
 * and so a re-sync from one source never clobbers another.
 */

export type SourceId =
  | "blackboard-ical"
  | "blackboard-rest"
  | "blackboard-session"
  | "gradescope"
  | "canvas"
  | "sis"
  | "qwickly"
  | "gmail"
  | "syllabus"
  | "manual";

export interface SourceRef {
  source: SourceId;
  /** ID in the source system (Blackboard course ID, Gmail message ID, …). */
  externalId?: string;
  url?: string;
  fetchedAt: string; // ISO timestamp
}

export type CourseLevel = "regular" | "honors" | "ap" | "ib" | "de";

/** Which number to show as the class grade. "auto" picks the most trustworthy one available. */
export type GradeSourcePref = "auto" | "blackboard" | "syllabus" | "points";

export interface LetterCutoff {
  letter: string;
  min: number;
}

export interface Course {
  id: string;
  code: string; // "CHEM 101"
  name: string;
  term: string;
  credits: number;
  level: CourseLevel;
  color: string; // one of the course palette tokens, e.g. "c3"
  instructors: Person[];
  meetings: Meeting[];
  /** From the syllabus. */
  policies?: { officeHours?: string; latePolicy?: string };
  /** This course's own letter scale (Blackboard grading schema or syllabus). Falls back to the school config. */
  letterCutoffs?: LetterCutoff[];
  letterCutoffsFrom?: "blackboard" | "syllabus" | "manual";
  gradeSource?: GradeSourcePref;
  /** Hidden courses stay in the database (so a re-sync doesn't bring them back) but show nowhere. */
  hidden?: boolean;
  /** Fields you changed by hand; a sync never overwrites them. */
  edited?: string[];
  /** Course page in the source system. */
  url?: string;
  sources: SourceRef[];
}

export interface Person {
  name: string;
  email?: string;
  role: "instructor" | "ta" | "student" | "staff";
  officeHours?: string;
}

export interface Meeting {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  start: string; // "09:30"
  end: string; // "10:45"
  location?: string;
}

export type AssignmentKind =
  | "homework"
  | "quiz"
  | "exam"
  | "project"
  | "paper"
  | "lab"
  | "discussion"
  | "reading"
  | "other";

export type AssignmentStatus = "upcoming" | "submitted" | "graded" | "late" | "missing" | "excused";

export interface Assignment {
  id: string;
  /** "unassigned" until matched; see matchCourse and the Unmatched list in Settings. */
  courseId: string;
  /** Raw text the course was (or will be) matched from, e.g. the calendar title. */
  courseHint?: string;
  title: string;
  kind: AssignmentKind;
  /** Category as the source names it (Blackboard gradebook category, syllabus category). */
  category?: string;
  dueAt?: string; // ISO
  pointsPossible?: number;
  status: AssignmentStatus;
  /** Can this be submitted from the dashboard? Only true when the source allows it. */
  submittable: boolean;
  /** False for columns the instructor excluded from the grade. */
  countsTowardGrade?: boolean;
  /** Where to open it in the source system. */
  url?: string;
  /**
   * Ids that name the same item in another system, e.g. "gradescope:1234567"
   * on both the Blackboard column and the Gradescope row. Two items sharing
   * one are the same thing, whatever their titles say.
   */
  externalRefs?: string[];
  /** The Blackboard content item this belongs to (its page may hold the handout). */
  contentId?: string;
  attachments: FileRef[];
  /** Your own estimate in hours; used by the workload heatmap. */
  effortHours?: number;
  sources: SourceRef[];
}

export interface FileRef {
  name: string;
  url?: string;
  /** Path inside DATA_DIR once cached for offline use. */
  localPath?: string;
  mimeType?: string;
}

export interface GradeEntry {
  assignmentId: string;
  courseId: string;
  score?: number; // undefined = not graded yet
  pointsPossible: number;
  dropped?: boolean;
  gradedAt?: string;
  source: SourceRef;
}

export interface GradingCategory {
  name: string; // "Homework"
  weight: number; // percent, e.g. 20
  dropLowest?: number;
}

export interface GradingScheme {
  courseId: string;
  categories: GradingCategory[];
  /** Where the weights came from, e.g. the parsed syllabus. */
  source: SourceRef;
}

/** A course total as the source system itself reports it (Blackboard "Weighted Total", "Total", …). */
export interface CourseOverall {
  courseId: string;
  kind: "weighted-total" | "overall" | "total";
  label: string;
  percent?: number;
  letter?: string;
  source: SourceRef;
}

export interface CourseFile {
  id: string;
  courseId: string;
  name: string;
  /** Folder trail inside the course, e.g. ["Course Content", "Week 1"]. */
  folder: string[];
  mimeType?: string;
  /** Download address: a path on the source host, never an arbitrary URL. */
  url: string;
  isSyllabus: boolean;
  modified?: string;
  /** The Blackboard content item it sits on. */
  contentId?: string;
  source: SourceRef;
}

/**
 * One entry of a course's content as Blackboard lays it out (folders,
 * pages, files, links, assignments, tests, tools like Gradescope or Qwickly),
 * in Blackboard's own order, so the dashboard can show the course page.
 */
export interface ContentItem {
  /** Blackboard content id. */
  id: string;
  /** The folder it sits in; none = top level. */
  parentId?: string;
  title: string;
  kind: "folder" | "page" | "file" | "link" | "assignment" | "test" | "tool" | "discussion" | "other";
  /** Opens this item in Blackboard. */
  url?: string;
  /** A web link item's own address (http/https only). */
  href?: string;
  /** The start of a page's text, as plain text. */
  text?: string;
  /** For tools: "Gradescope", "Qwickly", … */
  tool?: string;
  /** Content ids whose files belong to this item (Ultra keeps a page's body in a hidden child). */
  bodyIds?: string[];
  modified?: string;
}

/**
 * What the school's student information system (SIS) says about you: the
 * official record, read from your own signed-in pages.
 */
export interface SisRecord {
  /** Every course on your record, all terms, with the official grade once it's posted. */
  history: { term: string; code: string; title: string; units?: number; grade?: string; status?: string }[];
  /** Your classes as the SIS schedules them (days, times, rooms). */
  schedule: { code: string; section?: string; component?: string; days: number[]; start?: string; end?: string; room?: string }[];
  holds: { title: string }[];
  todos: { title: string }[];
  /** Enrollment appointments: "You may begin enrolling for Spring 2027 … on …". */
  enrollment: { term?: string; at?: string; text: string }[];
  fetchedAt: string;
}

export interface Announcement {
  id: string;
  courseId?: string;
  title: string;
  /** Plain text. HTML from the source is stripped before it is stored. */
  body: string;
  postedAt: string;
  author?: string;
  read: boolean;
  source: SourceRef;
}

export interface Message {
  id: string;
  threadId: string;
  courseId?: string;
  from: Person;
  to: Person[];
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
  source: SourceRef;
}
