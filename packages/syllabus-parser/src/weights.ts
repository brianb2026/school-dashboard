import { CELL, PARA } from "./extract-text.js";

export interface ParsedWeight {
  name: string;
  weight: number;
  dropLowest?: number;
  /** The syllabus line it came from, shown in the review screen. */
  line: string;
}

export interface WeightsResult {
  weights: ParsedWeight[];
  total: number;
  /** Weights add up to ~100 and at least two were found. */
  confident: boolean;
}

const NUM: Record<string, number> = { one: 1, two: 2, both: 2, three: 3, four: 4, five: 5 };
const num = (s: string | undefined): number | undefined => (s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()]);
const PCT = String.raw`(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)`;
const NAME = String.raw`[A-Za-z][A-Za-z0-9 &/'’#.,-]{1,58}`;

// "Homework ........ 20%", "Midterm Exams (2)   25 %", "Final exam: 30 percent", "Labs - 15 %"
const NAME_FIRST = new RegExp(String.raw`^\s*[-•*·]?\s*(${NAME}?(?:\s*\([^)%]{1,30}\))?)\s*(?:[.:\-–—=]+\s*|\s{2,}|\t+|\s)${PCT}\s*\)?\s*$`, "i");
// "30% Homework assignments (2 dropped)", "60% Exams (30% Midterm, 30% Final)", "20% - Quizzes"
const PCT_FIRST = new RegExp(String.raw`^\s*[-•*·]?\s*${PCT}\s*[-–—:]?\s*(${NAME}?)\s*(\(.*\))?\s*$`, "i");
const BARE_PCT = new RegExp(String.raw`^\s*${PCT}\s*$`, "i");

const NOT_A_CATEGORY = /\b(late|penalty|deduct|curve|extra credit|bonus|per day)\b|\boff\b/i;
const NOT_A_NAME = /^(total|sum|overall|grade|grades|final grade|course grade|letter grade|percent|percentage|weight|category|component)$/i;
// A real category name is a short label, not a clause.
const CLAUSE = /\b(of|will|is|are|if|you|your|that|which|from|needed|guarantee|least)\b/i;

function cleanName(raw: string): string {
  return raw.replace(/[\s(.:\-–—,]+$/, "").replace(/\s{2,}/g, " ").trim();
}

function okName(name: string): boolean {
  return name.length >= 3 && name.length <= 60 && !/^[A-F][+-]?$/i.test(name) && !NOT_A_NAME.test(name) && !CLAUSE.test(name) && name.split(/\s+/).length <= 7;
}

/** "(2 dropped)", "(lowest dropped)", "(drop lowest 2)" → how many are dropped. */
function dropsIn(paren: string | undefined): number | undefined {
  if (!paren) return undefined;
  const m = /(\d+|one|two|three)\s+(?:lowest\s+)?dropped|drop(?:s|ped)?\s+(?:the\s+)?(?:lowest\s+)?(\d+|one|two|three)|lowest\s+(\d+|one|two|three)?\s*dropped/i.exec(paren);
  if (!m) return undefined;
  return num(m[1] ?? m[2] ?? m[3]) ?? 1;
}

/** "(30% Midterm, 30% Final)" → the parts, when they are spelled out. */
function partsIn(paren: string | undefined, line: string): ParsedWeight[] {
  if (!paren) return [];
  const parts: ParsedWeight[] = [];
  for (const m of paren.matchAll(new RegExp(String.raw`${PCT}\s+([A-Za-z][A-Za-z ]{1,30}?)(?=\s*(?:,|;|\)|and\b|$))`, "gi"))) {
    const name = cleanName(m[2]!);
    if (okName(name)) parts.push({ name: name[0]!.toUpperCase() + name.slice(1), weight: Number(m[1]), line });
  }
  return parts;
}

function fromLines(text: string): ParsedWeight[] {
  const out: ParsedWeight[] = [];
  const seen = new Set<string>();
  const add = (w: ParsedWeight) => {
    const key = w.name.toLowerCase();
    if (seen.has(key) || !okName(w.name) || !(w.weight > 0 && w.weight <= 100)) return;
    seen.add(key);
    out.push(w);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    // A table row: one cell is a bare percent, another is the name.
    if (line.includes(CELL.trim())) {
      const cells = line.split(CELL.trim()).map((c) => c.split(PARA.trim())[0]!.trim());
      const pcts = cells.filter((c) => BARE_PCT.test(c));
      const name = cells.find((c) => c && !BARE_PCT.test(c) && /^[A-Za-z]/.test(c));
      if (pcts.length === 1 && name) {
        const paren = /\(([^)]*)\)/.exec(name)?.[1];
        add({ name: cleanName(name.replace(/\s*\([^)]*\)\s*$/, "")), weight: Number(BARE_PCT.exec(pcts[0]!)![1]), dropLowest: dropsIn(paren), line: line.trim() });
      }
      continue;
    }
    if (NOT_A_CATEGORY.test(line)) continue;

    const p = PCT_FIRST.exec(line);
    if (p) {
      const weight = Number(p[1]);
      const name = cleanName(p[2] ?? "");
      const parts = partsIn(p[3], line.trim());
      // "60% Exams (30% Midterm, 30% Final)": use the parts when they add up to the whole.
      if (parts.length >= 2 && Math.abs(parts.reduce((s, x) => s + x.weight, 0) - weight) < 0.01) parts.forEach(add);
      else add({ name, weight, dropLowest: dropsIn(p[3]), line: line.trim() });
      continue;
    }
    const n = NAME_FIRST.exec(line);
    if (n) add({ name: cleanName(n[1]!), weight: Number(n[2]), line: line.trim() });
  }
  return out;
}

/** "20% homework, 40% final, 20% each for the two midterms" inside a sentence. */
function fromProse(text: string): ParsedWeight[] {
  const flat = text.replace(/-\r?\n(?=[a-z])/g, "").replace(/\s*\r?\n\s*/g, " ");
  let best: ParsedWeight[] = [];
  for (const sentence of flat.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
    if (!/%|percent/i.test(sentence)) continue;
    const found: ParsedWeight[] = [];
    const re = new RegExp(String.raw`${PCT}\s+(each\s+)?(?:(?:for|on|from|to)\s+)?(?:(?:the|your|a)\s+)?(?:(two|three|four|both|\d)\s+)?([A-Za-z][A-Za-z /&-]{2,40}?)(?=\s*(?:,|;|\.|\band\b|$))`, "gi");
    for (const m of sentence.matchAll(re)) {
      const count = m[2] ? (num(m[3]) ?? 1) : 1;
      const name = cleanName(m[4]!);
      if (!okName(name)) continue;
      found.push({ name: name[0]!.toUpperCase() + name.slice(1), weight: Number(m[1]) * count, line: sentence.trim().slice(0, 200) });
    }
    const total = found.reduce((s, w) => s + w.weight, 0);
    if (found.length >= 2 && Math.abs(total - 100) <= 0.5 && found.length > best.length) best = found;
  }
  return best;
}

const stem = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).map((t) => (t === "hw" || t === "homeworks" ? "homework" : t.length > 3 ? t.replace(/s$/, "") : t));

/** "Your lowest written HW score will be dropped", "I will drop your lowest 2 homework grades". */
function applyProseDrops(text: string, weights: ParsedWeight[]): void {
  const flat = text.replace(/\s*\r?\n\s*/g, " ");
  const hits: { n: number; what: string }[] = [];
  for (const m of flat.matchAll(/lowest\s+(?:(\d+|one|two|three)\s+)?([a-z ]{0,30}?)\s*(?:grades?|scores?)\s+(?:will be|are|is|gets?)\s+dropped/gi)) {
    hits.push({ n: num(m[1]) ?? 1, what: m[2] ?? "" });
  }
  for (const m of flat.matchAll(/drop\s+(?:your\s+|the\s+)?(?:(\d+|one|two|three)\s+)?lowest\s+(?:(\d+|one|two|three)\s+)?([a-z ]{0,30}?)\s*(?:grades?|scores?)/gi)) {
    hits.push({ n: num(m[1] ?? m[2]) ?? 1, what: m[3] ?? "" });
  }
  for (const h of hits) {
    const want = new Set(stem(h.what));
    const target = weights.find((w) => stem(w.name).some((t) => want.has(t)));
    if (target && target.dropLowest === undefined) target.dropLowest = h.n;
  }
}

/**
 * Pull "category → weight %" out of a syllabus with plain rules. Handles a
 * list ("Homework 20%" or "20% Homework"), a Word table, parts in brackets
 * ("60% Exams (30% Midterm, 30% Final)"), and weights written into a sentence.
 * Letter-grade tables ("A 93%") are ignored.
 */
export function extractWeights(text: string): WeightsResult {
  const sum = (ws: ParsedWeight[]) => Math.round(ws.reduce((s, w) => s + w.weight, 0) * 100) / 100;
  const ok = (ws: ParsedWeight[]) => ws.length >= 2 && Math.abs(sum(ws) - 100) <= 0.5;
  let weights = fromLines(text);
  if (!ok(weights)) {
    const prose = fromProse(text);
    if (ok(prose)) weights = prose;
  }
  applyProseDrops(text, weights);
  return { weights, total: sum(weights), confident: ok(weights) };
}
