export interface ParsedCourseHeader {
  /** As written in the syllabus, e.g. "CHEM 101". */
  code?: string;
  /** e.g. "General Chemistry I". */
  title?: string;
}

const CODE = /\b([A-Za-z]{2,5})[\s\-_]?(\d{2,4}[A-Z]?)\b/;
// Day codes and place words that look like a course code but aren't ("MW 11", "Room 201").
const NOT_CODE = /^(m|t|w|r|f|mw|mwf|tr|tth|wf|mf|room|rm|hall|page|week|fall|spring|unit|ch|sec|suite|box|ext)$/i;
const TERM = /\b(spring|summer|fall|autumn|winter)\s*(\d{4})?\b|\b\d{4}\b/gi;

/** Course code and title from the first lines of a syllabus, used to suggest a course match. */
export function extractCourseHeader(text: string): ParsedCourseHeader {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const line of lines) {
    const m = CODE.exec(line);
    if (!m || NOT_CODE.test(m[1]!) || /office|hours|class:|room|phone/i.test(line) || line.split(/\s+/).length > 14) continue;
    // A real code is written in capitals ("CHEM 101") or sits on a line that names the course.
    if (m[1] !== m[1]!.toUpperCase() && !/syllabus|course/i.test(line) && m[1]![0] !== m[1]![0]!.toUpperCase()) continue;
    const code = `${m[1]!.toUpperCase()} ${m[2]}`;
    const title = line
      .slice((m.index ?? 0) + m[0].length)
      .replace(/^[-–—:\s|]*(?:section\s*\S+)?[-–—:\s|]*/i, "")
      .replace(/\bsyllabus\b/gi, "")
      .replace(TERM, "")
      .replace(/[-–—:|,\s]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { code, title: title.length >= 3 ? title : undefined };
  }
  return {};
}
