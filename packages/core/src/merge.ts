import type { Assignment, AssignmentKind, GradingCategory } from "./types.js";
import { dayKey } from "./workload.js";

const CATEGORY_WORDS: Record<AssignmentKind, RegExp> = {
  exam: /\b(exam|midterm|final|test)s?\b/i,
  quiz: /\bquiz(zes)?\b/i,
  homework: /\b(homework|hw|problem sets?|assignments?)\b/i,
  lab: /\blabs?\b/i,
  project: /\bprojects?\b/i,
  paper: /\b(papers?|essays?|writing)\b/i,
  discussion: /\b(discussions?|participation|posts?)\b/i,
  reading: /\b(readings?|reading responses?)\b/i,
  other: /$^/,
};

/** Grading category an item of this kind most likely counts toward, if any. */
export function categoryFor(kind: AssignmentKind, title: string, categories: GradingCategory[]): string | undefined {
  // "Final project" belongs to Projects even though "final" also hints at exams.
  const byKind = categories.filter((c) => CATEGORY_WORDS[kind].test(c.name));
  if (byKind.length === 1) return byKind[0]!.name;
  if (byKind.length > 1) {
    const lower = title.toLowerCase();
    return byKind.find((c) => lower.includes(c.name.toLowerCase().replace(/s$/, "")))?.name ?? byKind[0]!.name;
  }
  return undefined;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function similar(a: Assignment, b: Assignment): boolean {
  if (a.kind === b.kind && a.kind !== "other" && a.kind !== "homework" && a.kind !== "reading") return true;
  const ta = tokens(a.title);
  const tb = tokens(b.title);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.max(1, Math.min(ta.size, tb.size)) >= 0.5;
}

/**
 * Hide syllabus-planned items once Blackboard (or another live source) has the
 * same thing: same course, same local day, same kind or mostly the same title.
 */
export function dedupeAssignments(list: Assignment[], timeZone: string): Assignment[] {
  const isSyllabus = (a: Assignment) => a.sources.every((s) => s.source === "syllabus");
  const live = list.filter((a) => !isSyllabus(a));
  return list.filter((a) => {
    if (!isSyllabus(a) || !a.dueAt) return true;
    const day = dayKey(a.dueAt, timeZone);
    return !live.some((b) => b.courseId === a.courseId && b.dueAt && dayKey(b.dueAt, timeZone) === day && similar(a, b));
  });
}
