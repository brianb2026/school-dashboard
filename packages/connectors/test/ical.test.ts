import { describe, expect, it } from "vitest";
import type { Course } from "@sd/core";
import { eventsToAssignments, parseIcs, teacherQuery } from "../src/index.js";

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:item-1",
  "SUMMARY:Lab 3 Report - CHEM-101",
  "DTSTART:20270204T045900Z",
  "DESCRIPTION:Upload your report\\, PDF only",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:item-2",
  "SUMMARY:Midterm Exam",
  "DTSTART;VALUE=DATE:20270225",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:item-3",
  "SUMMARY:A very long title that the server folded onto",
  "  a second line",
  "DTSTART:20270301T120000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const chem: Course = {
  id: "chem",
  code: "CHEM-101",
  name: "General Chemistry",
  term: "Spring 2027",
  credits: 4,
  level: "regular",
  color: "c1",
  instructors: [{ name: "Dr. Lin", email: "ada.lin@example.edu", role: "instructor" }],
  meetings: [],
  sources: [],
};

describe("Blackboard calendar feed", () => {
  const events = parseIcs(ICS);

  it("reads events, unfolds lines and unescapes text", () => {
    expect(events).toHaveLength(3);
    expect(events[0]!.description).toBe("Upload your report, PDF only");
    expect(events[2]!.summary).toBe("A very long title that the server folded onto a second line");
    expect(events[0]!.start).toBe("2027-02-04T04:59:00Z");
  });

  it("turns events into assignments and matches courses", () => {
    const out = eventsToAssignments(events, { knownCourses: [chem], now: new Date("2027-01-20T00:00:00Z") });
    expect(out[0]).toMatchObject({ courseId: "chem", kind: "lab" });
    expect(out[1]).toMatchObject({ courseId: "unassigned", kind: "exam" });
  });
});

describe("teacherQuery", () => {
  it("builds a Gmail search for teacher mail", () => {
    expect(teacherQuery([chem], 14)).toBe('(from:ada.lin@example.edu OR "CHEM-101") newer_than:14d');
  });
});
