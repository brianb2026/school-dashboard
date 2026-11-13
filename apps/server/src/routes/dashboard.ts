import {
  courseGrade,
  dayKey,
  dedupeAssignments,
  findConflicts,
  gpa,
  letterFor,
  workloadByDay,
  type AssignmentKind,
  type DashboardCourse,
  type DashboardData,
  type WorkloadDay,
} from "@sd/core";
import type { SchoolConfig } from "../config.js";
import {
  lastSyncAt,
  listAnnouncements,
  listAssignments,
  listCourses,
  listGrades,
  listMessages,
  listSchemes,
  listUnassigned,
  type Db,
} from "../db/client.js";

export function buildDashboard(db: Db, cfg: SchoolConfig, now = new Date()): DashboardData {
  const courses = listCourses(db);
  const schemes = new Map(listSchemes(db).map((s) => [s.courseId, s]));
  const grades = listGrades(db);
  const all = listAssignments(db);
  const categoryById = new Map(all.map((a) => [a.id, a.category]));
  const assignments = dedupeAssignments(
    all.filter((a) => !a.dueAt || a.dueAt >= new Date(now.getTime() - 7 * 86_400_000).toISOString()),
    cfg.timezone,
  );

  const dashCourses: DashboardCourse[] = courses.map((c) => {
    const scheme = schemes.get(c.id);
    if (!scheme) return { ...c, hasScheme: false };
    const g = courseGrade(scheme, grades.filter((x) => x.courseId === c.id), (id) => categoryById.get(id));
    return {
      ...c,
      hasScheme: true,
      grade: {
        percent: g.percent,
        letter: g.percent === undefined ? undefined : letterFor(g.percent, cfg.letterCutoffs),
        weightGraded: g.weightGraded,
      },
    };
  });

  const scaleName = cfg.gpa.scale;
  const scale = cfg.gpa.scales[scaleName];
  const graded = dashCourses.filter((c) => c.grade?.letter);
  const g = scale && graded.length ? gpa(graded.map((c) => ({ letter: c.grade!.letter!, credits: c.credits, level: c.level })), scale) : undefined;

  // Next 14 days, including empty ones, so the heatmap always has 14 cells.
  const loads = workloadByDay(assignments, cfg.timezone);
  const conflicts = findConflicts(assignments, cfg.timezone, cfg.workload.conflictThresholdPerDay, cfg.workload.heavyAssignmentKinds as AssignmentKind[]);
  const conflictDays = new Set(conflicts.map((c) => c.day));
  const workload: WorkloadDay[] = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(new Date(now.getTime() + i * 86_400_000).toISOString(), cfg.timezone);
    const l = loads.get(day);
    return { day, hours: l?.hours ?? 0, count: l?.assignments.length ?? 0, conflict: conflictDays.has(day) };
  });

  return {
    hasData: courses.length > 0 || all.length > 0,
    school: cfg.school,
    term: cfg.term,
    timezone: cfg.timezone,
    courses: dashCourses,
    assignments,
    workload,
    conflicts,
    gpa: g ? { ...g, scale: scaleName } : undefined,
    announcements: listAnnouncements(db),
    messages: listMessages(db),
    unmatchedCount: listUnassigned(db).length,
    lastSyncAt: lastSyncAt(db),
  };
}
