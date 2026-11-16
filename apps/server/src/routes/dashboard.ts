import {
  dayKey,
  findConflicts,
  gpa,
  matchCategory,
  matchMaterials,
  mergeAssignments,
  completeScale,
  resolveCourseGrade,
  sisMeetings,
  sisUnits,
  sisView,
  workloadByDay,
  type AssignmentKind,
  type AssignmentView,
  type ChangeView,
  type CourseView,
  type DashboardData,
  type GradeEntry,
  type Notice,
  type SourceId,
  type WorkloadDay,
} from "@sd/core";
import type { SchoolConfig } from "../config.js";
import {
  getSetting,
  getSisRecord,
  listChanges,
  lastSyncAt,
  listAnnouncements,
  listAssignments,
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
  [["canvas"], "Canvas"],
  [["gradescope"], "Gradescope"],
  [["blackboard-ical"], "Calendar feed"],
  [["syllabus"], "Syllabus"],
  [["manual"], "You"],
];
type ScoreFrom = "Blackboard" | "Canvas" | "Gradescope" | "You";
const FROM: Partial<Record<SourceId, ScoreFrom>> = { manual: "You", "blackboard-rest": "Blackboard", "blackboard-session": "Blackboard", canvas: "Canvas", gradescope: "Gradescope" };

export function buildDashboard(db: Db, cfg: SchoolConfig, extras: DashboardExtras, now = new Date()): DashboardData {
  const allCourses = listCourses(db);
  const visible = allCourses.filter((c) => !c.hidden);
  const visibleIds = new Set(visible.map((c) => c.id));
  const overrides = listOverrides(db);
  const stored = listAssignments(db);
  const raw = stored.filter((a) => (a.courseId === "unassigned" || visibleIds.has(a.courseId)) && !overrides.get(a.id)?.hidden);
  const { assignments: merged, primaryOf } = mergeAssignments(raw, cfg.timezone);
  const mergedIds = new Set(merged.map((a) => a.id));
  const files = listFiles(db).filter((f) => visibleIds.has(f.courseId));

  // Every score on record per shown item (a merged duplicate's score follows to the row that is shown).
  const scoresOf = new Map<string, Map<ScoreFrom, GradeEntry>>();
  for (const g of listGrades(db)) {
    const id = primaryOf.get(g.assignmentId) ?? g.assignmentId;
    const from = FROM[g.source.source];
    if (!mergedIds.has(id) || !from || g.score === undefined) continue;
    const m = scoresOf.get(id) ?? new Map<ScoreFrom, GradeEntry>();
    m.set(from, { ...g, assignmentId: id });
    scoresOf.set(id, m);
  }
  /**
   * Which score counts. Yours always wins. When Blackboard and Gradescope both
   * have one, Gradescope is where the grading (and any regrade) happens and
   * Blackboard only receives a copy, so Gradescope wins unless you say otherwise.
   */
  const pick = (id: string): { g: GradeEntry; from: ScoreFrom } | undefined => {
    const m = scoresOf.get(id);
    if (!m) return undefined;
    const want = overrides.get(id)?.gradeFrom;
    // "blackboard" here means the class's learning system, Blackboard or Canvas.
    const order: ScoreFrom[] = want === "blackboard" ? ["You", "Blackboard", "Canvas", "Gradescope"] : ["You", "Gradescope", "Blackboard", "Canvas"];
    const from = order.find((f) => m.has(f));
    return from ? { g: m.get(from)!, from } : undefined;
  };

  // What changed: one entry per real item (the same grade from Blackboard and Gradescope counts once).
  const changeRows = listChanges(db, 14);
  const movedFrom = new Map<string, string>();
  for (const ch of [...changeRows].reverse()) {
    if (ch.kind !== "due-moved" || !ch.data.from || now.getTime() - Date.parse(ch.at) > 7 * 86_400_000) continue;
    const id = primaryOf.get(ch.ref) ?? ch.ref;
    if (!movedFrom.has(id)) movedFrom.set(id, ch.data.from);
  }

  const schemes = new Map(listSchemes(db).map((s) => [s.courseId, s]));
  const nowIso = now.toISOString();
  const assignments: AssignmentView[] = merged.map((a) => {
    const chosen = pick(a.id);
    const g = chosen?.g;
    const all = [...(scoresOf.get(a.id) ?? [])].map(([from, x]) => ({ from, score: x.score!, possible: x.pointsPossible }));
    const pcts = all.filter((x) => x.from !== "You" && x.possible > 0).map((x) => (x.score / x.possible) * 100);
    const ov = overrides.get(a.id);
    const scheme = schemes.get(a.courseId);
    const userDone = ov?.done === true;
    const done = userDone || a.status === "submitted" || a.status === "graded" || a.status === "excused" || g?.score !== undefined;
    const sources = new Set(a.sources.map((s) => s.source));
    const materials = matchMaterials(a, files).map((f) => ({ id: f.id, name: f.name }));
    return {
      ...a,
      effortHours: ov?.effortHours ?? a.effortHours,
      ...(movedFrom.has(a.id) && a.dueAt && movedFrom.get(a.id) !== a.dueAt ? { movedFrom: movedFrom.get(a.id) } : {}),
      score: g?.score,
      possible: g?.score !== undefined ? g.pointsPossible : undefined,
      gradedAt: g?.gradedAt,
      scoreIsYours: chosen?.from === "You" ? true : undefined,
      scoreFrom: chosen?.from,
      scores: all.length > 1 ? all : undefined,
      scoresDiffer: pcts.length > 1 && Math.max(...pcts) - Math.min(...pcts) > 0.5 ? true : undefined,
      materials: materials.length ? materials : undefined,
      done,
      userDone,
      late: !done && (a.status === "missing" || a.status === "late"),
      categoryResolved: ov?.category ?? (scheme ? matchCategory(a, scheme.categories) : a.category),
      origin: ORIGIN.find(([ids]) => ids.some((id) => sources.has(id)))?.[1] ?? "You",
      manual: a.sources.length > 0 && a.sources.every((s) => s.source === "manual"),
    };
  });

  const overall = listOverall(db).filter((o) => visibleIds.has(o.courseId));
  const syllabi = listSyllabi(db);
  const grades = assignments.flatMap((a) => {
    const c = pick(a.id);
    return c ? [c.g] : [];
  });
  /** A syllabus whose weights were found but don't add up, for a class that has no weights yet. */
  const needsLook = (courseId: string) => syllabi.some((s) => s.courseId === courseId && s.parse.weights.weights.length > 0 && !s.parse.weights.confident);

  // The SIS knows when and where each class meets, and its units: used unless you set them yourself.
  const sisRecord = getSisRecord(db);
  const scaleName = cfg.gpa.scale;
  const scale = cfg.gpa.scales[scaleName];
  const courses: CourseView[] = visible.map((raw) => {
    const meetings = raw.meetings.length || raw.edited?.includes("meetings") ? raw.meetings : sisMeetings(sisRecord, raw.code);
    const units = raw.edited?.includes("credits") ? undefined : sisUnits(sisRecord, raw.code);
    const c = { ...raw, meetings, credits: units ?? raw.credits };
    const scheme = schemes.get(c.id);
    const mine = assignments.filter((a) => a.courseId === c.id);
    // A syllabus that only guarantees some letters ("over 90% is at least an A−") gets the rest from the usual scale.
    const scale = c.letterCutoffs?.length ? completeScale(c.letterCutoffs, cfg.letterCutoffs) : { cutoffs: cfg.letterCutoffs, filled: [] };
    const cutoffs = scale.cutoffs;
    const grade = resolveCourseGrade({
      scheme,
      assignments: mine,
      grades: grades.filter((g) => mine.some((a) => a.id === g.assignmentId)),
      overall: overall.filter((o) => o.courseId === c.id),
      cutoffs,
      prefer: c.gradeSource,
      categoryOf: (a) => (a as AssignmentView).categoryResolved,
    });
    const own = syllabi.filter((s) => s.courseId === c.id);
    return {
      ...c,
      grade,
      scheme: scheme?.categories,
      schemeFrom: scheme ? (scheme.source.source === "syllabus" ? "syllabus" : "you") : undefined,
      cutoffs,
      cutoffsFrom: c.letterCutoffs?.length ? (c.letterCutoffsFrom ?? "manual") : "school",
      ...(scale.filled.length ? { cutoffsFilled: scale.filled } : {}),
      syllabus: scheme ? "applied" : needsLook(c.id) || own.some((s) => !s.confirmed) ? "review" : own.length ? "applied" : "none",
    };
  });

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

  const shownIds = new Set(assignments.map((a) => a.id));
  const fileIds = new Set(files.map((f) => f.id));
  const changes: ChangeView[] = [];
  const dup = new Set<string>();
  for (const ch of changeRows) {
    if (ch.courseId && !visibleIds.has(ch.courseId)) continue;
    const isWork = ch.kind === "grade" || ch.kind === "due-moved" || ch.kind === "new-assignment";
    const ref = isWork ? (primaryOf.get(ch.ref) ?? ch.ref) : ch.ref;
    if (isWork && !shownIds.has(ref)) continue;
    if (ch.kind === "file" && !fileIds.has(ref)) continue;
    const key = `${ch.kind}:${ref}`;
    if (dup.has(key)) continue;
    dup.add(key);
    const a = isWork ? assignments.find((x) => x.id === ref) : undefined;
    changes.push({
      id: ch.id,
      at: ch.at,
      kind: ch.kind,
      courseId: ch.courseId,
      title: a?.title ?? ch.data.title ?? ch.data.name ?? "",
      ...(isWork ? { assignmentId: ref } : {}),
      ...(ch.kind === "file" ? { fileId: ref } : {}),
      ...(ch.kind === "announcement" ? { announcementId: ref } : {}),
      ...(ch.data.from ? { from: ch.data.from } : {}),
      ...(ch.data.to ? { to: ch.data.to } : {}),
      ...(ch.data.score !== undefined ? { score: ch.data.score, possible: ch.data.possible } : {}),
      ...(ch.data.was !== undefined ? { was: ch.data.was } : {}),
      seen: ch.seen,
    });
    if (changes.length >= 60) break;
  }

  const unmatchedCount = listUnassigned(db).length;
  const notices: Notice[] = [];
  const { links } = extras;
  if (links.blackboard.expired) notices.push({ id: "bb-expired", level: "warn", text: "Blackboard sign-in expired. Reconnect to keep everything current.", action: "link-blackboard" });
  if (links.gradescope.expired) notices.push({ id: "gs-expired", level: "warn", text: "Gradescope sign-in expired.", action: "link-gradescope" });
  if (links.sis.expired) notices.push({ id: "sis-expired", level: "warn", text: "SIS sign-in expired. Reconnect to read your record again.", action: "link-sis" });
  if (links.canvas.expired) notices.push({ id: "cv-expired", level: "warn", text: "Canvas sign-in expired. Reconnect to keep everything current.", action: "link-canvas" });
  for (const h of sisRecord?.holds ?? []) notices.push({ id: `hold:${h.title}`, level: "warn", text: `Hold on your record: ${h.title}. Registration may be blocked until it's cleared.`, action: "open-sis" });
  if (links.blackboard.linked && !links.blackboard.expired && visible.length === 0 && lastSyncAt(db)) {
    notices.push({ id: "no-courses", level: "warn", text: "Blackboard is linked, but no current classes were found. Settings → What's connected shows what the last sync saw.", view: "Settings" });
  }
  if (unmatchedCount > 0) {
    notices.push({ id: "unmatched", level: "warn", text: `${unmatchedCount} calendar item${unmatchedCount === 1 ? " isn't" : "s aren't"} matched to a course yet.`, view: "Settings" });
  }
  const review = courses.filter((c) => c.syllabus === "review");
  if (review.length > 0) {
    notices.push({
      id: "syllabus-review",
      level: "info",
      text: `The syllabus for ${review.map((c) => c.code).join(", ")} needs a quick check before its grading weights are used.`,
      view: "Syllabi",
    });
  }
  const noWeights = courses.filter((c) => !c.scheme && c.syllabus !== "review" && c.grade.basis !== "blackboard" && links.blackboard.linked);
  if (noWeights.length) {
    notices.push({
      id: "no-syllabus",
      level: "info",
      text: `No grading weights found yet for ${noWeights.map((c) => c.code).join(", ")}. Upload the syllabus, or enter the weights in Grades.`,
      view: "Syllabi",
    });
  }
  const loose = courses.filter((c) => c.grade.basis === "syllabus" && c.grade.uncategorized > 0);
  if (loose.length) {
    const n = loose.reduce((s, c) => s + c.grade.uncategorized, 0);
    notices.push({ id: "uncategorized", level: "info", text: `${n} graded item${n === 1 ? "" : "s"} in ${loose.map((c) => c.code).join(", ")} fit no grading category.`, view: "Grades" });
  }
  const differ = assignments.filter((a) => a.scoresDiffer).length;
  if (differ) {
    notices.push({
      id: "scores-differ",
      level: "info",
      text: `${differ} item${differ === 1 ? " has" : "s have"} a different score in Blackboard and Gradescope. The Gradescope score is used; you can switch it on the class page.`,
      view: "Home",
    });
  }

  return {
    hasData: allCourses.length > 0 || stored.length > 0,
    studentName: getSetting(db, "STUDENT_NAME"),
    changes,
    ...(sisRecord ? { sis: sisView(sisRecord, scale) } : {}),
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
    files,
    notices,
    unmatchedCount,
    lastSyncAt: lastSyncAt(db),
    syncing: extras.syncing,
    links,
    ai: extras.ai,
    notifications: extras.notifications,
  };
}
