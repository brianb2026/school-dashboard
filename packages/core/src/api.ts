/** Request/response shapes shared by the server and the web UI. */
import type { GpaScale } from "./gpa.js";
import type { ResolvedGrade } from "./grades.js";
import type { Conflict } from "./workload.js";
import type {
  Announcement,
  Assignment,
  AssignmentKind,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummary,
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

/** An assignment as the UI shows it: merged across sources, with its grade and your marks. */
export interface AssignmentView extends Assignment {
  score?: number;
  possible?: number;
  gradedAt?: string;
  /** The score is one you typed in, not one a source reported. */
  scoreIsYours?: boolean;
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
  attendance?: AttendanceSummary;
  /** none = no syllabus yet; review = found but needs your check; applied = weights in use. */
  syllabus: "none" | "review" | "applied";
}

export interface WorkloadDay {
  day: string; // YYYY-MM-DD in the school's time zone
  hours: number;
  count: number;
  conflict: boolean;
}

export type ViewName = "Today" | "Assignments" | "Grades" | "Inbox" | "Schedule" | "Attendance" | "Files" | "Syllabi" | "Settings";

/** One line telling you something needs you, with where to go. */
export interface Notice {
  id: string;
  level: "info" | "warn";
  text: string;
  view?: ViewName;
  action?: "link-blackboard" | "link-gradescope";
}

export interface LinkInfo {
  linked: boolean;
  /** The saved sign-in stopped working; one click reconnects. */
  expired: boolean;
  host?: string;
}

export type LinkTarget = "blackboard" | "gradescope";
export type LinkPhase = "idle" | "opening" | "waiting" | "syncing" | "done" | "error" | "cancelled";

export interface LinkStatus {
  target?: LinkTarget;
  phase: LinkPhase;
  message?: string;
}

export interface DashboardData {
  /** False until any course or assignment exists. */
  hasData: boolean;
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
  attendance: AttendanceRecord[];
  notices: Notice[];
  unmatchedCount: number;
  lastSyncAt?: string;
  syncing: boolean;
  links: {
    blackboard: LinkInfo & { via?: "session" | "api" };
    gradescope: LinkInfo;
    gmail: { connected: boolean; configured: boolean };
    calendar: { set: boolean };
  };
  ai: { provider: string };
  notifications: boolean;
}

export type ToggleKey = "blackboardSessionReader" | "gradescopeSessionReader";

export interface SettingsInfo {
  calendarLink: { set: boolean; host?: string; fromEnv: boolean };
  blackboardUrl?: string;
  ai: { provider: string };
  timezone: string;
  term: { name: string; start: string; end: string };
  gpaScale: string;
  notifications: boolean;
  chromeFound: boolean;
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
    dates: { date: string; title: string; kind: AssignmentKind; line: string }[];
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
  items: { date: string; time?: string; title: string; kind: AssignmentKind }[];
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
}

export interface NewAssignment {
  courseId: string;
  title: string;
  kind: AssignmentKind;
  date: string;
  time?: string;
  pointsPossible?: number;
}

export interface AttendanceMark {
  courseId: string;
  date: string;
  status: AttendanceStatus;
}

export interface OutgoingMessage {
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
}
