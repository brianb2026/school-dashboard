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
  it("lets a word the title shares with one category beat the catch-all 'homework' guess", () => {
    const csc = [
      { name: "Workshop attendance/participation", weight: 5 },
      { name: "Class attendance", weight: 5 },
      { name: "Homework assignments", weight: 30 },
      { name: "Midterm", weight: 30 },
      { name: "Final", weight: 30 },
    ];
    const cat = (title: string, kind: Assignment["kind"]) => matchCategory({ title, kind }, csc);
    expect(cat("Week 4 Workshop (Week of 9/21)", "homework")).toBe("Workshop attendance/participation");
    expect(cat("Week 3 Workshop Attendance(Week of 9/14)", "other")).toBe("Workshop attendance/participation");
    expect(cat("HW 3", "homework")).toBe("Homework assignments");
    expect(cat("Lab 2", "lab")).toBe("Homework assignments");
    // An unrecognized title that happens to say "final" is not thereby the final exam.
    expect(cat("Final review worksheet", "homework")).toBe("Homework assignments");
    expect(cat("Midterm Exam", "exam")).toBe("Midterm");
  });
  it("reads initials, ignores stray numbers, and sends attendance to participation", () => {
    const wrt = [
      { name: "Class participation", weight: 15 },
      { name: "Informal Assignments", weight: 20 },
      { name: "Formal Assignment 1", weight: 10 },
      { name: "Formal Assignment 2", weight: 15 },
      { name: "Formal Assignment 3", weight: 15 },
      { name: "Formal Assignment 4", weight: 25 },
    ];
    const cat = (title: string, kind: Assignment["kind"]) => matchCategory({ title, kind }, wrt);
    expect(cat("FA #2 First Draft + Reflection", "paper")).toBe("Formal Assignment 2");
    expect(cat("FA #4 Final Draft + Reflection", "paper")).toBe("Formal Assignment 4");
    // Nothing says which formal assignment: the general bucket, not "…1" because the title has a 1 in it.
    expect(cat("Journal #1", "homework")).toBe("Informal Assignments");
    expect(cat("Film Review", "homework")).toBe("Informal Assignments");
    expect(cat("Attendance", "other")).toBe("Class participation");
    // Readings count for nothing here, whatever page numbers they carry.
    expect(cat("Booth, “Making Good Arguments” (pg. 1-15)", "reading")).toBeUndefined();
    expect(cat("Review class syllabus", "reading")).toBeUndefined();
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
    expect(out.map((a) => a.id)).toEqual(["s2", "b1"]);
  });
});

import { gradeTrend, htmlToText, matchCategory, mergeAssignments, resolveCourseGrade } from "../src/index.js";

describe("mergeAssignments", () => {
  const mk = (id: string, source: Assignment["sources"][number]["source"], title: string, dueAt?: string, extra: Partial<Assignment> = {}): Assignment => ({
    id, courseId: "c", title, kind: "homework", dueAt, status: "upcoming", submittable: false, attachments: [],
    sources: [{ source, fetchedAt: "x" }], ...extra,
  });
  it("merges the same item across sources, best source wins, grade can follow", () => {
    const r = mergeAssignments(
      [
        mk("gs1", "gradescope", "Homework 3", "2027-02-10T04:59:00Z", { status: "submitted" }),
        mk("bb1", "blackboard-session", "Homework 3", undefined, { pointsPossible: 20 }),
        mk("ic1", "blackboard-ical", "Homework 3 - CSC 172", "2027-02-10T04:59:00Z"),
        mk("bb2", "blackboard-session", "Homework 4", "2027-02-17T04:59:00Z"),
        mk("me1", "manual", "Homework 3", "2027-02-10T04:59:00Z"),
      ],
      "America/New_York",
    );
    expect(r.assignments.map((a) => a.id).sort()).toEqual(["bb1", "bb2", "me1"]);
    expect(r.primaryOf.get("gs1")).toBe("bb1");
    expect(r.primaryOf.get("ic1")).toBe("bb1");
    const hw3 = r.assignments.find((a) => a.id === "bb1")!;
    expect(hw3.dueAt).toBe("2027-02-10T04:59:00Z");
    expect(hw3.status).toBe("submitted");
    expect(hw3.sources).toHaveLength(3);
  });
  it("merges on the exact Gradescope number even when the names differ, and keeps both scores findable", () => {
    const r = mergeAssignments(
      [
        mk("bb9", "blackboard-session", "Midterm 1 (Gradescope)", "2027-02-10T04:59:00Z", { externalRefs: ["gradescope:5001"] }),
        mk("gs9", "gradescope", "Exam One", "2027-02-11T15:00:00Z", { externalRefs: ["gradescope:5001"] }),
        mk("gs8", "gradescope", "Exam Two", "2027-03-11T15:00:00Z", { externalRefs: ["gradescope:5002"] }),
      ],
      "America/New_York",
    );
    expect(r.assignments.map((a) => a.id).sort()).toEqual(["bb9", "gs8"]);
    expect(r.primaryOf.get("gs9")).toBe("bb9");
    expect(r.assignments.find((a) => a.id === "bb9")!.externalRefs).toEqual(["gradescope:5001"]);
  });
  it("merges the same reading listed by two syllabus pages on one day", () => {
    const r = mergeAssignments(
      [
        mk("syl:a:1", "syllabus", "Read Chapter 5.1", "2027-03-08T04:59:00Z", { kind: "reading", sources: [{ source: "syllabus", externalId: "a", fetchedAt: "x" }] }),
        mk("syl:b:1", "syllabus", "Read Chapter 5.1", "2027-03-08T04:59:00Z", { kind: "reading", sources: [{ source: "syllabus", externalId: "b", fetchedAt: "x" }] }),
        // Same page, a week later: a different reading, however alike the words.
        mk("syl:b:2", "syllabus", "Read Chapter 5.1", "2027-03-15T04:59:00Z", { kind: "reading", sources: [{ source: "syllabus", externalId: "b", fetchedAt: "x" }] }),
      ],
      "America/New_York",
    );
    expect(r.assignments).toHaveLength(2);
  });
  it("needs a real word in common: 'Webwork 1' is not 'HW1', even due the same night", () => {
    const r = mergeAssignments(
      [
        mk("bbw", "blackboard-session", "Webwork 1 due 9/11 11:59 pm", "2026-09-12T03:59:00Z"),
        mk("bbh", "blackboard-session", "HW1", "2026-09-12T03:59:00Z"),
        mk("gsh", "gradescope", "Homework 1", "2026-09-12T03:59:00Z", { externalRefs: ["gradescope:77"] }),
        // Blackboard says exactly which Gradescope item HW2 is; a look-alike with another number stays separate.
        mk("bb2", "blackboard-session", "HW2", "2026-09-26T03:59:00Z", { externalRefs: ["gradescope:80"] }),
        mk("gs2", "gradescope", "HW2", "2026-09-26T03:59:00Z", { externalRefs: ["gradescope:80"] }),
        mk("gs2b", "gradescope", "HW2 (regrade)", "2026-09-26T03:59:00Z", { externalRefs: ["gradescope:81"] }),
      ],
      "America/New_York",
    );
    expect(r.primaryOf.get("gsh")).toBe("bbh");
    expect(r.primaryOf.get("gs2")).toBe("bb2");
    expect(r.assignments.map((a) => a.id).sort()).toEqual(["bb2", "bbh", "bbw", "gs2b"]);
  });
  it("never merges two rows from one source, or different numbers", () => {
    const r = mergeAssignments(
      [mk("a", "blackboard-session", "Quiz 1", "2027-02-10T04:59:00Z"), mk("b", "blackboard-session", "Quiz 1 retake", "2027-02-10T04:59:00Z"), mk("c", "gradescope", "Quiz 10")],
      "America/New_York",
    );
    expect(r.assignments).toHaveLength(3);
  });
});

describe("resolveCourseGrade", () => {
  const a = (id: string, title: string, kind: Assignment["kind"], pts: number, extra: Partial<Assignment> = {}): Assignment => ({
    id, courseId: "c", title, kind, pointsPossible: pts, status: "graded", submittable: false, attachments: [], sources: [src], ...extra,
  });
  const g = (assignmentId: string, score: number, pointsPossible: number, gradedAt?: string): GradeEntry => ({ assignmentId, courseId: "c", score, pointsPossible, gradedAt, source: src });
  const assignments = [a("h1", "Homework 1", "homework", 10), a("e1", "Midterm 1", "exam", 100), a("x", "Survey", "other", 5, { countsTowardGrade: false }), a("p", "Participation", "discussion", 10)];
  const grades = [g("h1", 10, 10, "2027-02-01T00:00:00Z"), g("e1", 70, 100, "2027-03-01T00:00:00Z"), g("x", 0, 5), g("p", 9, 10, "2027-03-05T00:00:00Z")];
  const scheme = { categories: [{ name: "Homework", weight: 40 }, { name: "Exams", weight: 60 }] };
  const cutoffs = [{ letter: "A", min: 90 }, { letter: "B", min: 80 }, { letter: "C", min: 70 }, { letter: "F", min: 0 }];
  const categoryOf = (x: Assignment) => matchCategory(x, scheme.categories);

  it("uses syllabus weights, counts what fits no category, skips excluded columns", () => {
    const r = resolveCourseGrade({ scheme, assignments, grades, cutoffs, categoryOf });
    expect(r.basis).toBe("syllabus");
    expect(r.percent).toBeCloseTo(100 * 0.4 + 70 * 0.6);
    expect(r.letter).toBe("B");
    expect(r.uncategorized).toBe(1); // Participation
    expect(r.options.map((o) => o.basis)).toEqual(["syllabus", "points"]);
    expect(r.options[1]!.percent).toBeCloseTo((89 / 120) * 100);
  });
  it("prefers Blackboard's weighted total, but only a plain Total after the syllabus", () => {
    const overall = [{ courseId: "c", kind: "total" as const, label: "Total", percent: 74, source: src }];
    expect(resolveCourseGrade({ scheme, assignments, grades, cutoffs, categoryOf, overall }).basis).toBe("syllabus");
    const weighted = [...overall, { courseId: "c", kind: "weighted-total" as const, label: "Weighted Total", percent: 81.5, letter: "B-", source: src }];
    const r = resolveCourseGrade({ scheme, assignments, grades, cutoffs, categoryOf, overall: weighted });
    expect(r).toMatchObject({ basis: "blackboard", percent: 81.5, letter: "B-" });
    expect(resolveCourseGrade({ scheme, assignments, grades, cutoffs, categoryOf, overall: weighted, prefer: "points" }).basis).toBe("points");
  });
  it("has no grade without graded work, and a trend once there is", () => {
    expect(resolveCourseGrade({ assignments, grades: [], cutoffs, categoryOf }).basis).toBe("none");
    const t = gradeTrend({ scheme, assignments, grades, cutoffs, categoryOf });
    expect(t.map((p) => Math.round(p.percent))).toEqual([100, 82, 82]);
  });
});

describe("htmlToText", () => {
  it("drops script, keeps text and links, decodes entities", () => {
    const t = htmlToText('<p>Exam&nbsp;2 is <b>Friday</b> &amp; covers ch.&#160;5&ndash;7.</p><script>alert(1)</script><ul><li>Bring ID</li><li><a href="https://x.edu/r?a=1&amp;b=2">Review sheet</a></li></ul><a href="javascript:alert(1)">bad</a>');
    expect(t).toBe("Exam 2 is Friday & covers ch. 5–7.\n\n• Bring ID\n• Review sheet (https://x.edu/r?a=1&b=2)\nbad");
    expect(t).not.toMatch(/script|javascript/);
  });
});

import { matchMaterials, type CourseFile } from "../src/index.js";

describe("matchMaterials", () => {
  const file = (id: string, name: string, extra: Partial<CourseFile> = {}): CourseFile => ({ id, courseId: "c", name, folder: [], url: "/x", isSyllabus: false, source: { source: "blackboard-session", fetchedAt: "x" }, ...extra });
  const files = [
    file("f1", "Lab 3 handout.pdf"),
    file("f2", "Lab 13 handout.pdf"),
    file("f3", "bunn--how-to-read-like-a-writer.pdf"),
    file("f4", "Syllabus.pdf", { isSyllabus: true }),
    file("f5", "Lab 3 handout.pdf", { courseId: "other" }),
    file("f6", "week1.pptx"),
    file("f7", "starter code.zip", { contentId: "_c9" }),
  ];
  const ids = (title: string, kind: "lab" | "reading" | "homework" = "lab", contentId?: string) => matchMaterials({ title, courseId: "c", kind, contentId }, files).map((f) => f.id);
  it("finds the handout named like the assignment, never a different number or another class", () => {
    expect(ids("Lab 3")).toEqual(["f1"]);
    expect(ids("Lab 13")).toEqual(["f2"]);
    expect(ids("Lab 4")).toEqual([]);
  });
  it("offers a file posted in two folders once", () => {
    const fs = [file("a", "Booth_Making Good Arguments.pdf"), file("b", "Booth_Making Good Arguments.pdf", { folder: ["Week 3"] }), file("c", "Booth slides.pptx")];
    expect(matchMaterials({ title: "Booth, “Making Good Arguments” (pg. 1-15)", courseId: "c", kind: "reading" }, fs).map((f) => f.id)).toEqual(["a", "c"]);
  });
  it("is not fooled by a date in the title", () => {
    const fs = [file("w5", "Workshop 5.pdf"), file("w6", "Workshop 6.pdf"), file("w10", "Workshop 10.pdf")];
    const pick = (title: string) => matchMaterials({ title, courseId: "c", kind: "other" }, fs).map((f) => f.id);
    expect(pick("Week 6 Workshop (Week of 10/5)")).toEqual(["w6"]);
    expect(pick("Week 10 Workshop Attendance (Week of 11/2)")).toEqual(["w10"]);
    expect(pick("Week 11 Workshop Attendance (Week of 4/13)")).toEqual([]);
  });
  it("finds a reading by its author, and the file that sits on the same Blackboard item", () => {
    expect(ids("Bunn, “How to Read Like a Writer” (pg. 71-85)", "reading")).toEqual(["f3"]);
    expect(ids("Project 2", "homework", "_c9")).toEqual(["f7"]);
    expect(ids("Read Chapter 5.1", "reading")).toEqual([]);
  });
});

import { completeScale, isPartialScale } from "../src/letters.js";

describe("letter scales that only guarantee minimums", () => {
  const usual = [
    { letter: "A", min: 93 }, { letter: "A-", min: 90 }, { letter: "B+", min: 87 }, { letter: "B", min: 83 }, { letter: "B-", min: 80 },
    { letter: "C+", min: 77 }, { letter: "C", min: 73 }, { letter: "C-", min: 70 }, { letter: "D+", min: 67 }, { letter: "D", min: 60 }, { letter: "F", min: 0 },
  ];
  it("fills the missing letters around the guaranteed ones, keeping the syllabus's own numbers", () => {
    const math = [{ letter: "A-", min: 90 }, { letter: "B-", min: 80 }, { letter: "C-", min: 70 }, { letter: "D-", min: 60 }, { letter: "F", min: 0 }];
    expect(isPartialScale(math)).toBe(true);
    const r = completeScale(math, usual);
    expect(r.cutoffs.map((c) => `${c.letter} ${c.min}`)).toEqual(["A 93", "A- 90", "B+ 87", "B 83", "B- 80", "C+ 77", "C 73", "C- 70", "D+ 67", "D- 60", "F 0"]);
    // The usual D (60) would tie the syllabus's D− (60), so it's left out.
    expect(r.filled).toEqual(["A", "B+", "B", "C+", "C", "D+"]);
  });
  it("leaves a complete scale exactly as written", () => {
    const csc = [{ letter: "A", min: 93 }, { letter: "A-", min: 90 }, { letter: "B+", min: 87 }, { letter: "B", min: 83 }, { letter: "C", min: 73 }, { letter: "D", min: 60 }, { letter: "F", min: 0 }];
    expect(isPartialScale(csc)).toBe(false);
    expect(completeScale(csc, usual)).toEqual({ cutoffs: csc, filled: [] });
  });
});
