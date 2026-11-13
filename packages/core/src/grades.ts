import type {
  Assignment,
  CourseOverall,
  GradeEntry,
  GradeSourcePref,
  GradingScheme,
  LetterCutoff,
} from "./types.js";

export interface CategoryResult {
  name: string;
  weight: number;
  /** Percent earned in this category, or undefined if nothing is graded yet. */
  percent?: number;
  earned: number;
  possible: number;
  /** How many graded items counted (after drop-lowest). */
  count: number;
}

export interface CourseGrade {
  /** Weighted percent over graded categories only (re-normalized). */
  percent?: number;
  categories: CategoryResult[];
  /** Share of the total weight that has at least one graded item (0–100). */
  weightGraded: number;
}

/**
 * Weighted category grade. Categories with no graded work are left out and the
 * remaining weights are re-normalized, which is how most gradebooks show a
 * "current" grade mid-term.
 */
export function courseGrade(
  scheme: GradingScheme,
  grades: GradeEntry[],
  categoryOf: (assignmentId: string) => string | undefined,
): CourseGrade {
  const categories: CategoryResult[] = scheme.categories.map((cat) => {
    let entries = grades.filter(
      (g) => g.score !== undefined && !g.dropped && g.pointsPossible > 0 && categoryOf(g.assignmentId) === cat.name,
    );
    if (cat.dropLowest && entries.length > cat.dropLowest) {
      entries = [...entries]
        .sort((a, b) => a.score! / a.pointsPossible - b.score! / b.pointsPossible)
        .slice(cat.dropLowest);
    }
    const earned = entries.reduce((s, g) => s + g.score!, 0);
    const possible = entries.reduce((s, g) => s + g.pointsPossible, 0);
    return {
      name: cat.name,
      weight: cat.weight,
      earned,
      possible,
      count: entries.length,
      percent: possible > 0 ? (earned / possible) * 100 : undefined,
    };
  });

  const graded = categories.filter((c) => c.percent !== undefined);
  const weightGraded = graded.reduce((s, c) => s + c.weight, 0);
  const percent =
    weightGraded > 0
      ? graded.reduce((s, c) => s + c.percent! * c.weight, 0) / weightGraded
      : undefined;
  return { percent, categories, weightGraded };
}

/**
 * What-if: the percent you need on the remaining weight to finish at `target`.
 * `currentPercent` is over `weightGraded` percent of the course.
 * Returns a value that may be > 100 (not reachable) or < 0 (already locked in).
 */
export function requiredOnRemaining(
  currentPercent: number,
  weightGraded: number,
  target: number,
): number | undefined {
  const remaining = 100 - weightGraded;
  if (remaining <= 0) return undefined;
  return (target * 100 - currentPercent * weightGraded) / remaining;
}

export function letterFor(percent: number, cutoffs: LetterCutoff[]): string {
  const sorted = [...cutoffs].sort((a, b) => b.min - a.min);
  // Compare at two decimals so 89.999 isn't shown as "90.0% B+".
  const p = Math.round(percent * 100) / 100;
  return sorted.find((c) => p >= c.min)?.letter ?? sorted[sorted.length - 1]?.letter ?? "F";
}

// ---------- the class grade, from whatever is available ----------

export type GradeBasis = "blackboard" | "syllabus" | "points" | "none";

export interface GradeOption {
  basis: Exclude<GradeBasis, "none">;
  label: string;
  percent: number;
  letter: string;
  /** How much of the course this number covers (0–100). */
  weightGraded: number;
}

export interface ResolvedGrade {
  basis: GradeBasis;
  label: string;
  percent?: number;
  letter?: string;
  weightGraded: number;
  /** Syllabus-weight breakdown, when there is a grading scheme. */
  categories: CategoryResult[];
  /** Every way the grade can be computed right now, so the UI can show and switch them. */
  options: GradeOption[];
  /** Graded items that fit no category of the scheme (so the syllabus number ignores them). */
  uncategorized: number;
}

export interface ResolveInput {
  scheme?: Pick<GradingScheme, "categories">;
  /** This course's assignments (already de-duplicated). */
  assignments: Assignment[];
  /** This course's grades, one per assignment. */
  grades: GradeEntry[];
  overall?: CourseOverall[];
  cutoffs: LetterCutoff[];
  prefer?: GradeSourcePref;
  categoryOf: (a: Assignment) => string | undefined;
}

const OVERALL_RANK: Record<CourseOverall["kind"], number> = { "weighted-total": 0, overall: 1, total: 2 };

/**
 * The class grade. In "auto" the order is:
 *   1. Blackboard's own weighted/overall grade (the instructor's number),
 *   2. syllabus weights applied to your graded work,
 *   3. Blackboard's plain "Total",
 *   4. points earned / points possible.
 * Every available option is returned so nothing is hidden.
 */
export function resolveCourseGrade(input: ResolveInput): ResolvedGrade {
  const byId = new Map(input.assignments.map((a) => [a.id, a]));
  const counted = input.grades.filter((g) => {
    if (g.score === undefined || g.dropped || !(g.pointsPossible > 0)) return false;
    const a = byId.get(g.assignmentId);
    return a ? a.countsTowardGrade !== false : false;
  });
  const options: (GradeOption & { rank: number })[] = [];
  let categories: CategoryResult[] = [];
  let uncategorized = 0;

  const bb = (input.overall ?? [])
    .filter((o) => o.percent !== undefined && Number.isFinite(o.percent))
    .sort((a, b) => OVERALL_RANK[a.kind] - OVERALL_RANK[b.kind])[0];
  if (bb) {
    options.push({
      basis: "blackboard",
      label: `Blackboard “${bb.label}”`,
      percent: bb.percent!,
      letter: bb.letter ?? letterFor(bb.percent!, input.cutoffs),
      weightGraded: 100,
      rank: bb.kind === "total" ? 3 : 1,
    });
  }

  if (input.scheme && input.scheme.categories.length > 0) {
    const names = new Set(input.scheme.categories.map((c) => c.name));
    const catOf = (id: string) => {
      const a = byId.get(id);
      return a ? input.categoryOf(a) : undefined;
    };
    const cg = courseGrade({ courseId: "", source: { source: "manual", fetchedAt: "" }, categories: input.scheme.categories }, counted, catOf);
    categories = cg.categories;
    uncategorized = counted.filter((g) => !names.has(catOf(g.assignmentId) ?? "")).length;
    if (cg.percent !== undefined) {
      options.push({
        basis: "syllabus",
        label: "Syllabus weights",
        percent: cg.percent,
        letter: letterFor(cg.percent, input.cutoffs),
        weightGraded: cg.weightGraded,
        rank: 2,
      });
    }
  }

  const earned = counted.reduce((s, g) => s + g.score!, 0);
  const possible = counted.reduce((s, g) => s + g.pointsPossible, 0);
  if (possible > 0) {
    const allPossible = input.assignments
      .filter((a) => a.countsTowardGrade !== false)
      .reduce((s, a) => s + (a.pointsPossible ?? 0), 0);
    const pct = (earned / possible) * 100;
    options.push({
      basis: "points",
      label: "Points so far",
      percent: pct,
      letter: letterFor(pct, input.cutoffs),
      weightGraded: allPossible > 0 ? Math.min(100, Math.round((possible / allPossible) * 100)) : 0,
      rank: 4,
    });
  }

  options.sort((a, b) => a.rank - b.rank);
  const preferred = input.prefer && input.prefer !== "auto" ? options.find((o) => o.basis === input.prefer) : undefined;
  const pick = preferred ?? options[0];
  const clean = options.map(({ rank: _rank, ...o }) => o);
  if (!pick) return { basis: "none", label: "No grades yet", weightGraded: 0, categories, options: clean, uncategorized };
  return {
    basis: pick.basis,
    label: pick.label,
    percent: pick.percent,
    letter: pick.letter,
    weightGraded: pick.weightGraded,
    categories,
    options: clean,
    uncategorized,
  };
}

export interface TrendPoint {
  at: string;
  percent: number;
  title: string;
}

/** The running class grade after each graded item, oldest first (for the trend line). */
export function gradeTrend(input: ResolveInput): TrendPoint[] {
  const byId = new Map(input.assignments.map((a) => [a.id, a]));
  const dated = input.grades
    .filter((g) => g.score !== undefined && !g.dropped && byId.has(g.assignmentId))
    .map((g) => ({ g, at: g.gradedAt ?? byId.get(g.assignmentId)!.dueAt ?? "" }))
    .filter((x) => x.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const out: TrendPoint[] = [];
  const soFar: GradeEntry[] = [];
  const prefer: GradeSourcePref = input.scheme?.categories.length ? "syllabus" : "points";
  for (const { g, at } of dated) {
    soFar.push(g);
    // Blackboard's total is a single snapshot, so the trend always uses your graded items.
    const r = resolveCourseGrade({ ...input, grades: soFar, overall: [], prefer });
    if (r.percent !== undefined) out.push({ at, percent: r.percent, title: byId.get(g.assignmentId)!.title });
  }
  return out;
}
