import type { SisView } from "./api.js";
import type { GpaScale } from "./gpa.js";
import { courseKey } from "./match.js";
import type { Meeting, SisRecord } from "./types.js";

/** Rows that never count toward a GPA, whatever their grade column says. */
const NOT_COUNTED = /drop|withdr|cancel|audit|transfer/i;

/** A letter's points: the school's scale, with A+ counted as an A where the scale has no A+. */
function points(grade: string | undefined, scale: GpaScale): number | undefined {
  if (!grade) return undefined;
  const g = grade.trim().toUpperCase();
  if (g in scale.points) return scale.points[g];
  if (g === "A+" && "A" in scale.points) return scale.points.A;
  return undefined;
}

function gpaOf(rows: SisRecord["history"], scale: GpaScale): { gpa?: number; units: number } {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const p = points(r.grade, scale);
    const u = r.units ?? 0;
    if (p === undefined || !(u > 0) || NOT_COUNTED.test(r.status ?? "")) continue;
    num += p * u;
    den += u;
  }
  return den > 0 ? { gpa: Math.round((num / den) * 1000) / 1000, units: den } : { units: 0 };
}

/**
 * The SIS record as the dashboard shows it: terms in the order the SIS
 * lists them, newest last, each with its GPA, and the cumulative GPA from
 * every letter-graded course (pass/fail, withdrawn and in-progress rows
 * don't count, the same way a transcript treats them).
 */
export function sisView(r: SisRecord, scale: GpaScale | undefined): SisView {
  const order: string[] = [];
  const byTerm = new Map<string, SisRecord["history"]>();
  for (const row of r.history) {
    if (!byTerm.has(row.term)) order.push(row.term);
    byTerm.set(row.term, [...(byTerm.get(row.term) ?? []), row]);
  }
  const terms = order.map((term) => {
    const rows = byTerm.get(term)!;
    const g = scale ? gpaOf(rows, scale) : { units: 0 };
    return { term, ...(g.gpa !== undefined ? { gpa: g.gpa } : {}), units: g.units, courses: rows.map(({ term: _t, ...c }) => c) };
  });
  const all = scale ? gpaOf(r.history, scale) : { units: 0 };
  return {
    ...(all.gpa !== undefined ? { gpa: all.gpa } : {}),
    units: all.units,
    terms,
    holds: r.holds,
    todos: r.todos,
    enrollment: r.enrollment,
    fetchedAt: r.fetchedAt,
  };
}

/** When a class meets, by the SIS schedule (lecture, lab and discussion times alike). */
export function sisMeetings(r: SisRecord | undefined, code: string): Meeting[] {
  const key = courseKey(code);
  if (!r || !key) return [];
  const out: Meeting[] = [];
  const seen = new Set<string>();
  for (const s of r.schedule) {
    if (courseKey(s.code) !== key || !s.start || !s.end) continue;
    for (const weekday of s.days) {
      const id = `${weekday}${s.start}${s.end}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ weekday, start: s.start, end: s.end, ...(s.room ? { location: s.room } : {}) });
    }
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
}

/** A class's units on the record (this term's row, or the newest one). */
export function sisUnits(r: SisRecord | undefined, code: string): number | undefined {
  const key = courseKey(code);
  if (!r || !key) return undefined;
  const rows = r.history.filter((h) => courseKey(h.code) === key && (h.units ?? 0) > 0);
  return rows[rows.length - 1]?.units;
}
