import { existsSync, readFileSync } from "node:fs";
import type { GpaScale, LetterCutoff } from "@sd/core";

export interface SchoolConfig {
  school: string;
  timezone: string;
  term: { name: string; start: string; end: string };
  gpa: { scale: string; scales: Record<string, GpaScale> };
  letterCutoffs: LetterCutoff[];
  workload: { conflictThresholdPerDay: number; heavyAssignmentKinds: string[] };
  notifications: { dueSoonHours: number[] };
}

const DAY = 86_400_000;

/**
 * The term in effect today. A term written in config/school.json is used
 * while today falls inside it (give or take six weeks); otherwise the term is
 * worked out from the calendar, so nothing needs editing each semester.
 */
export function resolveTerm(configured: SchoolConfig["term"] | undefined, now = new Date()): SchoolConfig["term"] {
  if (configured?.start && configured.end) {
    const t = now.getTime();
    if (t >= Date.parse(configured.start) - 45 * DAY && t <= Date.parse(configured.end) + 45 * DAY) return configured;
  }
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m <= 5) return { name: `Spring ${y}`, start: `${y}-01-10`, end: `${y}-05-20` };
  if (m <= 7) return { name: `Summer ${y}`, start: `${y}-06-01`, end: `${y}-08-10` };
  return { name: `Fall ${y}`, start: `${y}-08-20`, end: `${y}-12-22` };
}

/** config/school.json if you made one, else the committed example; the term always matches today. */
export function loadSchoolConfig(path = process.env.SCHOOL_CONFIG ?? "./config/school.json", now = new Date()): SchoolConfig {
  const file = existsSync(path) ? path : "./config/school.example.json";
  const cfg = JSON.parse(readFileSync(file, "utf8")) as SchoolConfig;
  return { ...cfg, term: resolveTerm(cfg.term, now) };
}
