/** Request/response shapes shared by the server and the web UI. */
import type { GpaScale } from "./gpa.js";
import type { ResolvedGrade } from "./grades.js";
import type { Conflict } from "./workload.js";
import type {
  Announcement,
  Assignment,
  AssignmentKind,
  Course,
  CourseFile,
  CourseLevel,
  CourseOverall,
  GradeEntry,
  GradeSourcePref,
  GradingCategory,
  LetterCutoff,
  Meeting,
  Message,
} from "./types.js";

/**
 * Bumped whenever the server's answers change shape. The page compares it
 * with the running server's, so an old server behind a new page is caught.
 */
export const API_VERSION = 6;

/** An assignment as the UI shows it: merged across sources, with its grade and your marks. */
export interface AssignmentView extends Assignment {
  score?: number;
  possible?: number;
  gradedAt?: string;
  /** The score is one you typed in, not one a source reported. */
  scoreIsYours?: boolean;
  /** Where the shown score comes from: "Blackboard", "Gradescope" or "You". */
  scoreFrom?: string;
  /**
   * Every score on record for this item. More than one entry with different
   * numbers means the sources disagree (e.g. a regrade in Gradescope that
   * Blackboard hasn't picked up); the UI shows both and lets you choose.
   */
  scores?: { from: "Blackboard" | "Canvas" | "Gradescope" | "You"; score: number; possible: number }[];
  scoresDiffer?: boolean;
  /** Course files that go with this item (handout, the reading itself). */
  materials?: { id: string; name: string }[];
  /** The due date it had before the school moved it (in the last week). */
  movedFrom?: string;
  /** Submitted, graded, excused, or ticked off by you. */
  done: boolean;
  /** You ticked it off yourself. */
  userDone: boolean;
  late: boolean;
  /** The grading-scheme category it counts toward (your choice, else matched automatically). */
  categoryResolved?: string;
  /** "Blackboard", "Gradescope", "Calendar feed", "Syllabus", "You". */
  origin: string;
  /** True when you added it by hand (so it can be edited or deleted). */
  manual: boolean;
}

export interface CourseView extends Course {
  grade: ResolvedGrade;
  scheme?: GradingCategory[];
  /** "syllabus", "you" … where the weights came from. */
  schemeFrom?: string;
  /** Letter scale in effect for this course. */
  cutoffs: LetterCutoff[];
  cutoffsFrom: "blackboard" | "syllabus" | "manual" | "school";
  /** Letters the source didn't give, filled in from the usual scale (its own are guarantees). */
  cutoffsFilled?: string[];
  /** none = no syllabus yet; review = found but needs your check; applied = weights in use. */
  syllabus: "none" | "review" | "applied";
}

export interface WorkloadDay {
  day: string; // YYYY-MM-DD in the school's time zone
  hours: number;
  count: number;
  conflict: boolean;
}

export type ViewName = "Home" | "Grades" | "Inbox" | "Files" | "Syllabi" | "Settings";

/** One line telling you something needs you, with where to go. */
export interface Notice {
  id: string;
  level: "info" | "warn";
  text: string;
  view?: ViewName;
  action?: "link-blackboard" | "link-gradescope" | "link-canvas" | "link-sis" | "open-sis";
}

export interface LinkInfo {
  linked: boolean;
  /** The saved sign-in stopped working; one click reconnects. */
  expired: boolean;
  host?: string;
}

export type LinkTarget = "blackboard" | "gradescope" | "canvas" | "sis";
export type LinkPhase = "idle" | "opening" | "waiting" | "syncing" | "done" | "error" | "cancelled";

export interface LinkStatus {
  target?: LinkTarget;
  phase: LinkPhase;
  message?: string;
}

export interface DashboardData {
  /** False until any course or assignment exists. */
  hasData: boolean;
  /** Your first name, as Blackboard or Canvas has it. */
  studentName?: string;
  /** The official record from the student information system, when linked. */
  sis?: SisView;
  /** What changed in the last two weeks, newest first (seen ones included, marked). */
  changes: ChangeView[];
  school: string;
  term: { name: string; start: string; end: string };
  timezone: string;
  courses: CourseView[];
  hiddenCourses: { id: string; code: string; name: string }[];
  assignments: AssignmentView[];
  grades: GradeEntry[];
  overall: CourseOverall[];
  workload: WorkloadDay[];
  conflicts: Conflict[];
  gpa?: { gpa: number; unweighted: number; credits: number; scale: string };
  /** The GPA scale in use, so the UI can run "what if I get an A" itself. */
  gpaScale?: GpaScale;
  announcements: Announcement[];
  messages: Message[];
  files: CourseFile[];
  notices: Notice[];
  unmatchedCount: number;
  lastSyncAt?: string;
  syncing: boolean;
  links: {
    blackboard: LinkInfo & { via?: "session" | "api" };
    /** `viaBlackboard`: it can be opened through a Blackboard link, with no separate sign-in. */
    gradescope: LinkInfo & { viaBlackboard: boolean };
    canvas: LinkInfo & { via?: "session" | "token" };
    sis: LinkInfo & { home?: string };
    gmail: { connected: boolean; configured: boolean };
    calendar: { set: boolean };
  };
  ai: { provider: string };
  notifications: boolean;
}

/** One thing that changed since you last looked. */
export interface ChangeView {
  id: number;
  at: string;
  kind: "grade" | "due-moved" | "new-assignment" | "file" | "announcement";
  courseId?: string;
  /** What it's about: an assignment, a file, an announcement. */
  title: string;
  assignmentId?: string;
  fileId?: string;
  announcementId?: string;
  from?: string;
  to?: string;
  score?: number;
  possible?: number;
  was?: number;
  seen: boolean;
}

/** The SIS record as the dashboard shows it, with GPAs worked out from official grades. */
export interface SisView {
  /** Cumulative GPA from every graded course on the record. */
  gpa?: number;
  /** Units that count toward it. */
  units: number;
  terms: { term: string; gpa?: number; units: number; courses: { code: string; title: string; units?: number; grade?: string; status?: string }[] }[];
  holds: { title: string }[];
  todos: { title: string }[];
  enrollment: { term?: string; at?: string; text: string }[];
  fetchedAt: string;
}

/** A person's (or school's) own space on this Mac: data, sign-ins and settings apart from the others. */
export interface ProfileInfo {
  id: string;
  name?: string;
  host?: string;
  lms?: "blackboard" | "canvas";
  active: boolean;
}

/** What the sign-in screen shows before anything else loads. */
export interface SessionInfo {
  /** Your first name, once known. */
  name?: string;
  school: string;
  /** A learning system (Blackboard or Canvas) is linked (a saved sign-in exists). */
  linked: boolean;
  host?: string;
  /** Which one. */
  lms?: "blackboard" | "canvas";
  /** The SIS is linked too. */
  sis?: boolean;
  /** Classes are saved on this Mac, so they can be opened without signing in. */
  hasData: boolean;
}

/**
 * "Continue": what happened to your saved sign-in.
 *  in     = it still works (or was renewed quietly); a fresh sync has started.
 *  window = it ran out; the school's sign-in window is open (follow /api/link/status).
 *  link   = nothing saved yet; link Blackboard first.
 *  error  = something stopped it; `message` says what.
 */
export interface SignInResult {
  state: "in" | "window" | "link" | "error";
  name?: string;
  message?: string;
}

export interface SettingsInfo {
  calendarLink: { set: boolean; host?: string; fromEnv: boolean };
  blackboardUrl?: string;
  ai: { provider: string };
  timezone: string;
  term: { name: string; start: string; end: string };
  gpaScale: string;
  notifications: boolean;
  chromeFound: boolean;
  /** Running as the demo: only the pretend Blackboard can be linked. */
  demo: boolean;
  gmailRedirectUri: string;
}

export interface ConnectorInfo {
  id: string;
  label: string;
  capabilities: string[];
  status: { state: string; detail?: string; lastSyncAt?: string };
  /** What the last sync said (skipped endpoints, counts). */
  notes?: string[];
}

export interface SyncReport {
  connector: string;
  ok: boolean;
  detail?: string;
  notes?: string[];
}

export interface NewCourse {
  code: string;
  name: string;
  credits: number;
  level: CourseLevel;
  color: string;
}

export interface CoursePatch extends Partial<NewCourse> {
  gradeSource?: GradeSourcePref;
  meetings?: Meeting[];
  hidden?: boolean;
  letterCutoffs?: LetterCutoff[] | null;
}

export interface UnmatchedItem {
  id: string;
  title: string;
  courseHint?: string;
  dueAt?: string;
  /** What to remember for next time: the course code as written, or the title. */
  suggestedPattern: string;
}

export interface SyllabusRecord {
  id: string;
  filename: string;
  uploadedAt: string;
  confirmed: boolean;
  /** Pulled from Blackboard and applied without you (weights added up to 100%). */
  auto: boolean;
  courseId?: string;
  suggestedCourseId?: string;
  /** What you saved in the review screen, so editing starts from your version. */
  applied?: ConfirmSyllabus;
  parse: {
    course: { code?: string; title?: string };
    weights: { weights: { name: string; weight: number; line: string }[]; total: number; confident: boolean };
    dates: { date: string; time?: string; title: string; kind: AssignmentKind; line: string; url?: string }[];
    policies: { instructorEmails: string[]; officeHours?: string; latePolicy?: string };
    letterScale?: LetterCutoff[];
    credits?: number;
    meetings?: Meeting[];
    needsHelp: boolean;
  };
}

export interface ConfirmSyllabus {
  /** Attach to an existing course, or create `newCourse`. */
  courseId?: string;
  newCourse?: NewCourse;
  weights: { name: string; weight: number; dropLowest?: number }[];
  items: { date: string; time?: string; title: string; kind: AssignmentKind; url?: string }[];
  instructorEmails: string[];
  officeHours?: string;
  latePolicy?: string;
  letterScale?: LetterCutoff[];
}

export interface AssignmentPatch {
  done?: boolean;
  effortHours?: number | null;
  category?: string | null;
  hidden?: boolean;
  /** Which source's score to use when Blackboard and Gradescope disagree. */
  gradeFrom?: "blackboard" | "gradescope" | null;
}

export interface NewAssignment {
  courseId: string;
  title: string;
  kind: AssignmentKind;
  date: string;
  time?: string;
  pointsPossible?: number;
}

export interface OutgoingMessage {
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
}
