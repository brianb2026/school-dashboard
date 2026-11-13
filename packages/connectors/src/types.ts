import type {
  Announcement,
  Assignment,
  AttendanceRecord,
  AttendanceSummary,
  Course,
  CourseFile,
  CourseOverall,
  GradeEntry,
  GradingScheme,
  Message,
  OutgoingMessage,
  SourceId,
} from "@sd/core";
import type { FetchLike } from "./net.js";

/** What a connector can do. The UI hides buttons for missing capabilities. */
export type Capability =
  | "courses"
  | "assignments"
  | "grades"
  | "attendance"
  | "announcements"
  | "messages"
  | "download"
  | "submit"
  | "send-message";

export type ConnectorState = "not-configured" | "needs-sign-in" | "ready" | "error";

export interface ConnectorStatus {
  state: ConnectorState;
  detail?: string;
  lastSyncAt?: string;
}

/** Everything a sync can return. Missing keys mean "this source doesn't know". */
export interface SyncResult {
  courses?: Course[];
  assignments?: Assignment[];
  grades?: GradeEntry[];
  schemes?: GradingScheme[];
  overall?: CourseOverall[];
  attendance?: AttendanceRecord[];
  attendanceSummaries?: AttendanceSummary[];
  announcements?: Announcement[];
  messages?: Message[];
  files?: CourseFile[];
  /**
   * What this result is the whole truth for. Rows under these id prefixes
   * that are not in the result get removed, so things deleted at the source
   * disappear here too.
   */
  authoritative?: {
    assignments?: string[];
    announcements?: string[];
    files?: string[];
    overall?: string[];
    messages?: boolean;
  };
  /** Plain-language notes for the Connections panel ("announcements: not shared with students"). */
  notes?: string[];
}

export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ConnectorContext {
  env: NodeJS.ProcessEnv;
  secrets: SecretStore;
  /** Courses already known, so later sources can attach to them. */
  knownCourses: Course[];
  now: Date;
  fetch: FetchLike;
  timezone: string;
  termName: string;
  /** Also fetch the slow-changing things (files, people, grading schemas). */
  deep: boolean;
}

export interface Connector {
  readonly id: SourceId;
  readonly label: string;
  readonly capabilities: Capability[];
  status(ctx: ConnectorContext): Promise<ConnectorStatus>;
  sync(ctx: ConnectorContext): Promise<SyncResult>;
  /** Fetch one course file through this connector's sign-in. */
  download?(ctx: ConnectorContext, file: CourseFile): Promise<{ bytes: Uint8Array; filename: string }>;
  sendMessage?(ctx: ConnectorContext, msg: OutgoingMessage): Promise<void>;
}

/** The saved sign-in no longer works; the user has to sign in again. */
export class AuthExpiredError extends Error {
  constructor(what = "Sign-in expired") {
    super(what);
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    what = `Request failed (${status})`,
  ) {
    super(what);
  }
}
