import type { LetterCutoff } from "./types.js";

/** Letters from highest to lowest. */
const ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const rank = (l: string) => {
  const i = ORDER.indexOf(l.trim().toUpperCase().replace("−", "-"));
  return i < 0 ? 99 : i;
};

/**
 * A scale is partial when it names a letter's +/− but not the letter itself:
 * "over 90% guarantees at least an A−, over 80% at least a B−…" says nothing
 * about A, B+ or B.
 */
export function isPartialScale(scale: LetterCutoff[]): boolean {
  const have = new Set(scale.map((c) => c.letter.trim().toUpperCase()));
  return ["A", "B", "C"].some((base) => !have.has(base) && (have.has(`${base}-`) || have.has(`${base}+`)));
}

/**
 * Fill a partial scale with the usual one: the syllabus's letters stay
 * exactly as written (they're guarantees), and each missing letter comes
 * from the usual scale only where it fits in order between them.
 */
export function completeScale(scale: LetterCutoff[], usual: LetterCutoff[]): { cutoffs: LetterCutoff[]; filled: string[] } {
  if (!isPartialScale(scale)) return { cutoffs: scale, filled: [] };
  const fixed = [...scale].sort((a, b) => rank(a.letter) - rank(b.letter));
  const have = new Set(fixed.map((c) => c.letter.trim().toUpperCase()));
  const filled: string[] = [];
  const out = [...fixed];
  for (const u of usual) {
    const letter = u.letter.trim().toUpperCase();
    if (have.has(letter)) continue;
    // The nearest written letters above and below this one bound where it can go.
    const above = fixed.filter((f) => rank(f.letter) < rank(letter)).at(-1);
    const below = fixed.find((f) => rank(f.letter) > rank(letter));
    if (above && !(u.min < above.min)) continue;
    if (below && !(u.min > below.min)) continue;
    out.push({ letter: u.letter, min: u.min });
    filled.push(u.letter);
  }
  return { cutoffs: out.sort((a, b) => b.min - a.min || rank(a.letter) - rank(b.letter)), filled };
}
