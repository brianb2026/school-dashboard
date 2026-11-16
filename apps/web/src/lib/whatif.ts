import { gpa, resolveCourseGrade, type AssignmentView, type CourseView, type DashboardData, type GradeEntry, type ResolvedGrade } from "@sd/core";

/** A score you are trying out. Nothing is saved. */
export interface Trial {
  score: number;
  possible: number;
}

/**
 * Read a score the way people type it: "42", "42/50", "42 of 50", "84%",
 * "8,5". A bare number counts as points when the item has a point total,
 * else as a percent. Returns undefined for anything that isn't a score.
 */
export function readScore(text: string, possible?: number): Trial | undefined {
  const t = text.trim().replace(/,/g, ".").toLowerCase();
  if (!t) return undefined;
  let m = /^(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (m) {
    const out = Number(m[2]);
    return out > 0 ? { score: Number(m[1]), possible: out } : undefined;
  }
  m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  const base = possible && possible > 0 ? possible : 100;
  if (m) return { score: (Number(m[1]) / 100) * base, possible: base };
  m = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return { score: Number(m[1]), possible: base };
  return undefined;
}

export interface Projection {
  /** The grade from your work as it is (syllabus weights, else points). */
  now: ResolvedGrade;
  /** The same, with your tried scores in. */
  next: ResolvedGrade;
  gpaNow?: number;
  gpaNext?: number;
}

/** What the class grade (and GPA) would be with these tried scores. */
export function project(d: DashboardData, c: CourseView, trials: Record<string, Trial>): Projection {
  const mine = d.assignments.filter((a) => a.courseId === c.id);
  const ids = new Set(mine.map((a) => a.id));
  const grades = d.grades.filter((g) => ids.has(g.assignmentId));
  const input = {
    scheme: c.scheme ? { categories: c.scheme } : undefined,
    assignments: mine,
    grades,
    overall: [],
    cutoffs: c.cutoffs,
    prefer: c.scheme ? ("syllabus" as const) : ("points" as const),
    categoryOf: (a: AssignmentView | { id: string }) => (a as AssignmentView).categoryResolved,
  };
  const now = resolveCourseGrade(input);
  const tried: GradeEntry[] = Object.entries(trials).map(([assignmentId, t]) => ({
    assignmentId,
    courseId: c.id,
    score: t.score,
    pointsPossible: t.possible,
    source: { source: "manual", fetchedAt: "" },
  }));
  const next = resolveCourseGrade({ ...input, grades: [...grades.filter((g) => !(g.assignmentId in trials)), ...tried] });

  let gpaNow: number | undefined;
  let gpaNext: number | undefined;
  if (d.gpaScale) {
    const rows = (letterHere?: string) =>
      d.courses
        .map((x) => ({ letter: x.id === c.id ? letterHere : x.grade.letter, credits: x.credits, level: x.level }))
        .filter((r): r is { letter: string; credits: number; level: CourseView["level"] } => Boolean(r.letter));
    gpaNow = d.gpa?.gpa;
    // Only when a tried score moves this class's letter; every other class keeps its shown letter.
    if (Object.keys(trials).length > 0 && next.letter && next.letter !== now.letter) gpaNext = gpa(rows(next.letter), d.gpaScale)?.gpa;
  }
  return { now, next, gpaNow, gpaNext };
}
