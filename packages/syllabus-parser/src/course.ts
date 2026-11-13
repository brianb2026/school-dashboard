export interface ParsedCourseHeader {
  /** As written in the syllabus, e.g. "CHEM 101". */
  code?: string;
  /** e.g. "General Chemistry I". */
  title?: string;
}

const CODE = /\b([A-Z]{2,5})[\s\-_]?(\d{2,4}[A-Z]?)\b/;
const TERM = /\b(spring|summer|fall|autumn|winter)\s*(\d{4})?\b|\b\d{4}\b/gi;

/** Course code and title from the first lines of a syllabus, used to suggest a course match. */
export function extractCourseHeader(text: string): ParsedCourseHeader {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 15);
  for (const line of lines) {
    const m = CODE.exec(line);
    if (!m) continue;
    const code = `${m[1]} ${m[2]}`;
    const title = line
      .slice((m.index ?? 0) + m[0].length)
      .replace(/^[-–—:\s|]*(?:section\s*\S+)?[-–—:\s|]*/i, "")
      .replace(TERM, "")
      .replace(/[-–—:|,\s]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { code, title: title.length >= 3 ? title : undefined };
  }
  return {};
}
