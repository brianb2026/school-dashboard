import { describe, expect, it } from "vitest";
import type { AssignmentView, CourseView, DashboardData, GradeEntry } from "@sd/core";
import { project, readScore } from "../src/lib/whatif";

describe("readScore: scores typed the way people type them", () => {
  it("reads points, fractions, percents and comma decimals", () => {
    expect(readScore("42", 50)).toEqual({ score: 42, possible: 50 });
    expect(readScore("42/50")).toEqual({ score: 42, possible: 50 });
    expect(readScore(" 42 of 50 ")).toEqual({ score: 42, possible: 50 });
    expect(readScore("42 out of 50")).toEqual({ score: 42, possible: 50 });
    expect(readScore("84%", 50)).toEqual({ score: 42, possible: 50 });
    expect(readScore("8,5", 10)).toEqual({ score: 8.5, possible: 10 });
    // No point total known: a bare number is a percent.
    expect(readScore("90")).toEqual({ score: 90, possible: 100 });
  });
  it("refuses what isn't a score", () => {
    expect(readScore("")).toBeUndefined();
    expect(readScore("abc")).toBeUndefined();
    expect(readScore("4/0")).toBeUndefined();
    expect(readScore("-5")).toBeUndefined();
  });
});

describe("project: what the class grade would be", () => {
  const src = { source: "manual" as const, fetchedAt: "" };
  const item = (id: string, category: string, possible = 100): AssignmentView =>
    ({ id, courseId: "c", title: id, kind: "homework", status: "upcoming", submittable: false, attachments: [], sources: [], done: false, userDone: false, late: false, origin: "Blackboard", manual: false, pointsPossible: possible, categoryResolved: category }) as AssignmentView;
  const grade = (id: string, score: number, possible = 100): GradeEntry => ({ assignmentId: id, courseId: "c", score, pointsPossible: possible, source: src });
  const cutoffs = [{ letter: "A", min: 90 }, { letter: "B", min: 80 }, { letter: "C", min: 70 }, { letter: "F", min: 0 }];
  const course = {
    id: "c", code: "X 1", name: "X", credits: 4, level: "regular", cutoffs, scheme: [{ name: "HW", weight: 50 }, { name: "Exams", weight: 50 }],
    grade: { basis: "syllabus", label: "", percent: 90, letter: "A", weightGraded: 50, categories: [], options: [], uncategorized: 0 },
  } as unknown as CourseView;
  const d = {
    courses: [course],
    assignments: [item("hw1", "HW"), item("hw2", "HW"), item("mid", "Exams")],
    grades: [grade("hw1", 90)],
    gpaScale: { weightByCredits: true, points: { A: 4, B: 3, C: 2, F: 0 }, levelBonus: {} },
    gpa: { gpa: 4, unweighted: 4, credits: 4, scale: "x" },
  } as unknown as DashboardData;

  it("adds tried scores for ungraded work and replaces graded ones; nothing else changes", () => {
    const none = project(d, course, {});
    expect(none.now.percent).toBeCloseTo(90);
    expect(none.next.percent).toBeCloseTo(90);

    const midterm = project(d, course, { mid: { score: 70, possible: 100 } });
    expect(midterm.next.percent).toBeCloseTo(80); // 50% × 90 + 50% × 70
    expect(midterm.next.letter).toBe("B");
    expect(midterm.gpaNext).toBeCloseTo(3);

    const redo = project(d, course, { hw1: { score: 50, possible: 100 } });
    expect(redo.next.percent).toBeCloseTo(50);
    expect(d.grades).toHaveLength(1); // the real grades are untouched
  });
});
