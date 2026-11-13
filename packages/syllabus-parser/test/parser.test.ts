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

import { extractCredits, extractLetterScale, extractMeetings, parseDays } from "../src/index.js";

describe("extractLetterScale", () => {
  it("reads range lists, reversed ranges and one-per-line tables", () => {
    expect(extractLetterScale("Grades: A 93-100, A- 90-92.9, B+ 87-89.9, B 83-86.9, B- 80-82.9, C 70-79.9, D 60-69.9, F below 60")).toEqual([
      { letter: "A", min: 93 }, { letter: "A-", min: 90 }, { letter: "B+", min: 87 }, { letter: "B", min: 83 },
      { letter: "B-", min: 80 }, { letter: "C", min: 70 }, { letter: "D", min: 60 }, { letter: "F", min: 0 },
    ]);
    expect(extractLetterScale("90-100% = A\n80-89% = B\n70-79% = C\n60-69% = D\n0-59% = F")?.map((c) => c.min)).toEqual([90, 80, 70, 60, 0]);
    expect(extractLetterScale("A  93%\nA-  90%\nB+ 87%\nB 83%")?.[3]).toEqual({ letter: "B", min: 83 });
  });
  it("ignores prose and scales that don't descend", () => {
    expect(extractLetterScale("A 90-minute exam and a 2-3 page paper. Section B 10-11 am.")).toBeUndefined();
    expect(extractLetterScale("A 80-100\nB 85-90\nC 70-80\nD 60-70")).toBeUndefined();
  });
});

describe("credits and meetings", () => {
  it("finds credit hours", () => {
    expect(extractCredits("This is a 4 credit hour course.")).toBe(4);
    expect(extractCredits("Credits: 3")).toBe(3);
    expect(extractCredits("worth 150 credits of fun")).toBeUndefined();
  });
  it("reads day codes", () => {
    expect(parseDays("MWF")).toEqual([1, 3, 5]);
    expect(parseDays("TR")).toEqual([2, 4]);
    expect(parseDays("TTh")).toEqual([2, 4]);
    expect(parseDays("Tu/Th")).toEqual([2, 4]);
    expect(parseDays("Mondays and Wednesdays")).toEqual([1, 3]);
  });
  it("reads class times and skips office hours", () => {
    const m = extractMeetings(
      ["Lecture: MWF 10:25–11:15 am, Hutchison 141", "Office hours: Tue 2-3 pm", "Class meets Tu/Th 2:00-3:15", "Lab section: W 11-12:15pm in Hylan 105"].join("\n"),
    );
    expect(m.filter((x) => x.start === "10:25").map((x) => x.weekday)).toEqual([1, 3, 5]);
    expect(m.find((x) => x.start === "10:25")).toMatchObject({ end: "11:15", location: "Hutchison 141" });
    expect(m.filter((x) => x.start === "14:00")).toHaveLength(2);
    expect(m.find((x) => x.weekday === 3 && x.start === "11:00")).toMatchObject({ end: "12:15", location: "Hylan 105" });
    expect(m).toHaveLength(6);
  });
});
