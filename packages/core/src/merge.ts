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

/** Dates and clock times written into a title ("due 9/11 11:59 pm", "(Week of 10/5)") say nothing about which item it is. */
export function stripDates(s: string): string {
  return s.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ").replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, " ");
}

const SAME_WORD: Record<string, string> = { hw: "homework", hmwk: "homework", mt: "midterm" };

function tokens(s: string): Set<string> {
  return new Set(
    (stripDates(s.toLowerCase()).match(/[a-z]+|\d+/g) ?? [])
      .map((t) => (t.length > 3 ? t.replace(/s$/, "") : t))
      .map((t) => SAME_WORD[t] ?? t)
      .filter((t) => t !== "due" && t !== "pm" && t !== "am"),
  );
}

function sharedWords(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t) && !/^\d+$/.test(t)) n++;
  return n;
}

function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

const isNumber = (w: string) => /^\d+$/.test(w);

/** Words of a category name that say what it is (no numbers, no filler). */
function nameWords(name: string): string[] {
  return [...tokens(name)].filter((w) => !isNumber(w) && !GENERIC.has(w));
}

/** "FA" for "Formal Assignment 2": the first letters of the name's words. */
function initials(name: string): string {
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.length >= 2 ? words.map((w) => w[0]).join("") : "";
}

/**
 * How well a title points at a category: real words they share, plus the
 * category's initials used as a word ("FA #2 First Draft"). Numbers never
 * count by themselves ("pg. 1-15" is not "Formal Assignment 1").
 */
function affinity(title: Set<string>, name: string): number {
  const ini = initials(name);
  return nameWords(name).filter((w) => title.has(w)).length + (ini && title.has(ini) ? 2 : 0);
}

/** Among equally good categories: the one whose number is in the title, else the one with no number (the general bucket). */
function breakTie(title: Set<string>, cands: GradingCategory[], named = true): GradingCategory | undefined {
  if (cands.length <= 1) return cands[0];
  const nums = (c: GradingCategory) => [...tokens(c.name)].filter(isNumber);
  // A number only settles it between categories the title actually names ("FA #2" among the Formal Assignments).
  const numbered = named ? cands.filter((c) => nums(c).length > 0 && nums(c).every((n) => title.has(n))) : [];
  if (numbered.length === 1) return numbered[0];
  const plain = cands.filter((c) => nums(c).length === 0);
  return plain.length === 1 ? plain[0] : undefined;
}

/** The category a title names, if it names exactly one. */
function namedCategory(title: Set<string>, categories: GradingCategory[], skip?: RegExp): string | undefined {
  const scored = categories.map((c) => ({ c, n: skip && nameWords(c.name).every((w) => skip.test(w)) ? 0 : affinity(title, c.name) }));
  const top = Math.max(0, ...scored.map((x) => x.n));
  if (top === 0) return undefined;
  return breakTie(title, scored.filter((x) => x.n === top).map((x) => x.c))?.name;
}

/** Grading category an item of this kind most likely counts toward, if any. */
export function categoryFor(kind: AssignmentKind, title: string, categories: GradingCategory[]): string | undefined {
  const byKind = categories.filter((c) => CATEGORY_WORDS[kind].test(c.name));
  if (byKind.length === 1) return byKind[0]!.name;
  if (byKind.length > 1) {
    // "Final Exam" vs "Midterm Exams": the one the title points at wins; failing that, the general bucket, else the first.
    const t = tokens(title);
    const top = Math.max(...byKind.map((c) => affinity(t, c.name)));
    const best = byKind.filter((c) => affinity(t, c.name) === top);
    return (breakTie(t, best, top > 0) ?? best[0]!).name;
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
    const loose = categories.filter((c) => nameWords(c.name).some((w) => want.has(w)));
    if (loose.length === 1) return loose[0]!.name;
  }
  const t = tokens(a.title);
  const byWord = categories.filter((c) => affinity(t, c.name) > 0 && CATEGORY_WORDS[a.kind].test(c.name));
  if (byWord.length === 1) return byWord[0]!.name;
  // "Homework" is also what an unrecognized title gets called. When the title itself doesn't say so
  // ("Week 4 Workshop", "FA #2 First Draft"), a category it names is better evidence than that guess.
  if (a.kind === "homework" && !CATEGORY_WORDS.homework.test(a.title)) {
    const hit = namedCategory(t, categories, /^(exam|midterm|final|test|quiz)$/);
    if (hit) return hit;
  }
  const byKind = categoryFor(a.kind, a.title, categories);
  if (byKind) return byKind;
  // Readings and viewings count for nothing unless the syllabus has a category for them.
  if (a.kind === "reading") return undefined;
  // A title that names exactly one category ("Workshop Attendance" → "Workshop attendance/participation").
  const hit = namedCategory(t, categories);
  if (hit) return hit;
  // Showing up is participating.
  if (/\b(attendance|participation)\b/i.test(a.title)) {
    const part = categories.filter((c) => /attendance|participation/i.test(c.name));
    if (part.length === 1) return part[0]!.name;
  }
  // Labs, problem sets and projects are all "the homework" when the syllabus has a single such category.
  if (WORK.has(a.kind)) {
    const work = categories.filter((c) => WORK_NAME.test(c.name));
    if (work.length === 1) return work[0]!.name;
  }
  return undefined;
}

// Compared after the same trimming tokens() does ("class" → "clas").
const GENERIC = tokens("assignment assignments class week of the and for due grade grades");
const WORK = new Set<AssignmentKind>(["homework", "lab", "project"]);
const WORK_NAME = /\b(homework|hw|assignments?|labs?|problem sets?|projects?|exercises?)\b/i;

// ---------- the same item seen by several sources ----------

type Family = "blackboard" | "gradescope" | "calendar" | "syllabus" | "manual";
const FAMILY: Record<SourceId, Family> = {
  "blackboard-rest": "blackboard",
  "blackboard-session": "blackboard",
  canvas: "blackboard",
  sis: "calendar",
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

const refSpace = (r: string) => r.slice(0, r.indexOf(":") + 1);

/**
 * How sure we are that two rows are the same item: 0 = they are not,
 * higher = surer. The sources' own ids settle it either way; otherwise the
 * titles have to share a real word (a number alone proves nothing: "Webwork 1"
 * is not "HW1" just because both are due the same night).
 */
function likeness(a: Assignment, b: Assignment, timeZone: string): number {
  const ra = a.externalRefs ?? [];
  const rb = b.externalRefs ?? [];
  if (ra.some((r) => rb.includes(r))) return 10;
  // Both name a Gradescope (or other) item, and not the same one: different items, however alike the titles.
  if (ra.some((r) => rb.some((q) => refSpace(q) === refSpace(r)))) return 0;
  const ta = tokens(a.title);
  const tb = tokens(b.title);
  if (numbersClash(ta, tb)) return 0;
  const overlap = shared(ta, tb) / Math.max(1, Math.min(ta.size, tb.size));
  const words = sharedWords(ta, tb);
  const days = a.dueAt && b.dueAt ? Math.abs(new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()) / 86_400_000 : undefined;
  const same = Boolean(a.dueAt && b.dueAt && dayKey(a.dueAt, timeZone) === dayKey(b.dueAt, timeZone));
  if (words > 0 && overlap >= 0.75 && (days === undefined || days <= 7)) return 2 + overlap + (same ? 0.5 : 0);
  if (same) {
    if (a.kind === b.kind && a.kind !== "other" && a.kind !== "homework" && a.kind !== "reading") return 1.5 + overlap;
    if (words > 0 && overlap >= 0.5) return 1 + overlap;
  }
  return 0;
}

function sameItem(a: Assignment, b: Assignment, timeZone: string): boolean {
  return likeness(a, b, timeZone) > 0;
}

function sameDay(a: Assignment, b: Assignment, timeZone: string): boolean {
  return Boolean(a.dueAt && b.dueAt && dayKey(a.dueAt, timeZone) === dayKey(b.dueAt, timeZone));
}

function otherSyllabus(a: Assignment, b: Assignment): boolean {
  const ids = (x: Assignment) => x.sources.filter((s) => s.source === "syllabus").map((s) => s.externalId);
  return !ids(a).some((id) => ids(b).includes(id));
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
    // Of everything it could be, take the surest match, not the first one found.
    let hit: (typeof kept)[number] | undefined;
    let best = 0;
    if (fam !== "manual") {
      for (const k of kept) {
        if (k.a.courseId !== a.courseId || k.fams.has("manual")) continue;
        // Two syllabus pages naming the same exam on the same day ("Midterm 1", "Midterm Exam 1") are one item.
        if (k.fams.has(fam) && !(fam === "syllabus" && otherSyllabus(a, k.a) && sameDay(a, k.a, timeZone))) continue;
        const score = likeness(a, k.a, timeZone);
        if (score > best) {
          best = score;
          hit = k;
        }
      }
    }
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
      externalRefs: [...new Set([...(hit.a.externalRefs ?? []), ...(a.externalRefs ?? [])])],
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
