import type {
  Announcement,
  Assignment,
  AttendanceRecord,
  Course,
  FileRef,
  GradeEntry,
  GradingScheme,
  Message,
  SourceId,
} from "@sd/core";

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
  attendance?: AttendanceRecord[];
  announcements?: Announcement[];
  messages?: Message[];
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
}

export interface Connector {
  readonly id: SourceId;
  readonly label: string;
  readonly capabilities: Capability[];
  status(ctx: ConnectorContext): Promise<ConnectorStatus>;
  /** Start sign-in. Returns a URL to open, or nothing if no sign-in is needed. */
  connect?(ctx: ConnectorContext): Promise<{ openUrl?: string }>;
  sync(ctx: ConnectorContext): Promise<SyncResult>;
  download?(ctx: ConnectorContext, file: FileRef): Promise<Uint8Array>;
  submit?(ctx: ConnectorContext, assignmentId: string, files: { name: string; bytes: Uint8Array }[]): Promise<void>;
  sendMessage?(ctx: ConnectorContext, msg: { to: string[]; subject: string; body: string; threadId?: string }): Promise<void>;
}

export class NotImplementedYet extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (see docs/roadmap in README.md)`);
  }
}
