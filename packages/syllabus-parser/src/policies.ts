export interface ParsedPolicies {
  instructorEmails: string[];
  officeHours?: string;
  latePolicy?: string;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Contact info and the late-work policy, by keyword. */
export function extractPolicies(text: string): ParsedPolicies {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const instructorEmails = [...new Set(text.match(EMAIL) ?? [])];
  const officeHours = lines.find((l) => /office hours?/i.test(l) && l.length > 14);
  const lateIdx = lines.findIndex((l) => /\blate (work|assignments?|submissions?|policy)\b/i.test(l));
  const latePolicy =
    lateIdx >= 0 ? lines.slice(lateIdx, lateIdx + 3).filter(Boolean).join(" ").slice(0, 400) : undefined;
  return { instructorEmails, officeHours, latePolicy };
}
