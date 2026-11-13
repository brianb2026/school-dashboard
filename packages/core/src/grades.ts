import type { GradeEntry, GradingScheme } from "./types.js";

export interface CategoryResult {
  name: string;
  weight: number;
  /** Percent earned in this category, or undefined if nothing is graded yet. */
  percent?: number;
  earned: number;
  possible: number;
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
      (g) => g.score !== undefined && !g.dropped && categoryOf(g.assignmentId) === cat.name,
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

export interface LetterCutoff {
  letter: string;
  min: number;
}

export function letterFor(percent: number, cutoffs: LetterCutoff[]): string {
  const sorted = [...cutoffs].sort((a, b) => b.min - a.min);
  return sorted.find((c) => percent >= c.min)?.letter ?? sorted[sorted.length - 1]?.letter ?? "F";
}
