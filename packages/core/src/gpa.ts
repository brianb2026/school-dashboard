import type { CourseLevel } from "./types.js";

export interface GpaScale {
  weightByCredits: boolean;
  points: Record<string, number>;
  /** Extra points by course level, e.g. { ap: 1.0, honors: 0.5 }. Empty = unweighted. */
  levelBonus: Partial<Record<CourseLevel, number>>;
}

export interface GpaCourse {
  letter: string;
  credits: number;
  level: CourseLevel;
}

export interface GpaResult {
  gpa: number;
  /** Same courses with no level bonus, so weighted and unweighted can show side by side. */
  unweighted: number;
  credits: number;
}

export function gpa(courses: GpaCourse[], scale: GpaScale): GpaResult | undefined {
  const counted = courses.filter((c) => c.letter in scale.points);
  if (counted.length === 0) return undefined;
  let num = 0;
  let numUnweighted = 0;
  let den = 0;
  for (const c of counted) {
    const w = scale.weightByCredits ? c.credits : 1;
    const base = scale.points[c.letter]!;
    // No bonus on a failing grade.
    const bonus = base > 0 ? (scale.levelBonus[c.level] ?? 0) : 0;
    num += (base + bonus) * w;
    numUnweighted += base * w;
    den += w;
  }
  if (den === 0) return undefined;
  return { gpa: num / den, unweighted: numUnweighted / den, credits: den };
}
