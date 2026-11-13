import type { Assignment, AssignmentKind } from "./types.js";

/** Default effort guesses (hours) when you haven't set one. */
const DEFAULT_EFFORT: Record<AssignmentKind, number> = {
  homework: 1.5,
  quiz: 1,
  exam: 4,
  project: 6,
  paper: 5,
  lab: 2,
  discussion: 0.5,
  reading: 1,
  other: 1,
};

export function effortOf(a: Assignment): number {
  return a.effortHours ?? DEFAULT_EFFORT[a.kind];
}

/** Local calendar day key (YYYY-MM-DD) in the given IANA time zone. */
export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export interface DayLoad {
  day: string;
  hours: number;
  assignments: Assignment[];
}

/** Hours of work due per day: the data behind the workload heatmap. */
export function workloadByDay(assignments: Assignment[], timeZone: string): Map<string, DayLoad> {
  const out = new Map<string, DayLoad>();
  for (const a of assignments) {
    if (!a.dueAt || a.status === "submitted" || a.status === "graded" || a.status === "excused") continue;
    const day = dayKey(a.dueAt, timeZone);
    const entry = out.get(day) ?? { day, hours: 0, assignments: [] };
    entry.hours += effortOf(a);
    entry.assignments.push(a);
    out.set(day, entry);
  }
  return out;
}

export interface Conflict {
  day: string;
  reason: "too-many" | "multiple-heavy";
  assignments: Assignment[];
}

/**
 * Due-date collisions: a day with at least `threshold` items due, or two or
 * more "heavy" items (exams, projects, papers) due on the same day.
 */
export function findConflicts(
  assignments: Assignment[],
  timeZone: string,
  threshold = 3,
  heavyKinds: AssignmentKind[] = ["exam", "project", "paper"],
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const load of workloadByDay(assignments, timeZone).values()) {
    const heavy = load.assignments.filter((a) => heavyKinds.includes(a.kind));
    if (heavy.length >= 2) conflicts.push({ day: load.day, reason: "multiple-heavy", assignments: heavy });
    else if (load.assignments.length >= threshold)
      conflicts.push({ day: load.day, reason: "too-many", assignments: load.assignments });
  }
  return conflicts.sort((a, b) => a.day.localeCompare(b.day));
}
