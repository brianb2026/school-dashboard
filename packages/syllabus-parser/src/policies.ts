export interface ParsedPolicies {
  instructorEmails: string[];
  officeHours?: string;
  latePolicy?: string;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const OFFICE = /^\s*office hours?\s*[:\-–—]?\s*/i;
const LATE = /\blate (work|assignments?|submissions?|policy)\b/i;

/**
 * A policy paragraph: the matching line plus following lines that continue
 * the same sentence. Stops at a blank line, after a line that ends a
 * sentence, or before something that looks like a new heading.
 */
function paragraphFrom(lines: string[], start: number, maxChars = 400): string {
  const out = [lines[start]!.trim()];
  for (let i = start + 1; i < lines.length; i++) {
    const prev = out[out.length - 1]!;
    const next = lines[i]!.trim();
    if (!next || /[.!?]$/.test(prev)) break;
    if (/^[A-Z][A-Za-z ]{0,30}:?$/.test(next) && !/^[a-z]/.test(next)) break;
    out.push(next);
  }
  return out.join(" ").slice(0, maxChars);
}

/** Contact info and the late-work policy, by keyword. */
export function extractPolicies(text: string): ParsedPolicies {
  const lines = text.split(/\r?\n/);
  const instructorEmails = [...new Set(text.match(EMAIL) ?? [])];
  const officeLine = lines.find((l) => /office hours?/i.test(l) && l.trim().length > 14);
  const officeHours = officeLine ? officeLine.trim().replace(OFFICE, "") || undefined : undefined;
  // Consecutive late-work paragraphs ("Late work: …" then "Late policy: …") belong together.
  const parts: string[] = [];
  for (let i = lines.findIndex((l) => LATE.test(l)); i >= 0 && i < lines.length; ) {
    const para = paragraphFrom(lines, i);
    parts.push(para);
    let j = i + 1;
    while (j < lines.length && para.includes(lines[j]!.trim()) && lines[j]!.trim()) j++;
    i = j < lines.length && LATE.test(lines[j]!) ? j : -1;
  }
  const latePolicy = parts.length ? parts.join(" ").slice(0, 400) : undefined;
  return { instructorEmails, officeHours, latePolicy };
}
