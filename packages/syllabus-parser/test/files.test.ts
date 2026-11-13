import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linesFromPlacedText, parseSyllabus } from "../src/index.js";

// Made-up syllabus, exported to PDF (macOS cupsfilter) and DOCX (textutil).
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("real files", () => {
  for (const name of ["chem101.pdf", "chem101.docx"]) {
    it(`reads ${name} the same way`, async () => {
      const r = await parseSyllabus(fixture(name), name, "2027-01-19");
      expect(r.course).toEqual({ code: "CHEM 101", title: "General Chemistry I" });
      expect(r.weights.total).toBe(100);
      expect(r.weights.weights).toHaveLength(5);
      expect(r.dates.map((d) => [d.date, d.kind, d.title])).toEqual([
        ["2027-02-04", "quiz", "Quiz 1"],
        ["2027-02-25", "exam", "Midterm Exam 1"],
        ["2027-03-18", "lab", "Lab report 4 due"],
        ["2027-04-29", "project", "Final project due"],
      ]);
      expect(r.policies.instructorEmails).toEqual(["ada.lin@example.edu"]);
    });
  }
});

describe("linesFromPlacedText", () => {
  it("rebuilds lines from positions and keeps wide gaps apart", () => {
    const h = 10;
    const lines = linesFromPlacedText([
      { str: "20%", x: 200, y: 700, width: 15, height: h },
      { str: "Labs", x: 50, y: 700.5, width: 20, height: h },
      { str: "Homework", x: 50, y: 712, width: 45, height: h },
      { str: "15%", x: 200, y: 712, width: 15, height: h },
      { str: "Gen", x: 50, y: 688, width: 15, height: h },
      { str: "eral", x: 65, y: 688, width: 18, height: h },
    ]);
    expect(lines).toEqual(["Homework  15%", "Labs  20%", "General"]);
  });
});
