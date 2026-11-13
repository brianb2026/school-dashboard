import { describe, expect, it } from "vitest";
import {
  assignmentsToIcs,
  courseGrade,
  findConflicts,
  gpa,
  letterFor,
  requiredOnRemaining,
  type Assignment,
  type GradeEntry,
  type GradingScheme,
} from "../src/index.js";

const src = { source: "manual" as const, fetchedAt: "2027-01-01T00:00:00Z" };

describe("courseGrade", () => {
  const scheme: GradingScheme = {
    courseId: "c1",
    source: src,
    categories: [
      { name: "Homework", weight: 20, dropLowest: 1 },
      { name: "Exams", weight: 50 },
      { name: "Final", weight: 30 },
    ],
  };
  const cat: Record<string, string> = { h1: "Homework", h2: "Homework", h3: "Homework", e1: "Exams" };
  const g = (assignmentId: string, score: number, pointsPossible = 100): GradeEntry => ({
    assignmentId,
    courseId: "c1",
    score,
    pointsPossible,
    source: src,
  });

  it("re-normalizes over graded categories and drops the lowest", () => {
    const r = courseGrade(scheme, [g("h1", 100), g("h2", 50), g("h3", 90), g("e1", 80)], (id) => cat[id]);
    // Homework drops the 50 → 95%. (95*20 + 80*50) / 70
    expect(r.categories[0]!.percent).toBeCloseTo(95);
    expect(r.weightGraded).toBe(70);
    expect(r.percent).toBeCloseTo((95 * 20 + 80 * 50) / 70);
  });

  it("what-if: score needed on the final", () => {
    // 84.29% over 70% of the course; want 90 overall.
    const need = requiredOnRemaining((95 * 20 + 80 * 50) / 70, 70, 90);
    expect(need).toBeCloseTo((9000 - (95 * 20 + 80 * 50)) / 30);
  });
});

describe("letterFor", () => {
  const cutoffs = [
    { letter: "A", min: 93 },
    { letter: "A-", min: 90 },
    { letter: "B", min: 80 },
    { letter: "F", min: 0 },
  ];
  it("picks the highest cutoff met", () => {
    expect(letterFor(93, cutoffs)).toBe("A");
    expect(letterFor(91.2, cutoffs)).toBe("A-");
    expect(letterFor(12, cutoffs)).toBe("F");
  });
});

describe("gpa", () => {
  const points = { A: 4, B: 3, F: 0 };
  it("credit-weights and applies level bonus only when configured", () => {
    const courses = [
      { letter: "A", credits: 4, level: "ap" as const },
      { letter: "B", credits: 3, level: "regular" as const },
    ];
    const unweightedScale = gpa(courses, { weightByCredits: true, points, levelBonus: {} })!;
    expect(unweightedScale.gpa).toBeCloseTo((16 + 9) / 7);
    const weighted = gpa(courses, { weightByCredits: true, points, levelBonus: { ap: 1 } })!;
    expect(weighted.gpa).toBeCloseTo((20 + 9) / 7);
    expect(weighted.unweighted).toBeCloseTo((16 + 9) / 7);
  });
});

describe("findConflicts", () => {
  const a = (id: string, kind: Assignment["kind"], dueAt: string): Assignment => ({
    id,
    courseId: "c1",
    title: id,
    kind,
    dueAt,
    status: "upcoming",
    submittable: false,
    attachments: [],
    sources: [src],
  });
  it("flags two heavy items on one local day", () => {
    const out = findConflicts(
      [a("x", "exam", "2027-03-02T14:00:00Z"), a("y", "paper", "2027-03-03T03:59:00Z")], // both Mar 2 in New York
      "America/New_York",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe("multiple-heavy");
    expect(out[0]!.day).toBe("2027-03-02");
  });
});

describe("assignmentsToIcs", () => {
  it("escapes text and emits one event per dated assignment", () => {
    const ics = assignmentsToIcs(
      [
        {
          id: "a1",
          courseId: "c1",
          title: "Lab 3, part 1; draft",
          kind: "lab",
          dueAt: "2027-02-01T04:59:00Z",
          status: "upcoming",
          submittable: false,
          attachments: [],
          sources: [src],
        },
      ],
      [],
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(ics).toContain("SUMMARY:Lab 3\\, part 1\\; draft");
    expect(ics).toContain("DTSTART:20270201T045900Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});

import { courseKey, matchCourse, zonedToIso, type Course } from "../src/index.js";

describe("matchCourse", () => {
  const mk = (id: string, code: string, name: string): Course => ({
    id, code, name, term: "S27", credits: 3, level: "regular", color: "c1", instructors: [], meetings: [], sources: [],
  });
  const courses = [mk("chem", "CHEM 101", "General Chemistry"), mk("calc", "MATH-221", "Calculus II"), mk("calc3", "MATH 231", "Calculus III")];

  it("canonicalizes codes", () => {
    expect(courseKey("chem-101-002")).toBe("CHEM101");
    expect(courseKey("MATH 221H")).toBe("MATH221H");
  });

  it("matches by code in any spelling, then by unique name", () => {
    expect(matchCourse("Lab 3 Report: CHEM-101-002", courses)).toBe("chem");
    expect(matchCourse("PS 8 (math221)", courses)).toBe("calc");
    expect(matchCourse("General Chemistry review", courses)).toBe("chem");
  });

  it("refuses to guess on ambiguous names and honors aliases first", () => {
    expect(matchCourse("Calculus quiz", courses)).toBeUndefined();
    expect(matchCourse("Lab 3", courses)).toBeUndefined();
    expect(matchCourse("Lab 3", courses, [{ pattern: "lab", courseId: "chem" }])).toBe("chem");
    expect(matchCourse("Lab 3", courses, [{ pattern: "lab", courseId: "gone" }])).toBeUndefined();
  });
});

describe("zonedToIso", () => {
  it("converts wall-clock school time to UTC, including across DST", () => {
    expect(zonedToIso("2027-03-02", "23:59", "America/New_York")).toBe("2027-03-03T04:59:00.000Z");
    expect(zonedToIso("2027-03-18", "23:59", "America/New_York")).toBe("2027-03-19T03:59:00.000Z");
    expect(zonedToIso("2027-03-14", "03:30", "America/New_York")).toBe("2027-03-14T07:30:00.000Z");
  });
});

import { categoryFor, dedupeAssignments } from "../src/index.js";

describe("categoryFor", () => {
  const cats = [
    { name: "Homework", weight: 15 },
    { name: "Labs", weight: 20 },
    { name: "Midterm Exams", weight: 25 },
    { name: "Final Exam", weight: 30 },
    { name: "Projects", weight: 10 },
  ];
  it("maps item kinds to the syllabus categories", () => {
    expect(categoryFor("lab", "Lab report 4", cats)).toBe("Labs");
    expect(categoryFor("exam", "Midterm Exam 1", cats)).toBe("Midterm Exams");
    expect(categoryFor("exam", "Final Exam", cats)).toBe("Final Exam");
    expect(categoryFor("project", "Final project", cats)).toBe("Projects");
    expect(categoryFor("discussion", "Post 3", cats)).toBeUndefined();
  });
});

describe("dedupeAssignments", () => {
  const base = { courseId: "chem", status: "upcoming" as const, submittable: false, attachments: [] };
  const syl = (id: string, title: string, kind: Assignment["kind"], dueAt: string): Assignment => ({
    ...base, id, title, kind, dueAt, sources: [{ source: "syllabus", fetchedAt: "x" }],
  });
  const bb = (id: string, title: string, kind: Assignment["kind"], dueAt: string): Assignment => ({
    ...base, id, title, kind, dueAt, sources: [{ source: "blackboard-ical", fetchedAt: "x" }],
  });
  it("drops the syllabus copy when Blackboard has the same item that day", () => {
    const out = dedupeAssignments(
      [
        syl("s1", "Midterm Exam 1", "exam", "2027-02-26T04:59:00Z"),
        bb("b1", "Midterm 1 (in class)", "exam", "2027-02-25T14:00:00Z"),
        syl("s2", "Quiz 1", "quiz", "2027-02-05T04:59:00Z"),
      ],
      "America/New_York",
    );
    expect(out.map((a) => a.id)).toEqual(["b1", "s2"]);
  });
});
