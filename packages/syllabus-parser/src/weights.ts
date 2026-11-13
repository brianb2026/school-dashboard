export interface ParsedWeight {
  name: string;
  weight: number;
  /** The syllabus line it came from, shown in the review screen. */
  line: string;
}

export interface WeightsResult {
  weights: ParsedWeight[];
  total: number;
  /** Weights add up to ~100 and at least two were found. */
  confident: boolean;
}

// "Homework ........ 20%", "Exams (2 x 25%)" is skipped, "Final exam: 30 percent", "Labs - 15 %"
const WEIGHT_LINE =
  /^\s*[-•*·]?\s*([A-Za-z][A-Za-z0-9 &/'’()-]{1,48}?)\s*(?:[.:\-–—=|]+\s*|\(\s*|\s{2,}|\t+|\s)(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)\s*\)?\s*$/i;

// "20% Homework"
const WEIGHT_FIRST = /^\s*[-•*·]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)\s*[-–—:]?\s*([A-Za-z][A-Za-z0-9 &/'’()-]{1,48})\s*$/i;

const NOT_A_CATEGORY = /\b(late|penalty|deduct|attendance policy|curve|extra credit|bonus|off|per day)\b/i;

/**
 * Pull "category → weight %" pairs out of syllabus text with plain rules.
 * Letter-grade tables ("A 93%") are ignored because names must be 2+ letters
 * and not a grade letter.
 */
export function extractWeights(text: string): WeightsResult {
  const weights: ParsedWeight[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || NOT_A_CATEGORY.test(line)) continue;
    let name: string | undefined;
    let pct: number | undefined;
    const m = WEIGHT_LINE.exec(line);
    if (m) {
      name = m[1];
      pct = Number(m[2]);
    } else {
      const f = WEIGHT_FIRST.exec(line);
      if (f) {
        pct = Number(f[1]);
        name = f[2];
      }
    }
    if (!name || pct === undefined) continue;
    name = name.replace(/[\s(.:\-–—]+$/, "").trim();
    if (/^[A-F][+-]?$/i.test(name) || name.length < 3 || pct <= 0 || pct > 100) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    weights.push({ name, weight: pct, line: line.trim() });
  }
  const total = weights.reduce((s, w) => s + w.weight, 0);
  return { weights, total, confident: weights.length >= 2 && Math.abs(total - 100) <= 0.5 };
}
