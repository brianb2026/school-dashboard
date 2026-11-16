import type { AssignmentView, CourseFile, CourseView, DashboardData } from "@sd/core";

/** Files worth studying from whatever their date: practice exams, study guides, review sheets. */
const REVIEW = /practice|review|sample|study\s*guide|old\s*(exam|test|midterm)|past\s*(exam|test|midterm)|exam\s*(material|prep)|cheat\s*sheet|formula\s*sheet|solutions?/i;
/** Course paperwork that isn't study material. */
const SKIP = /syllab|schedule|calendar|policy|policies|course info/i;

export function isExam(a: AssignmentView): boolean {
  return a.kind === "exam" || /\b(midterm|final|exam|test)\b/i.test(a.title);
}

export interface PrepPack {
  exam: AssignmentView;
  course?: CourseView;
  /** The stretch of class the exam most likely covers: since the previous exam (or the start of term). */
  from: string;
  to: string;
  review: CourseFile[];
  lectures: CourseFile[];
  work: AssignmentView[];
  readings: AssignmentView[];
}

/** "Midterm 2" → ["midterm", "2"]: words that tie a practice file to this exam rather than another. */
function examWords(title: string): string[] {
  return (title.toLowerCase().match(/[a-z]+|\d+/g) ?? []).filter((w) => w.length > 1 || /\d/.test(w)).filter((w) => !["exam", "the", "and"].includes(w));
}

/**
 * Everything to study for one exam, from what the class already has:
 * practice and review files first (best match to this exam on top), the
 * lecture files posted since the last exam, your work from that stretch
 * (lowest scores first, since those are the gaps), and its readings.
 */
export function prepPack(d: DashboardData, examId: string): PrepPack | undefined {
  const exam = d.assignments.find((a) => a.id === examId);
  if (!exam?.dueAt) return undefined;
  const to = exam.dueAt;
  const mine = d.assignments.filter((a) => a.courseId === exam.courseId);
  const before = mine.filter((a) => a.id !== exam.id && isExam(a) && a.dueAt && a.dueAt < to).sort((a, b) => b.dueAt!.localeCompare(a.dueAt!))[0];
  const from = before?.dueAt ?? new Date(`${d.term.start}T00:00:00`).toISOString();
  const inWindow = (iso?: string) => Boolean(iso) && iso! > from && iso! <= to;

  const files = d.files.filter((f) => f.courseId === exam.courseId && !f.isSyllabus);
  const words = examWords(exam.title);
  const score = (f: CourseFile) => words.filter((w) => `${f.name} ${f.folder.join(" ")}`.toLowerCase().includes(w)).length;
  const review = files
    .filter((f) => REVIEW.test(`${f.name} ${f.folder.join(" ")}`) && !SKIP.test(f.name))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const reviewIds = new Set(review.map((f) => f.id));
  const lectures = files
    .filter((f) => !reviewIds.has(f.id) && inWindow(f.modified) && !SKIP.test(`${f.name} ${f.folder.join(" ")}`))
    .sort((a, b) => (a.modified ?? "").localeCompare(b.modified ?? ""));

  const pct = (a: AssignmentView) => (a.score !== undefined && a.possible ? a.score / a.possible : 2);
  const work = mine
    .filter((a) => a.id !== exam.id && !isExam(a) && a.kind !== "reading" && inWindow(a.dueAt))
    .sort((a, b) => pct(a) - pct(b) || a.dueAt!.localeCompare(b.dueAt!));
  const readings = mine.filter((a) => a.kind === "reading" && inWindow(a.dueAt)).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));

  return { exam, course: d.courses.find((c) => c.id === exam.courseId), from, to, review, lectures, work, readings };
}
