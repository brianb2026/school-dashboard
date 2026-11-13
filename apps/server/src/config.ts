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

/** config/school.json if you made one, else the committed example. */
export function loadSchoolConfig(path = process.env.SCHOOL_CONFIG ?? "./config/school.json"): SchoolConfig {
  const file = existsSync(path) ? path : "./config/school.example.json";
  return JSON.parse(readFileSync(file, "utf8")) as SchoolConfig;
}
