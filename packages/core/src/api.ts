/** Request/response shapes shared by the server and the web UI. */
import type { Conflict } from "./workload.js";
import type { Announcement, Assignment, AssignmentKind, Course, CourseLevel, Message } from "./types.js";

export interface CourseGradeSummary {
  percent?: number;
  letter?: string;
  weightGraded: number;
}

export interface DashboardCourse extends Course {
  grade?: CourseGradeSummary;
  hasScheme: boolean;
}

export interface WorkloadDay {
  day: string; // YYYY-MM-DD in the school's time zone
  hours: number;
  count: number;
  conflict: boolean;
}

export interface DashboardData {
  /** False until any course or assignment exists; the UI then shows sample data. */
  hasData: boolean;
  school: string;
  term: { name: string; start: string; end: string };
  timezone: string;
  courses: DashboardCourse[];
  assignments: Assignment[];
  workload: WorkloadDay[];
  conflicts: Conflict[];
  gpa?: { gpa: number; unweighted: number; credits: number; scale: string };
  announcements: Announcement[];
  messages: Message[];
  unmatchedCount: number;
  lastSyncAt?: string;
}

export type ToggleKey = "blackboardSessionReader" | "gradescopeSessionReader";

export interface SettingsInfo {
  calendarLink: { set: boolean; host?: string; fromEnv: boolean };
  toggles: Record<ToggleKey, boolean>;
  ai: { provider: string };
  timezone: string;
  term: { name: string; start: string; end: string };
  gpaScale: string;
}

export interface ConnectorInfo {
  id: string;
  label: string;
  capabilities: string[];
  status: { state: string; detail?: string; lastSyncAt?: string };
}

export interface SyncReport {
  connector: string;
  ok: boolean;
  detail?: string;
}

export interface NewCourse {
  code: string;
  name: string;
  credits: number;
  level: CourseLevel;
  color: string;
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
  courseId?: string;
  suggestedCourseId?: string;
  /** What you saved in the review screen, so editing starts from your version. */
  applied?: ConfirmSyllabus;
  parse: {
    course: { code?: string; title?: string };
    weights: { weights: { name: string; weight: number; line: string }[]; total: number; confident: boolean };
    dates: { date: string; title: string; kind: AssignmentKind; line: string }[];
    policies: { instructorEmails: string[]; officeHours?: string; latePolicy?: string };
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
}
