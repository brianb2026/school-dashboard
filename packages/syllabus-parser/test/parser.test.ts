import { describe, expect, it } from "vitest";
import { parseSyllabusText } from "../src/index.js";

const SAMPLE = `
CHEM 101 — General Chemistry I        Spring 2027
Instructor: Dr. Ada Lin   ada.lin@example.edu
Office hours: Tue/Thu 2:00–3:30 pm, Science 214

Grading
  Homework ............ 15%
  Labs                  20%
  Quizzes: 10%
  Midterm Exams (2)     25 %
  Final Exam - 30 percent

  A   93%
  A-  90%
Late work: 10% off per day, up to 3 days.
Late policy: no work accepted after solutions post.

Schedule
Week 1  Jan 21   Intro, read Ch. 1
Week 3  Feb 4    Quiz 1
Week 6  Thu, Feb 25  Midterm Exam 1
3/18  Lab report 4 due
Apr 29, 2027  Final project due
`;

describe("parseSyllabusText", () => {
  const r = parseSyllabusText(SAMPLE, "2027-01-19");

  it("finds the grading weights and nothing else", () => {
    expect(r.weights.weights.map((w) => [w.name, w.weight])).toEqual([
      ["Homework", 15],
      ["Labs", 20],
      ["Quizzes", 10],
      ["Midterm Exams (2)", 25],
      ["Final Exam", 30],
    ]);
    expect(r.weights.total).toBe(100);
    expect(r.weights.confident).toBe(true);
  });

  it("finds dated deliverables", () => {
    const got = r.dates.map((d) => [d.date, d.kind]);
    expect(got).toContainEqual(["2027-02-04", "quiz"]);
    expect(got).toContainEqual(["2027-02-25", "exam"]);
    expect(got).toContainEqual(["2027-03-18", "lab"]);
    expect(got).toContainEqual(["2027-04-29", "project"]);
  });

  it("reads the course code and title from the header", () => {
    expect(r.course).toEqual({ code: "CHEM 101", title: "General Chemistry I" });
  });

  it("finds contact info and the late policy", () => {
    expect(r.policies.instructorEmails).toEqual(["ada.lin@example.edu"]);
    expect(r.policies.officeHours).toBe("Tue/Thu 2:00–3:30 pm, Science 214");
    expect(r.policies.latePolicy).toMatch(/no work accepted/);
    expect(r.needsHelp).toBe(false);
  });
});

import { extractPolicies } from "../src/index.js";

describe("extractPolicies", () => {
  it("keeps the late policy to its own paragraph, even with no blank lines (PDF text)", () => {
    const p = extractPolicies(
      [
        "Office hours: Tue/Thu 2:00-3:30 pm, Science 214",
        "Late policy: work loses 10% per day and is",
        "not accepted after solutions post.",
        "Schedule",
        "Week 3  Feb 4  Quiz 1",
      ].join("\n"),
    );
    expect(p.officeHours).toBe("Tue/Thu 2:00-3:30 pm, Science 214");
    expect(p.latePolicy).toBe("Late policy: work loses 10% per day and is not accepted after solutions post.");
  });
});
