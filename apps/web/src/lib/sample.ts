/**
 * Made-up sample data so the UI has something to show before you connect
 * anything. Shown with a "Sample data" banner; replaced by /api/dashboard.
 */
export interface SampleCourse { id: string; code: string; name: string; color: string; percent: number; letter: string; weightGraded: number; attendance: number }
export interface SampleDue { id: string; courseId: string; title: string; kind: string; dueAt: string; status: "upcoming" | "late" | "submitted" }
export interface SampleMsg { id: string; courseId?: string; from: string; subject: string; at: string; kind: "email" | "announcement"; unread: boolean }

const day = (offset: number, h = 23, m = 59) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const courses: SampleCourse[] = [
  { id: "chem", code: "CHEM 101", name: "General Chemistry", color: "var(--c4)", percent: 88.4, letter: "B+", weightGraded: 45, attendance: 96 },
  { id: "calc", code: "MATH 221", name: "Calculus II", color: "var(--c5)", percent: 93.1, letter: "A", weightGraded: 40, attendance: 100 },
  { id: "hist", code: "HIST 140", name: "Modern Europe", color: "var(--c1)", percent: 90.6, letter: "A-", weightGraded: 30, attendance: 92 },
  { id: "cs", code: "CS 150", name: "Data Structures", color: "var(--c3)", percent: 84.2, letter: "B", weightGraded: 50, attendance: 89 },
  { id: "writ", code: "WRIT 102", name: "Academic Writing", color: "var(--c6)", percent: 95.0, letter: "A", weightGraded: 35, attendance: 100 },
];

export const due: SampleDue[] = [
  { id: "1", courseId: "cs", title: "Lab 6: Hash maps", kind: "lab", dueAt: day(-1, 23, 59), status: "late" },
  { id: "2", courseId: "calc", title: "Problem set 8", kind: "homework", dueAt: day(0, 23, 59), status: "upcoming" },
  { id: "3", courseId: "chem", title: "Quiz 5 (online)", kind: "quiz", dueAt: day(1, 10, 0), status: "upcoming" },
  { id: "4", courseId: "hist", title: "Response paper 3", kind: "paper", dueAt: day(3, 17, 0), status: "upcoming" },
  { id: "5", courseId: "chem", title: "Midterm 2", kind: "exam", dueAt: day(3, 9, 30), status: "upcoming" },
  { id: "6", courseId: "writ", title: "Draft 2 peer review", kind: "discussion", dueAt: day(4, 23, 59), status: "upcoming" },
  { id: "7", courseId: "cs", title: "Project 2 checkpoint", kind: "project", dueAt: day(8, 23, 59), status: "upcoming" },
];

export const inbox: SampleMsg[] = [
  { id: "m1", courseId: "chem", from: "Dr. Lin", subject: "Midterm 2 covers ch. 5–7; review session Thursday 6pm", at: day(0, 9, 12), kind: "announcement", unread: true },
  { id: "m2", courseId: "cs", from: "Prof. Okafor", subject: "Re: Lab 6 extension request", at: day(0, 8, 40), kind: "email", unread: true },
  { id: "m3", courseId: "hist", from: "Prof. Marsh", subject: "Reading for next week posted", at: day(-1, 16, 5), kind: "announcement", unread: false },
  { id: "m4", from: "Registrar", subject: "Spring registration opens Monday", at: day(-2, 11, 0), kind: "email", unread: false },
];

/** Hours due per day for the next 14 days. */
export const heat: number[] = [2, 1.5, 1, 0, 9, 0.5, 0, 3, 6, 1, 0, 2, 4, 0];
export const conflictDays = new Set([4]);
