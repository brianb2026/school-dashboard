import { describe, expect, it } from "vitest";
import type { AssignmentView, CourseFile, DashboardData } from "@sd/core";
import { prepPack } from "../src/lib/prep";

const a = (id: string, title: string, kind: AssignmentView["kind"], dueAt: string, extra: Partial<AssignmentView> = {}): AssignmentView =>
  ({ id, courseId: "c", title, kind, dueAt, status: "upcoming", submittable: false, attachments: [], sources: [], done: false, userDone: false, late: false, origin: "Canvas", manual: false, ...extra }) as AssignmentView;
const f = (id: string, name: string, modified: string, folder: string[] = []): CourseFile =>
  ({ id, courseId: "c", name, folder, url: "", isSyllabus: false, modified, source: { source: "canvas", fetchedAt: "" } }) as CourseFile;

describe("Exam prep pack", () => {
  const d = {
    term: { name: "Fall 2026", start: "2026-08-25", end: "2026-12-15" },
    courses: [{ id: "c", code: "CS 2100", color: "c1" }],
    assignments: [
      a("m1", "Midterm 1", "exam", "2026-09-30T18:00:00Z", { score: 80, possible: 100 }),
      a("hw3", "HW3 Heaps", "homework", "2026-10-08T03:59:00Z", { score: 6, possible: 10 }),
      a("hw4", "HW4 Graphs", "homework", "2026-10-20T03:59:00Z", { score: 10, possible: 10 }),
      a("hw1", "HW1 Lists", "homework", "2026-09-10T03:59:00Z", { score: 4, possible: 10 }),
      a("r1", "Read CLRS 22", "reading", "2026-10-15T14:00:00Z"),
      a("m2", "Midterm 2", "exam", "2026-11-04T18:00:00Z"),
      a("other", "HW1", "homework", "2026-10-10T03:59:00Z", { courseId: "x" }),
    ],
    files: [
      f("p2", "Midterm 2 practice.pdf", "2026-10-30T00:00:00Z", ["Exams"]),
      f("p1", "Midterm 1 practice.pdf", "2026-09-20T00:00:00Z", ["Exams"]),
      f("l9", "Lecture 9 graphs.pptx", "2026-10-14T00:00:00Z", ["Lecture Slides"]),
      f("l3", "Lecture 3 lists.pptx", "2026-09-05T00:00:00Z", ["Lecture Slides"]),
      f("sched", "Course schedule.pdf", "2026-10-01T00:00:00Z"),
    ],
  } as unknown as DashboardData;

  it("covers the stretch since the last exam: its practice files first, then lectures, weakest work first, readings", () => {
    const p = prepPack(d, "m2")!;
    expect(p.from).toBe("2026-09-30T18:00:00Z");
    // Practice for this exam ranks above practice for another one; both are kept.
    expect(p.review.map((x) => x.id)).toEqual(["p2", "p1"]);
    expect(p.lectures.map((x) => x.id)).toEqual(["l9"]);
    expect(p.work.map((x) => x.id)).toEqual(["hw3", "hw4"]);
    expect(p.readings.map((x) => x.id)).toEqual(["r1"]);
  });

  it("goes back to the start of term for the first exam", () => {
    const p = prepPack(d, "m1")!;
    expect(p.work.map((x) => x.id)).toEqual(["hw1"]);
    expect(p.lectures.map((x) => x.id)).toEqual(["l3"]);
  });
});
