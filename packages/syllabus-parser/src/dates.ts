import type { AssignmentKind } from "@sd/core";

export interface ParsedDate {
  /** YYYY-MM-DD (no time; syllabi rarely give one). */
  date: string;
  title: string;
  kind: AssignmentKind;
  line: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_NAME =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
const NUMERIC = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

// Most specific first: "Final project" is a project, "Lab report" is a lab.
const KIND_WORDS: [AssignmentKind, RegExp][] = [
  ["project", /\bproject\b/i],
  ["lab", /\blab\b/i],
  ["quiz", /\bquiz/i],
  ["exam", /\b(exam|midterm|final|test)\b/i],
  ["paper", /\b(paper|essay|report)\b/i],
  ["homework", /\b(homework|hw|problem set|pset|assignment)\b/i],
  ["reading", /\b(read|reading|chapter|ch\.)\b/i],
  ["discussion", /\b(discussion|post)\b/i],
];

const DUE_HINT = /\b(due|exam|midterm|final|quiz|test|project|paper|essay|homework|hw|lab|presentation|submit)\b/i;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Find dated deliverables in a syllabus schedule. Only lines that both carry a
 * date and mention a deliverable are kept; the user confirms each one in the
 * review screen before it becomes an Assignment.
 */
export function extractDates(text: string, termStart: string): ParsedDate[] {
  const startYear = Number(termStart.slice(0, 4));
  const startMonth = Number(termStart.slice(5, 7));
  const out: ParsedDate[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !DUE_HINT.test(line)) continue;
    let month: number | undefined;
    let day: number | undefined;
    let year: number | undefined;
    let matchText = "";
    const m = MONTH_NAME.exec(line);
    if (m) {
      month = MONTHS[m[1]!.toLowerCase().slice(0, m[1]!.toLowerCase().startsWith("sept") ? 4 : 3)];
      day = Number(m[2]);
      year = m[3] ? Number(m[3]) : undefined;
      matchText = m[0];
    } else {
      const n = NUMERIC.exec(line);
      if (n) {
        month = Number(n[1]);
        day = Number(n[2]);
        year = n[3] ? Number(n[3].length === 2 ? `20${n[3]}` : n[3]) : undefined;
        matchText = n[0];
      }
    }
    if (!month || !day || month > 12 || day > 31) continue;
    // Fall term running into January: months before the start month are next year.
    year ??= month < startMonth ? startYear + 1 : startYear;
    const kind = KIND_WORDS.find(([, re]) => re.test(line))?.[0] ?? "other";
    const title =
      line
        .replace(matchText, "")
        .replace(/^\s*(week|wk)\.?\s*\d+\b[\s:\-–—|,]*/i, "")
        .replace(/^\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*/i, "")
        .replace(/^[\s:\-–—|,]+|[\s:\-–—|,]+$/g, "")
        .replace(/\s{2,}/g, " ") || kind;
    out.push({ date: `${year}-${pad(month)}-${pad(day)}`, title, kind, line });
  }
  return out;
}
