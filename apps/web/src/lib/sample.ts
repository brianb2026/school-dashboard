/**
 * Made-up sample data so the UI has something to show before you connect
 * anything. Shown with a "Sample data" banner; replaced by /api/dashboard
 * as soon as you add a course, paste a calendar link, or confirm a syllabus.
 */
import type { DueItem, GradeRow, HeatDay, InboxItem } from "../panels/models";

export interface TodayModel {
  due: DueItem[];
  grades: GradeRow[];
  inbox: InboxItem[];
  heat: HeatDay[];
  gpa?: { gpa: number; unweighted: number; credits: number };
  rail: { id: string; code: string; color: string }[];
}

const at = (offset: number, h = 23, m = 59) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/** Local calendar date (YYYY-MM-DD) `offset` days from today. */
const localDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const courses = [
  { id: "chem", code: "CHEM 101", name: "General Chemistry", color: "c4", percent: 88.4, letter: "B+", weightGraded: 45 },
  { id: "calc", code: "MATH 221", name: "Calculus II", color: "c5", percent: 93.1, letter: "A", weightGraded: 40 },
  { id: "hist", code: "HIST 140", name: "Modern Europe", color: "c1", percent: 90.6, letter: "A-", weightGraded: 30 },
  { id: "cs", code: "CS 150", name: "Data Structures", color: "c3", percent: 84.2, letter: "B", weightGraded: 50 },
  { id: "writ", code: "WRIT 102", name: "Academic Writing", color: "c6", percent: 95.0, letter: "A", weightGraded: 35 },
];
const byId = new Map(courses.map((c) => [c.id, c]));

const due: [string, string, string, string, boolean][] = [
  ["cs", "Lab 6: Hash maps", "lab", at(-1), true],
  ["calc", "Problem set 8", "homework", at(0), false],
  ["chem", "Quiz 5 (online)", "quiz", at(1, 10, 0), false],
  ["hist", "Response paper 3", "paper", at(3, 17, 0), false],
  ["chem", "Midterm 2", "exam", at(3, 9, 30), false],
  ["writ", "Draft 2 peer review", "discussion", at(4), false],
  ["cs", "Project 2 checkpoint", "project", at(8), false],
];

const hours = [2, 1.5, 1, 0, 9, 0.5, 0, 3, 6, 1, 0, 2, 4, 0];

export function sampleToday(): TodayModel {
  return {
    due: due.map(([courseId, title, kind, dueAt, late], i) => ({
      id: String(i),
      title,
      kind,
      dueAt,
      late,
      courseCode: byId.get(courseId)?.code,
      color: byId.get(courseId)?.color,
    })),
    grades: courses.map((c) => ({ ...c, hasScheme: true })),
    inbox: [
      { id: "m1", from: "Dr. Lin", subject: "Midterm 2 covers ch. 5–7; review session Thursday 6pm", at: at(0, 9, 12), kind: "announcement", unread: true, color: "c4" },
      { id: "m2", from: "Prof. Okafor", subject: "Re: Lab 6 extension request", at: at(0, 8, 40), kind: "email", unread: true, color: "c3" },
      { id: "m3", from: "Prof. Marsh", subject: "Reading for next week posted", at: at(-1, 16, 5), kind: "announcement", unread: false, color: "c1" },
      { id: "m4", from: "Registrar", subject: "Spring registration opens Monday", at: at(-2, 11, 0), kind: "email", unread: false },
    ],
    heat: hours.map((h, i) => ({ day: localDay(i), hours: h, count: h ? Math.ceil(h / 2) : 0, conflict: i === 4 })),
    gpa: { gpa: 3.58, unweighted: 3.58, credits: 15 },
    rail: courses.map((c) => ({ id: c.id, code: c.code, color: c.color })),
  };
}
