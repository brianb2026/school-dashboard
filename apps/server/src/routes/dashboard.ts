import {
  dayKey,
  findConflicts,
  gpa,
  matchCategory,
  mergeAssignments,
  resolveCourseGrade,
  workloadByDay,
  type AssignmentKind,
  type AssignmentView,
  type AttendanceSummary,
  type CourseView,
  type DashboardData,
  type GradeEntry,
  type Notice,
  type SourceId,
  type WorkloadDay,
} from "@sd/core";
import type { SchoolConfig } from "../config.js";
import {
  lastSyncAt,
  listAnnouncements,
  listAssignments,
  listAttendance,
  listAttendanceSummaries,
  listCourses,
  listFiles,
  listGrades,
  listMessages,
  listOverall,
  listOverrides,
  listSchemes,
  listUnassigned,
  type Db,
} from "../db/client.js";
import { listSyllabi } from "../syllabus-apply.js";

/** What the dashboard needs to know that isn't in the database. */
export interface DashboardExtras {
  links: DashboardData["links"];
  syncing: boolean;
  ai: { provider: string };
  notifications: boolean;
}

const ORIGIN: [SourceId[], string][] = [
  [["blackboard-session", "blackboard-rest"], "Blackboard"],
  [["gradescope"], "Gradescope"],
  [["blackboard-ical"], "Calendar feed"],
  [["syllabus"], "Syllabus"],
  [["manual"], "You"],
];
// Which grade to believe when several sources have one: yours, then Blackboard, then Gradescope.
const GRADE_RANK: Partial<Record<SourceId, number>> = { manual: 0, "blackboard-rest": 1, "blackboard-session": 1, gradescope: 2 };

export function buildDashboard(db: Db, cfg: SchoolConfig, extras: DashboardExtras, now = new Date()): DashboardData {
  const allCourses = listCourses(db);
  const visible = allCourses.filter((c) => !c.hidden);
  const visibleIds = new Set(visible.map((c) => c.id));
  const overrides = listOverrides(db);
  const stored = listAssignments(db);
  const raw = stored.filter((a) => (a.courseId === "unassigned" || visibleIds.has(a.courseId)) && !overrides.get(a.id)?.hidden);
  const { assignments: merged, primaryOf } = mergeAssignments(raw, cfg.timezone);
  const mergedIds = new Set(merged.map((a) => a.id));

  // One grade per item, following merged duplicates to the row that is shown.
  const gradeOf = new Map<string, GradeEntry>();
  for (const g of listGrades(db)) {
    const id = primaryOf.get(g.assignmentId) ?? g.assignmentId;
    if (!mergedIds.has(id)) continue;
    const prev = gradeOf.get(id);
    if (!prev || (GRADE_RANK[g.source.source] ?? 9) < (GRADE_RANK[prev.source.source] ?? 9)) gradeOf.set(id, { ...g, assignmentId: id });
  }

  const schemes = new Map(listSchemes(db).map((s) => [s.courseId, s]));
  const nowIso = now.toISOString();
  const assignments: AssignmentView[] = merged.map((a) => {
    const g = gradeOf.get(a.id);
    const ov = overrides.get(a.id);
    const scheme = schemes.get(a.courseId);
    const userDone = ov?.done === true;
    const done = userDone || a.status === "submitted" || a.status === "graded" || a.status === "excused" || g?.score !== undefined;
    const sources = new Set(a.sources.map((s) => s.source));
    return {
      ...a,
      effortHours: ov?.effortHours ?? a.effortHours,
      score: g?.score,
      possible: g?.score !== undefined ? g.pointsPossible : undefined,
      gradedAt: g?.gradedAt,
      scoreIsYours: g?.score !== undefined && g.source.source === "manual" ? true : undefined,
      done,
      userDone,
      late: !done && (a.status === "missing" || a.status === "late"),
      categoryResolved: ov?.category ?? (scheme ? matchCategory(a, scheme.categories) : a.category),
      origin: ORIGIN.find(([ids]) => ids.some((id) => sources.has(id)))?.[1] ?? "You",
      manual: a.sources.length > 0 && a.sources.every((s) => s.source === "manual"),
    };
  });

  const overall = listOverall(db).filter((o) => visibleIds.has(o.courseId));
  const summaries = listAttendanceSummaries(db);
  const attendance = listAttendance(db).filter((r) => visibleIds.has(r.courseId));
  const syllabi = listSyllabi(db);
  const grades = [...gradeOf.values()];

  const courses: CourseView[] = visible.map((c) => {
    const scheme = schemes.get(c.id);
    const mine = assignments.filter((a) => a.courseId === c.id);
    const cutoffs = c.letterCutoffs?.length ? c.letterCutoffs : cfg.letterCutoffs;
    const grade = resolveCourseGrade({
      scheme,
      assignments: mine,
      grades: grades.filter((g) => mine.some((a) => a.id === g.assignmentId)),
      overall: overall.filter((o) => o.courseId === c.id),
      cutoffs,
      prefer: c.gradeSource,
      categoryOf: (a) => (a as AssignmentView).categoryResolved,
    });
    const marks = attendance.filter((r) => r.courseId === c.id);
    const counted = marks.filter((r) => r.status !== "excused");
    const fromLog: AttendanceSummary | undefined = counted.length
      ? {
          courseId: c.id,
          present: marks.filter((r) => r.status === "present").length,
          late: marks.filter((r) => r.status === "late").length,
          absent: marks.filter((r) => r.status === "absent").length,
          excused: marks.length - counted.length,
          total: marks.length,
          percent: (counted.filter((r) => r.status !== "absent").length / counted.length) * 100,
          label: `${counted.filter((r) => r.status !== "absent").length} of ${counted.length} classes (your log)`,
          source: { source: "manual", fetchedAt: nowIso },
        }
      : undefined;
    const own = syllabi.filter((s) => s.courseId === c.id);
    return {
      ...c,
      grade,
      scheme: scheme?.categories,
      schemeFrom: scheme ? (scheme.source.source === "syllabus" ? "syllabus" : "you") : undefined,
      cutoffs,
      cutoffsFrom: c.letterCutoffs?.length ? (c.letterCutoffsFrom ?? "manual") : "school",
      attendance:
        summaries.find((s) => s.courseId === c.id && s.source.source !== "qwickly") ?? summaries.find((s) => s.courseId === c.id) ?? fromLog,
      // Weights you set yourself count as settled: a pulled syllabus is then only for reference.
      syllabus: own.some((s) => s.confirmed) || (scheme && own.length) ? "applied" : own.length ? "review" : "none",
    };
  });

  const scaleName = cfg.gpa.scale;
  const scale = cfg.gpa.scales[scaleName];
  const lettered = courses.filter((c) => c.grade.letter);
  const g = scale && lettered.length ? gpa(lettered.map((c) => ({ letter: c.grade.letter!, credits: c.credits, level: c.level })), scale) : undefined;

  // Next 14 days, including empty ones, so the heatmap always has 14 cells.
  const open = assignments.filter((a) => !a.done).map((a) => ({ ...a, status: "upcoming" as const }));
  const loads = workloadByDay(open, cfg.timezone);
  const conflicts = findConflicts(open, cfg.timezone, cfg.workload.conflictThresholdPerDay, cfg.workload.heavyAssignmentKinds as AssignmentKind[]).filter(
    (c) => c.day >= dayKey(nowIso, cfg.timezone),
  );
  const conflictDays = new Set(conflicts.map((c) => c.day));
  const workload: WorkloadDay[] = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(new Date(now.getTime() + i * 86_400_000).toISOString(), cfg.timezone);
    const l = loads.get(day);
    return { day, hours: Math.round((l?.hours ?? 0) * 10) / 10, count: l?.assignments.length ?? 0, conflict: conflictDays.has(day) };
  });

  const unmatchedCount = listUnassigned(db).length;
  const notices: Notice[] = [];
  const { links } = extras;
  if (links.blackboard.expired) notices.push({ id: "bb-expired", level: "warn", text: "Blackboard sign-in expired. Reconnect to keep everything current.", action: "link-blackboard" });
  if (links.gradescope.expired) notices.push({ id: "gs-expired", level: "warn", text: "Gradescope sign-in expired.", action: "link-gradescope" });
  if (links.blackboard.linked && !links.blackboard.expired && visible.length === 0 && lastSyncAt(db)) {
    notices.push({ id: "no-courses", level: "warn", text: "Blackboard is linked, but no current classes were found. Settings → What's connected shows what the last sync saw.", view: "Settings" });
  }
  if (unmatchedCount > 0) {
    notices.push({ id: "unmatched", level: "warn", text: `${unmatchedCount} calendar item${unmatchedCount === 1 ? " isn't" : "s aren't"} matched to a course yet.`, view: "Settings" });
  }
  const review = syllabi.filter((s) => !s.confirmed && !(s.courseId && schemes.has(s.courseId))).length;
  if (review > 0) notices.push({ id: "syllabus-review", level: "info", text: `${review} syllabus${review === 1 ? " needs" : "es need"} a quick check before the weights are used.`, view: "Syllabi" });
  const needSyllabus = courses.filter((c) => c.syllabus === "none" && !c.scheme && c.grade.basis !== "blackboard" && links.blackboard.linked);
  if (needSyllabus.length) {
    notices.push({
      id: "no-syllabus",
      level: "info",
      text: `No syllabus found for ${needSyllabus.map((c) => c.code).join(", ")}. Upload it to get the weighted grade.`,
      view: "Syllabi",
    });
  }
  const loose = courses.filter((c) => c.grade.basis === "syllabus" && c.grade.uncategorized > 0);
  if (loose.length) {
    const n = loose.reduce((s, c) => s + c.grade.uncategorized, 0);
    notices.push({ id: "uncategorized", level: "info", text: `${n} graded item${n === 1 ? "" : "s"} in ${loose.map((c) => c.code).join(", ")} fit no grading category.`, view: "Grades" });
  }

  return {
    hasData: allCourses.length > 0 || stored.length > 0,
    school: cfg.school,
    term: cfg.term,
    timezone: cfg.timezone,
    courses,
    hiddenCourses: allCourses.filter((c) => c.hidden).map((c) => ({ id: c.id, code: c.code, name: c.name })),
    assignments,
    grades,
    overall,
    workload,
    conflicts,
    gpa: g ? { ...g, scale: scaleName } : undefined,
    gpaScale: scale,
    announcements: listAnnouncements(db).filter((a) => !a.courseId || visibleIds.has(a.courseId)),
    messages: listMessages(db),
    files: listFiles(db).filter((f) => visibleIds.has(f.courseId)),
    attendance,
    notices,
    unmatchedCount,
    lastSyncAt: lastSyncAt(db),
    syncing: extras.syncing,
    links,
    ai: extras.ai,
    notifications: extras.notifications,
  };
}
