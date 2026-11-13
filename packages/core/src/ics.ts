import type { Assignment, Course } from "./types.js";

/** Escape text per RFC 5545 §3.3.11. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Export due dates as an .ics calendar you can subscribe to from Google or
 * Apple Calendar (served by the local server at /calendar.ics).
 */
export function assignmentsToIcs(assignments: Assignment[], courses: Course[], now = new Date()): string {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//school-dashboard//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:School deadlines",
  ];
  for (const a of assignments) {
    if (!a.dueAt) continue;
    const course = byId.get(a.courseId);
    const due = stamp(a.dueAt);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${esc(a.id)}@school-dashboard`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `DTSTART:${due}`,
      `DTEND:${due}`,
      `SUMMARY:${esc(`${course?.code ?? ""} ${a.title}`.trim())}`,
      `CATEGORIES:${esc(a.kind)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
