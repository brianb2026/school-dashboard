import type { Course } from "./types.js";

/** A manual fix-up: "anything whose text contains `pattern` belongs to `courseId`". */
export interface CourseAlias {
  pattern: string;
  courseId: string;
}

// "CHEM 101", "CHEM-101", "chem101", "CHEM-101-002", "MATH 221H", "CS_150"
const CODE_SRC = String.raw`\b([A-Za-z]{2,5})[\s\-_.]?(\d{2,4}[A-Za-z]?)\b`;

/** Canonical form of a course code: letters + number, upper case, no separators. */
export function courseKey(code: string): string | undefined {
  const m = new RegExp(CODE_SRC).exec(code);
  return m ? `${m[1]!.toUpperCase()}${m[2]!.toUpperCase()}` : undefined;
}

/** Every course-code-looking token in a piece of text, canonicalized. */
export function codesIn(text: string): string[] {
  return [...text.matchAll(new RegExp(CODE_SRC, "g"))].map((m) => `${m[1]!.toUpperCase()}${m[2]!.toUpperCase()}`);
}

/**
 * Which course does this text (a calendar title, an email subject, a
 * syllabus header) belong to? Order: your manual aliases, then course code,
 * then full course name. Returns undefined when unsure, so the item lands in
 * the "Unmatched" list for you to fix instead of being guessed wrong.
 */
export function matchCourse(text: string, courses: Course[], aliases: CourseAlias[] = []): string | undefined {
  const lower = text.toLowerCase();
  const known = new Set(courses.map((c) => c.id));
  for (const a of [...aliases].sort((x, y) => y.pattern.length - x.pattern.length)) {
    if (a.pattern && lower.includes(a.pattern.toLowerCase()) && known.has(a.courseId)) return a.courseId;
  }
  const tokens = new Set(codesIn(text));
  const byCode = courses.filter((c) => {
    const k = courseKey(c.code);
    return k !== undefined && tokens.has(k);
  });
  if (byCode.length === 1) return byCode[0]!.id;
  const byName = courses.filter((c) => c.name.length >= 4 && lower.includes(c.name.toLowerCase()));
  if (byName.length === 1) return byName[0]!.id;
  return undefined;
}
