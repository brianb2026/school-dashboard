import { describe, expect, it } from "vitest";
import { sisMeetings, sisView } from "@sd/core";
import {
  AuthExpiredError,
  CANVAS_COOKIES,
  CANVAS_TOKEN,
  canvas,
  canvasUser,
  CookieJar,
  parseCourseHistory,
  parseStudentCenter,
  peopleSoftPath,
  sis,
  SIS_COOKIES,
  sisGet,
  sisWorks,
  type ConnectorContext,
  type SecretStore,
} from "../src/index.js";
import { fakeCanvas } from "./fake-canvas.js";
import { fakeSis } from "./fake-sis.js";

const NOW = new Date("2026-11-15T15:00:00Z");

function memory(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}
function context(env: Record<string, string>, fetch: ConnectorContext["fetch"], secrets = memory()): ConnectorContext & { secrets: ReturnType<typeof memory> } {
  return { env, secrets, knownCourses: [], now: NOW, fetch, timezone: "America/New_York", termName: "Fall 2026", deep: true };
}

describe("Canvas", () => {
  it("reads the current class through your own sign-in: assignments, scores, group weights, Canvas's total, modules, files, announcements", async () => {
    const cv = fakeCanvas({ now: NOW });
    const ctx = context({ CANVAS_BASE_URL: cv.base, CANVAS_REQUEST_GAP_MS: "0" }, cv.fetch);
    ctx.secrets.data.set(CANVAS_COOKIES, new CookieJar([cv.sessionCookie]).serialize());
    expect((await canvas.status(ctx)).state).toBe("ready");

    const r = await canvas.sync(ctx);
    // Last year's class is left out; both pages of the course list were read.
    expect(r.courses!.map((c) => [c.id, c.code, c.name])).toEqual([["canvas:4101", "CS 2100", "Data Structures and Algorithms 1"]]);
    expect(cv.state.log.some((l) => l.includes("page=2"))).toBe(true);
    expect(r.courses![0]!.instructors).toEqual([{ name: "Ray Pettit", role: "instructor" }]);
    expect(r.extras?.studentName).toBe("Test");

    // Unpublished work is not shown; a quiz is a quiz; due dates and categories come along.
    expect(r.assignments!.map((a) => [a.title, a.kind, a.category, a.status])).toEqual([
      ["HW1 Linked lists", "homework", "Homework", "graded"],
      ["HW2 Trees", "homework", "Homework", "upcoming"],
      ["Midterm", "exam", "Exams", "graded"],
      ["Quiz 3", "quiz", "Exams", "upcoming"],
    ]);
    expect(r.grades!.map((g) => [g.assignmentId, g.score, g.pointsPossible])).toEqual([
      ["cv:4101:a1", 9, 10],
      ["cv:4101:a3", 85, 100],
    ]);
    expect(r.schemes![0]!.categories).toEqual([
      { name: "Homework", weight: 40, dropLowest: 1 },
      { name: "Exams", weight: 60 },
    ]);
    expect(r.overall).toMatchObject([{ courseId: "canvas:4101", kind: "weighted-total", percent: 88.5, letter: "B+" }]);

    // Modules are the course page; an assignment's module item lines up with the assignment.
    const page = r.contents![0]!.items;
    expect(page.map((x) => [x.title, x.kind])).toEqual([
      ["Week 1", "folder"],
      ["Lab 1 handout", "file"],
      ["Read me first", "page"],
      ["HW1 Linked lists", "assignment"],
      ["Gradescope", "tool"],
      ["Textbook", "link"],
      ["Exams", "folder"],
      ["Quiz 3", "test"],
    ]);
    expect(page.find((x) => x.title === "HW1 Linked lists")!.id).toBe(r.assignments!.find((a) => a.title === "HW1 Linked lists")!.contentId);
    expect(page.find((x) => x.title === "Quiz 3")!.id).toBe(r.assignments!.find((a) => a.title === "Quiz 3")!.contentId);
    expect(page.find((x) => x.kind === "tool")!.tool).toBe("Gradescope");

    // Files keep Canvas's folders; the syllabus is spotted (the file, and the Syllabus page's text).
    expect(r.files!.map((f) => [f.name, f.folder.join("/"), f.isSyllabus])).toEqual([
      ["CS2100 Syllabus.pdf", "Syllabus", true],
      ["Lab 1 handout.pdf", "Labs", false],
      ["Syllabus (Canvas page).txt", "Syllabus", true],
    ]);
    expect(r.files!.find((f) => f.name === "Lab 1 handout.pdf")!.contentId).toBe("i:i1");
    expect(r.announcements).toMatchObject([{ id: "cv:ann:n1", courseId: "canvas:4101", title: "Office hours moved", read: false }]);
    expect(r.announcements![0]!.body).toContain("Thursday");

    // Read-only: every request was a GET.
    expect(cv.state.log.every((l) => l.startsWith("GET "))).toBe(true);
  });

  it("downloads a file (bytes come from storage, no sign-in sent there) and the Syllabus page as text", async () => {
    const cv = fakeCanvas({ now: NOW });
    const ctx = context({ CANVAS_BASE_URL: cv.base, CANVAS_REQUEST_GAP_MS: "0" }, cv.fetch);
    ctx.secrets.data.set(CANVAS_COOKIES, new CookieJar([cv.sessionCookie]).serialize());
    const r = await canvas.sync(ctx);
    const pdf = await canvas.download!(ctx, r.files!.find((f) => f.name === "CS2100 Syllabus.pdf")!);
    expect(new TextDecoder().decode(pdf.bytes)).toContain("%PDF");
    const page = await canvas.download!(ctx, r.files!.find((f) => f.id.endsWith(":syllabus-body"))!);
    expect(new TextDecoder().decode(page.bytes)).toContain("Course policies");
  });

  it("works with an access token instead of a session, and notices a lost session", async () => {
    const cv = fakeCanvas({ now: NOW });
    const ctx = context({ CANVAS_BASE_URL: cv.base, CANVAS_REQUEST_GAP_MS: "0" }, cv.fetch);
    ctx.secrets.data.set(CANVAS_TOKEN, cv.state.token);
    expect((await canvas.sync(ctx)).courses).toHaveLength(1);
    expect(await canvasUser(cv.base, { token: cv.state.token }, cv.fetch)).toEqual({ id: "777", name: "Test" });

    const gone = context({ CANVAS_BASE_URL: cv.base, CANVAS_REQUEST_GAP_MS: "0" }, cv.fetch);
    gone.secrets.data.set(CANVAS_COOKIES, new CookieJar([cv.sessionCookie]).serialize());
    cv.state.sessionValid = false;
    await expect(canvas.sync(gone)).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe("SIS (PeopleSoft)", () => {
  it("finds the PeopleSoft site from an address the window shows", () => {
    expect(peopleSoftPath("https://sis.school.edu/psp/csprd/EMPLOYEE/SA/h/?tab=DEFAULT")).toBe("/psc/csprd/EMPLOYEE/SA/");
    expect(peopleSoftPath("https://sis.school.edu/psc/csprd/EMPLOYEE/SA/c/X.GBL")).toBe("/psc/csprd/EMPLOYEE/SA/");
    expect(peopleSoftPath("https://sis.school.edu/")).toBeUndefined();
  });

  it("reads the Student Center: this week's classes with rooms, holds, to-dos, enrollment appointment", async () => {
    const s = fakeSis();
    const jar = new CookieJar([s.sessionCookie]);
    const html = await sisGet(s.base, "/psc/csprd/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSS_STUDENT_CENTER.GBL", jar, s.fetch);
    const c = parseStudentCenter(html);
    expect(c.schedule).toEqual([
      { code: "CS 2100", section: "001", component: "LEC", days: [1, 3], start: "14:00", end: "15:15", room: "Rice Hall 130" },
      { code: "CS 2100", section: "101", component: "LAB", days: [5], start: "10:00", end: "11:50", room: "Olsson Hall 001" },
      { code: "ENWR 1510", section: "012", component: "SEM", days: [2, 4], start: "09:30", end: "10:45", room: "Bryan Hall 203" },
    ]);
    expect(c.holds).toEqual([{ title: "Immunization Hold" }]);
    expect(c.todos).toEqual([]);
    expect(c.enrollment).toHaveLength(1);
    expect(c.enrollment[0]!.term).toBe("2027 Spring Regular Academic Session");
    expect(c.enrollment[0]!.at!.slice(0, 10)).toBe("2027-04-05");
  });

  it("reads My Course History and works out GPAs the way a transcript does", async () => {
    const s = fakeSis();
    const html = await sisGet(s.base, "/psc/csprd/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSS_MY_CRSEHIST.GBL", new CookieJar([s.sessionCookie]), s.fetch);
    const h = parseCourseHistory(html);
    expect(h).toHaveLength(7);
    expect(h[0]).toEqual({ term: "2026 Spring", code: "CS 1110", title: "Introduction to Programming", units: 3, grade: "A", status: "Taken" });
    expect(h[5]).toEqual({ term: "2026 Fall", code: "CS 2100", title: "Data Structures and Algorithms 1", units: 4, status: "Enrolled" });

    const scale = { weightByCredits: true, points: { A: 4, "A-": 3.7, "B+": 3.3, B: 3, F: 0 }, levelBonus: {} };
    const v = sisView({ history: h, schedule: [], holds: [], todos: [], enrollment: [], fetchedAt: NOW.toISOString() }, scale);
    // (4×3 + 3.3×4 + 3.7×3) / 10. CR, W and in-progress courses don't count.
    expect(v.gpa).toBeCloseTo(3.63, 3);
    expect(v.units).toBe(10);
    expect(v.terms.map((t) => [t.term, t.gpa, t.courses.length])).toEqual([
      ["2026 Spring", 3.63, 5],
      ["2026 Fall", undefined, 2],
    ]);
  });

  it("gives each class its meeting times from the SIS schedule", () => {
    const rec = { history: [], holds: [], todos: [], enrollment: [], fetchedAt: "", schedule: [{ code: "CS 2100", days: [1, 3], start: "14:00", end: "15:15", room: "Rice Hall 130" }, { code: "CS 2100", days: [5], start: "10:00", end: "11:50" }] };
    expect(sisMeetings(rec, "CS2100")).toEqual([
      { weekday: 1, start: "14:00", end: "15:15", location: "Rice Hall 130" },
      { weekday: 3, start: "14:00", end: "15:15", location: "Rice Hall 130" },
      { weekday: 5, start: "10:00", end: "11:50" },
    ]);
  });

  it("syncs through your session (GET only) and treats a bounce to sign-in as a lost session", async () => {
    const s = fakeSis();
    expect(await sisWorks(s.base, "/psc/csprd/EMPLOYEE/SA/", new CookieJar([s.sessionCookie]), s.fetch)).toBe("/psc/csprd/EMPLOYEE/SA/");
    // A wrong node is tried with the usual student node names too.
    expect(await sisWorks(s.base, "/psc/csprd/EMPLOYEE/HRMS/", new CookieJar([s.sessionCookie]), s.fetch)).toBe("/psc/csprd/EMPLOYEE/SA/");

    const ctx = context({ SIS_BASE_URL: s.base, SIS_PS_PATH: "/psc/csprd/EMPLOYEE/SA/", SIS_REQUEST_GAP_MS: "0" }, s.fetch);
    ctx.secrets.data.set(SIS_COOKIES, new CookieJar([s.sessionCookie]).serialize());
    const r = await sis.sync(ctx);
    expect(r.sis!.history).toHaveLength(7);
    expect(r.sis!.schedule).toHaveLength(3);
    expect(r.notes!.at(-1)).toBe("7 courses on record, 3 class meetings, 1 hold");
    expect(s.state.log.every((l) => l.startsWith("GET "))).toBe(true);

    // Read a few times a day, not every sync.
    const soon = context({ ...ctx.env, SIS_LAST_READ: NOW.toISOString() }, s.fetch, ctx.secrets);
    soon.deep = false;
    expect(await sis.sync(soon)).toEqual({});

    s.state.sessionValid = false;
    await expect(sis.sync(ctx)).rejects.toBeInstanceOf(AuthExpiredError);
  });
});
