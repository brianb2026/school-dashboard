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

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export interface AttendanceRecord {
  courseId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  source: SourceRef;
}

/** Attendance when the source only gives totals (e.g. the Qwickly gradebook column). */
export interface AttendanceSummary {
  courseId: string;
  percent?: number;
  present?: number;
  late?: number;
  absent?: number;
  excused?: number;
  total?: number;
  label: string;
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
  source: SourceRef;
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
