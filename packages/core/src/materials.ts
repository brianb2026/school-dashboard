import { stripDates } from "./merge.js";
import type { Assignment, CourseFile } from "./types.js";

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "others", "other", "reading", "readings", "read", "chapter", "chapters",
  "page", "pages", "watch", "due", "lecture", "week", "class", "part", "into", "about", "your", "their", "them", "have", "having", "among", "were",
]);

function words(s: string): string[] {
  return (stripDates(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z]+|\d+/g) ?? []).filter((w) => (/^\d+$/.test(w) || w.length >= 3) && !STOP.has(w));
}

function numbersClash(a: string[], b: string[]): boolean {
  const na = a.filter((x) => /^\d+$/.test(x));
  const nb = b.filter((x) => /^\d+$/.test(x));
  if (!na.length || !nb.length) return false;
  const [small, big] = na.length <= nb.length ? [na, new Set(nb)] : [nb, new Set(na)];
  return !small.every((n) => big.has(n));
}

/**
 * Course files that go with an assignment, best first: the handout named like
 * the assignment ("Lab 3" → "Lab 3.pdf") or the reading by its author
 * ("Bunn, “How to Read Like a Writer”" → "bunn--how-to-read.pdf").
 */
export function matchMaterials(a: Pick<Assignment, "title" | "courseId" | "kind" | "contentId">, files: CourseFile[], limit = 3): CourseFile[] {
  const title = words(a.title);
  if (!title.length) return [];
  const set = new Set(title);
  // "Bunn, …" / "Graff & Birkenstein, …": the surname(s) before the first comma or quote.
  const authors = new Set(words(a.title.split(/[,“"(]/)[0] ?? "").filter((w) => !/^\d+$/.test(w)));
  const scored: { f: CourseFile; score: number }[] = [];
  for (const f of files) {
    if (f.courseId !== a.courseId || f.isSyllabus) continue;
    if (a.contentId && f.contentId === a.contentId) {
      scored.push({ f, score: 100 });
      continue;
    }
    const name = words(f.name.replace(/\.[a-z0-9]{2,5}$/i, ""));
    if (!name.length || numbersClash(title, name)) continue;
    const shared = name.filter((w) => set.has(w));
    const sharedWords = shared.filter((w) => !/^\d+$/.test(w)).length;
    // A number alone proves nothing ("Chapter 5.1" is not "week1"): a real word has to match too.
    const whole = sharedWords >= 1 && name.every((w) => set.has(w));
    // "Lab 3" → "Lab 3 handout.pdf": the whole numbered title sits inside the file name.
    const nameSet = new Set(name);
    const titled = sharedWords >= 1 && title.some((w) => /^\d+$/.test(w)) && title.every((w) => nameSet.has(w));
    const byAuthor = a.kind === "reading" && authors.size > 0 && authors.size <= 3 && name.some((w) => authors.has(w)) && authors.has(name[0]!);
    if (whole || titled || byAuthor || sharedWords >= 2) scored.push({ f, score: (whole ? 20 : 0) + (titled ? 15 : 0) + (byAuthor ? 10 : 0) + shared.length });
  }
  // The same file posted in two folders is offered once.
  const names = new Set<string>();
  return scored
    .sort((x, y) => y.score - x.score || x.f.name.length - y.f.name.length)
    .filter((x) => {
      const key = x.f.name.toLowerCase().replace(/\s+/g, " ").trim();
      if (names.has(key)) return false;
      names.add(key);
      return true;
    })
    .slice(0, limit)
    .map((x) => x.f);
}
