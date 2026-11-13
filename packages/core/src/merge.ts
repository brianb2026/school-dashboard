import type { Assignment, AssignmentKind, GradingCategory, SourceId } from "./types.js";
import { dayKey } from "./workload.js";

const CATEGORY_WORDS: Record<AssignmentKind, RegExp> = {
  exam: /\b(exam|midterm|final|test)s?\b/i,
  quiz: /\bquiz(zes)?\b/i,
  homework: /\b(homework|hw|problem sets?|assignments?|psets?)\b/i,
  lab: /\blabs?\b/i,
  project: /\bprojects?\b/i,
  paper: /\b(papers?|essays?|writing)\b/i,
  discussion: /\b(discussions?|participation|posts?)\b/i,
  reading: /\b(readings?|reading responses?)\b/i,
  other: /$^/,
};

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z]+|\d+/g) ?? []).map((t) => (t.length > 3 ? t.replace(/s$/, "") : t)).filter((t) => t !== "due"));
}

function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** Grading category an item of this kind most likely counts toward, if any. */
export function categoryFor(kind: AssignmentKind, title: string, categories: GradingCategory[]): string | undefined {
  const byKind = categories.filter((c) => CATEGORY_WORDS[kind].test(c.name));
  if (byKind.length === 1) return byKind[0]!.name;
  if (byKind.length > 1) {
    // "Final Exam" vs "Midterm Exams": the one sharing the most words with the title wins.
    const t = tokens(title);
    return [...byKind].sort((a, b) => shared(tokens(b.name), t) - shared(tokens(a.name), t))[0]!.name;
  }
  return undefined;
}

/**
 * The scheme category an assignment counts toward: the source's own category
 * name if it lines up with one in the scheme, else a guess from kind and title.
 */
export function matchCategory(a: Pick<Assignment, "category" | "kind" | "title">, categories: GradingCategory[]): string | undefined {
  if (a.category) {
    const want = tokens(a.category);
    const exact = categories.find((c) => {
      const have = tokens(c.name);
      return have.size === want.size && shared(have, want) === want.size;
    });
    if (exact) return exact.name;
    const loose = categories.filter((c) => shared(tokens(c.name), want) > 0);
    if (loose.length === 1) return loose[0]!.name;
  }
  const byWord = categories.filter((c) => shared(tokens(c.name), tokens(a.title)) > 0 && CATEGORY_WORDS[a.kind].test(c.name));
  if (byWord.length === 1) return byWord[0]!.name;
  return categoryFor(a.kind, a.title, categories);
}

// ---------- the same item seen by several sources ----------

type Family = "blackboard" | "gradescope" | "calendar" | "syllabus" | "manual";
const FAMILY: Record<SourceId, Family> = {
  "blackboard-rest": "blackboard",
  "blackboard-session": "blackboard",
  gradescope: "gradescope",
  "blackboard-ical": "calendar",
  syllabus: "syllabus",
  manual: "manual",
  qwickly: "blackboard",
  gmail: "manual",
};
const RANK: Record<Family, number> = { blackboard: 4, gradescope: 3, calendar: 2, syllabus: 1, manual: 9 };

function familyOf(a: Assignment): Family {
  const fams = a.sources.map((s) => FAMILY[s.source]);
  return fams.sort((x, y) => RANK[y] - RANK[x])[0] ?? "manual";
}

function numbers(t: Set<string>): string[] {
  return [...t].filter((x) => /^\d+$/.test(x));
}

/** "Homework 3" is never "Homework 4"; but "Homework 3 - CSC 172" (calendar title) still is "Homework 3". */
function numbersClash(a: Set<string>, b: Set<string>): boolean {
  const na = numbers(a);
  const nb = numbers(b);
  if (!na.length || !nb.length) return false;
  const [small, big] = na.length <= nb.length ? [na, new Set(nb)] : [nb, new Set(na)];
  return !small.every((n) => big.has(n));
}

function sameItem(a: Assignment, b: Assignment, timeZone: string): boolean {
  const ta = tokens(a.title);
  const tb = tokens(b.title);
  if (numbersClash(ta, tb)) return false;
  const overlap = shared(ta, tb) / Math.max(1, Math.min(ta.size, tb.size));
  const days = a.dueAt && b.dueAt ? Math.abs(new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()) / 86_400_000 : undefined;
  if (overlap >= 0.75 && (days === undefined || days <= 7)) return true;
  if (a.dueAt && b.dueAt && dayKey(a.dueAt, timeZone) === dayKey(b.dueAt, timeZone)) {
    if (a.kind === b.kind && a.kind !== "other" && a.kind !== "homework" && a.kind !== "reading") return true;
    return overlap >= 0.5;
  }
  return false;
}

export interface MergeResult {
  /** One row per real item, best source first, sorted by due date. */
  assignments: Assignment[];
  /** Hidden duplicate id → the id it was merged into (so its grade can follow). */
  primaryOf: Map<string, string>;
}

/**
 * Collapse the same item reported by several sources into one row.
 * Blackboard beats Gradescope beats the calendar feed beats the syllabus;
 * things you added by hand are never merged away. Two rows from the same
 * source are never merged with each other.
 */
export function mergeAssignments(list: Assignment[], timeZone: string): MergeResult {
  const ranked = list.map((a) => ({ a, fam: familyOf(a) })).sort((x, y) => RANK[y.fam] - RANK[x.fam]);
  const kept: { a: Assignment; fams: Set<Family> }[] = [];
  const primaryOf = new Map<string, string>();
  for (const { a, fam } of ranked) {
    const hit =
      fam === "manual"
        ? undefined
        : kept.find((k) => k.a.courseId === a.courseId && !k.fams.has(fam) && !k.fams.has("manual") && sameItem(a, k.a, timeZone));
    if (!hit) {
      kept.push({ a, fams: new Set([fam]) });
      continue;
    }
    primaryOf.set(a.id, hit.a.id);
    hit.fams.add(fam);
    hit.a = {
      ...hit.a,
      dueAt: hit.a.dueAt ?? a.dueAt,
      pointsPossible: hit.a.pointsPossible ?? a.pointsPossible,
      category: hit.a.category ?? a.category,
      url: hit.a.url ?? a.url,
      // A submission seen by the lower source still counts.
      status: hit.a.status === "upcoming" && (a.status === "submitted" || a.status === "graded") ? a.status : hit.a.status,
      sources: [...hit.a.sources, ...a.sources],
    };
  }
  const assignments = kept
    .map((k) => k.a)
    .sort((x, y) => (x.dueAt ?? "9999").localeCompare(y.dueAt ?? "9999") || x.title.localeCompare(y.title));
  return { assignments, primaryOf };
}

/** Kept for callers that only need the merged list. */
export function dedupeAssignments(list: Assignment[], timeZone: string): Assignment[] {
  return mergeAssignments(list, timeZone).assignments;
}
