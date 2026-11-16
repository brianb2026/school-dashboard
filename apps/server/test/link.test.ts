import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GRADESCOPE_COOKIES, SESSION_COOKIES } from "@sd/connectors";
import type { ConnectorInfo, LinkStatus, SettingsInfo, SyllabusRecord, SyncReport } from "@sd/core";
import { rig, waitFor, type Rig } from "./helpers.js";

let r: Rig;
afterEach(async () => {
  await r?.app.close();
});

describe("Link Blackboard: one click to everything", () => {
  it("signs in, then pulls courses, grades, syllabi, the grade scale, class grade and GPA with no further input", async () => {
    r = rig();
    const done = await r.link({ baseUrl: "learn.fake-school.test/ultra/stream" });
    expect(done).toMatchObject({ target: "blackboard", phase: "done" });

    // The window showed the school's page, closed by itself, and only Blackboard's cookies were kept.
    expect(r.windows).toEqual([{ url: "https://learn.fake-school.test/", headless: undefined, closed: true }]);
    expect(r.secrets.data.get(SESSION_COOKIES)).toContain("BbRouter");
    expect(r.secrets.data.get(SESSION_COOKIES)).not.toContain("ads.example");

    const d = await r.dashboard();
    expect(d.links.blackboard).toEqual({ linked: true, expired: false, host: "learn.fake-school.test", via: "session" });
    expect(d.courses.map((c) => c.code)).toEqual(["CHEM 101", "CSC 172"]);

    const chem = d.courses[0]!;
    // Blackboard's own weighted total wins; the syllabus number is still shown beside it.
    expect(chem.grade).toMatchObject({ basis: "blackboard", letter: "B+" });
    expect(chem.grade.percent).toBeCloseTo(88.2);
    expect(chem.grade.options.map((o) => [o.basis, Math.round(o.percent * 100) / 100])).toEqual([
      ["blackboard", 88.2],
      ["syllabus", 86.25],
      ["points", 84.55],
    ]);
    expect(chem.scheme?.map((c) => [c.name, c.weight])).toEqual([
      ["Homework", 15], ["Labs", 20], ["Quizzes", 10], ["Midterm Exams (2)", 25], ["Final Exam", 30],
    ]);
    expect(chem).toMatchObject({ syllabus: "applied", schemeFrom: "syllabus", cutoffsFrom: "blackboard" });
    expect(chem.instructors.map((p) => p.email)).toEqual(["ada.lin@example.edu"]);

    const csc = d.courses[1]!;
    // No weighted total here, so the syllabus pulled from the course page does the work.
    expect(csc.grade).toMatchObject({ basis: "syllabus", letter: "B" });
    expect(csc.grade.percent).toBeCloseTo((90 * 40 + 80 * 20) / 60);
    expect(csc).toMatchObject({ credits: 4, syllabus: "applied" });
    expect(csc.meetings.map((m) => [m.weekday, m.start, m.end])).toEqual([[2, "14:00", "15:15"], [4, "14:00", "15:15"]]);
    expect(csc.instructors.map((p) => p.email)).toEqual(["okafor@example.edu"]);

    expect(d.gpa?.gpa).toBeCloseTo((3.3 * 3 + 3.0 * 4) / 7);
    // The syllabus was found where Ultra keeps it (a file inside a document under "Course Overview → Syllabus").
    expect(d.files.map((f) => [f.name, f.isSyllabus])).toEqual([
      ["CHEM101_Syllabus.pdf", true],
      ["week1.pptx", false],
      ["Lab 1 handout.pdf", false],
      ["Syllabus.txt", true],
      ["Course Schedule.txt", true],
    ]);
    // Readings that exist only on the schedule page are assignments now; they don't count toward the grade.
    expect(d.assignments.filter((a) => a.kind === "reading").map((a) => [a.title, a.origin, a.categoryResolved])).toEqual([
      ["Read Chapter 5.1 · Hash tables", "Syllabus", undefined],
      ["Read Chapter 6.2 · Binary search trees", "Syllabus", undefined],
      ["Read Chapter 7.1 · Graphs", "Syllabus", undefined],
    ]);
    // The handout that goes with an assignment is one click away.
    expect(d.assignments.find((a) => a.title === "Lab 1")!.materials).toEqual([{ id: "bbfile:_101_1:_f6_1:file", name: "Lab 1 handout.pdf" }]);
    expect(d.assignments.find((a) => a.title === "Homework 1")!.materials).toBeUndefined();
    expect(d.announcements.map((a) => a.title)).toEqual(["Midterm 2 moved"]);
    expect(JSON.stringify(d)).not.toContain("<script");

    const hw1 = d.assignments.find((a) => a.title === "Homework 1")!;
    expect(hw1).toMatchObject({ score: 9, possible: 10, done: true, categoryResolved: "Homework", origin: "Blackboard" });
    expect(d.assignments.find((a) => a.title === "Homework 0 (old)")).toMatchObject({ late: true, done: false });

    const syllabi = (await r.app.inject({ url: "/api/syllabi" })).json() as SyllabusRecord[];
    expect(syllabi.map((s) => [s.filename, s.auto, s.confirmed]).sort()).toEqual([
      ["CHEM101_Syllabus.pdf", true, true],
      ["Course Schedule.txt", true, true],
      ["Syllabus.txt", true, true],
    ]);
    expect(d.notices).toEqual([]);
    // First sync is the baseline: no flood of old news.
    expect(r.pings).toEqual([]);
    // Read-only, and nothing but Blackboard was contacted.
    expect(r.bb.state.log.filter((l) => !l.startsWith("GET /"))).toEqual([]);

    const conns = (await r.app.inject({ url: "/api/connectors" })).json() as ConnectorInfo[];
    const bbc = conns.find((c) => c.id === "blackboard-session")!;
    expect(bbc.status.state).toBe("ready");
    expect(bbc.notes!.join("\n")).toMatch(/2 courses, .* grades.*\n[\s\S]*2 syllabuses read: grading weights applied\n1 schedule page read: dates and readings added/);
    // No Gradescope links in this school's Blackboard: nothing else was opened.
    expect(d.links.gradescope).toMatchObject({ linked: false, viaBlackboard: false });
    expect(conns.map((c) => c.id)).not.toContain("qwickly");
  });

  it("reads a syllabus again by itself when the reader has improved, but never one you confirmed yourself", async () => {
    r = rig();
    await r.link();
    const db = r.app.ctx.db;
    const list = async () => (await r.app.inject({ url: "/api/syllabi" })).json() as SyllabusRecord[];
    const before = await list();
    // Pretend these were read by an older reader, and that you confirmed the CHEM one by hand.
    db.prepare("UPDATE syllabi SET source_file = replace(source_file, '#p', '#old')").run();
    db.prepare("UPDATE syllabi SET auto = 0 WHERE filename = 'CHEM101_Syllabus.pdf'").run();
    await r.app.inject({ method: "POST", url: "/api/sync", payload: {} });
    const after = await list();
    expect(after).toHaveLength(3);
    const id = (l: SyllabusRecord[], name: string) => l.find((s) => s.filename === name)!.id;
    expect(id(after, "CHEM101_Syllabus.pdf")).toBe(id(before, "CHEM101_Syllabus.pdf"));
    expect(id(after, "Syllabus.txt")).not.toBe(id(before, "Syllabus.txt"));
    expect(id(after, "Course Schedule.txt")).not.toBe(id(before, "Course Schedule.txt"));
    // Nothing doubled, and the grade still stands on the same weights.
    const d = await r.dashboard();
    expect(d.assignments.filter((a) => a.kind === "reading")).toHaveLength(3);
    expect(d.courses[1]).toMatchObject({ syllabus: "applied", schemeFrom: "syllabus" });
    // A second sync changes nothing more.
    await r.app.inject({ method: "POST", url: "/api/sync", payload: {} });
    expect((await list()).map((s) => s.id).sort()).toEqual(after.map((s) => s.id).sort());
  });

  it("keeps your changes across syncs, drops what Blackboard dropped, and pings only for news", async () => {
    r = rig();
    await r.link();
    const patch = await r.app.inject({ method: "PATCH", url: "/api/courses/bb%3A_101_1", payload: { name: "Chem!", credits: 4, color: "c7", gradeSource: "syllabus" } });
    expect(patch.statusCode).toBe(200);
    expect((await r.app.inject({ method: "DELETE", url: "/api/courses/bb%3A_172_1" })).json()).toEqual({ ok: true, hidden: true });
    await r.app.inject({ method: "PATCH", url: "/api/assignments/bb%3A_101_1%3A_c2_1", payload: { done: true, effortHours: 4 } });
    await r.app.inject({ method: "PUT", url: "/api/grades/bb%3A_101_1%3A_c4_1", payload: { score: 20, pointsPossible: 25 } });
    await r.app.inject({ method: "POST", url: "/api/announcements/bb%3A_101_1%3Aann%3A_a1_1/read", payload: { read: true } });

    r.bb.state.lateGrade = true; // Homework 2 gets graded
    r.bb.state.removedColumns.add("_c5_1"); // instructor deletes "Homework 0 (old)"
    r.bb.state.renames.set("_c3_1", "Midterm Exam One");
    const before = r.bb.state.log.length;
    const reports = (await r.app.inject({ method: "POST", url: "/api/sync", payload: {} })).json() as SyncReport[];
    expect(reports.find((x) => x.connector === "blackboard-session")).toMatchObject({ ok: true });

    const d = await r.dashboard();
    expect(d.courses.map((c) => c.code)).toEqual(["CHEM 101"]);
    expect(d.hiddenCourses).toEqual([{ id: "bb:_172_1", code: "CSC 172", name: "Data Structures & Algorithms" }]);
    // The hidden course costs no requests any more.
    expect(r.bb.state.log.slice(before).some((l) => l.includes("_172_1/"))).toBe(false);
    expect(d.courses[0]).toMatchObject({ name: "Chem!", credits: 4, color: "c7" });
    expect(d.courses[0]!.grade.basis).toBe("syllabus");

    const titles = d.assignments.map((a) => a.title);
    expect(titles).not.toContain("Homework 0 (old)");
    expect(titles).toContain("Midterm Exam One");
    expect(d.assignments.find((a) => a.title === "Homework 2")).toMatchObject({ userDone: true, effortHours: 4, score: 10 });
    expect(d.assignments.find((a) => a.title === "Lab 1")).toMatchObject({ score: 20, possible: 25 });
    expect(d.announcements[0]!.read).toBe(true);
    expect(d.assignments.every((a) => a.courseId !== "bb:_172_1")).toBe(true);

    expect(r.pings).toEqual([{ title: "Grade posted · CHEM 101", body: "Homework 2: 10 / 10" }]);
    await r.app.inject({ method: "POST", url: "/api/sync", payload: {} });
    expect(r.pings).toHaveLength(1); // nothing new, nothing said

    // Bring the course back.
    await r.app.inject({ method: "PATCH", url: "/api/courses/bb%3A_172_1", payload: { hidden: false } });
    expect((await r.dashboard()).courses).toHaveLength(2);
  });

  it("notices an expired sign-in, says so, and one click reconnects", async () => {
    r = rig();
    await r.link();
    r.bb.state.sessionValid = false;
    const reports = (await r.app.inject({ method: "POST", url: "/api/sync", payload: {} })).json() as SyncReport[];
    expect(reports.find((x) => x.connector === "blackboard-session")).toMatchObject({ ok: false, detail: "Sign-in expired" });
    let d = await r.dashboard();
    expect(d.links.blackboard.expired).toBe(true);
    expect(d.notices[0]).toMatchObject({ id: "bb-expired", action: "link-blackboard" });
    expect(d.courses).toHaveLength(2); // your data stays while signed out

    expect(await r.link({})).toMatchObject({ phase: "done" });
    d = await r.dashboard();
    expect(d.links.blackboard.expired).toBe(false);
    expect(d.notices).toEqual([]);
    expect(r.windows).toHaveLength(2);
  });

  it("renews an expired sign-in by itself when the school still remembers you, and backs off when it doesn't", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-renew-"));
    try {
      mkdirSync(join(dir, "browser-profile"));
      r = rig({ dataDir: dir, renewMs: 200 });
      await r.link();
      r.bb.state.sessionValid = false;
      // The pretend browser profile still has the single sign-on, so a hidden window gets a fresh session.
      const reports = (await r.app.inject({ method: "POST", url: "/api/sync", payload: {} })).json() as SyncReport[];
      expect(reports.find((x) => x.connector === "blackboard-session")).toMatchObject({ ok: true });
      expect(r.windows.at(-1)).toMatchObject({ headless: true, closed: true });
      expect((await r.dashboard()).links.blackboard.expired).toBe(false);
      await r.app.close();

      // Now the school has forgotten you: the hidden attempt fails, the dashboard says so, and it doesn't keep hammering.
      r = rig({ dataDir: dir, renewMs: 60, window: "closes" });
      r.secrets.data.set(SESSION_COOKIES, "[]");
      await r.app.inject({ method: "POST", url: "/api/link/blackboard", payload: { baseUrl: r.bb.base } });
      await r.app.inject({ method: "POST", url: "/api/link/cancel", payload: {} });
      r.bb.state.sessionValid = false;
      const before = r.windows.length;
      await r.app.ctx.sync.run();
      expect((await r.dashboard()).links.blackboard.expired).toBe(true);
      const afterFirst = r.windows.length;
      expect(afterFirst).toBe(before + 1);
      await r.app.ctx.sync.run(); // scheduled run within the back-off window: no new attempt
      expect(r.windows.length).toBe(afterFirst);
      await r.app.inject({ method: "POST", url: "/api/sync", payload: {} }); // you pressed Sync now: try again
      expect(r.windows.length).toBe(afterFirst + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles a closed window, a missing browser and a bad address without saving anything", async () => {
    r = rig({ window: "closes" });
    expect(await r.link()).toMatchObject({ phase: "cancelled" });
    expect(r.secrets.data.size).toBe(0);
    expect(r.windows[0]!.closed).toBe(true);
    await r.app.close();

    r = rig({ window: "no-chrome" });
    expect(await r.link()).toMatchObject({ phase: "error", message: expect.stringContaining("Chrome") });
    const bad = await r.app.inject({ method: "POST", url: "/api/link/blackboard", payload: { baseUrl: "http://learn.school.edu" } });
    expect(bad.statusCode).toBe(400);
    const none = await rig().app.inject({ method: "POST", url: "/api/link/blackboard", payload: {} });
    expect(none.statusCode).toBe(400);
  });

  it("unlinks, and downloads course files through the link (cached for offline, always as a download)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-files-"));
    try {
      r = rig({ dataDir: dir });
      await r.link();
      const d = await r.dashboard();
      const pdf = d.files.find((f) => f.name.endsWith(".pdf"))!;
      const before = r.bb.state.log.length;
      const res = await r.app.inject({ url: `/api/files/${encodeURIComponent(pdf.id)}/download` });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="CHEM101_Syllabus\.pdf"/);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      expect(readdirSync(join(dir, "files"))).toHaveLength(1);
      const mid = r.bb.state.log.length;
      expect(mid).toBeGreaterThan(before);
      await r.app.inject({ url: `/api/files/${encodeURIComponent(pdf.id)}/download` });
      expect(r.bb.state.log.length).toBe(mid); // second time comes from disk
      expect((await r.app.inject({ url: "/api/files/nope/download" })).statusCode).toBe(404);

      // Reading in place: a PDF may be shown inside the dashboard (and only there); anything else is download-only.
      const handout = d.files.find((f) => f.name === "Lab 1 handout.pdf")!;
      const view = await r.app.inject({ url: `/api/files/${encodeURIComponent(handout.id)}/view` });
      expect(view.statusCode).toBe(200);
      expect(view.headers["content-type"]).toBe("application/pdf");
      expect(view.headers["content-disposition"]).toMatch(/^inline/);
      expect(view.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(String(view.headers["content-security-policy"])).toContain("frame-ancestors 'self'");
      const slides = d.files.find((f) => f.name === "week1.pptx")!;
      expect((await r.app.inject({ url: `/api/files/${encodeURIComponent(slides.id)}/view` })).statusCode).toBe(415);
      // A typed schedule page opens as plain text.
      const page = d.files.find((f) => f.name === "Course Schedule.txt")!;
      const text = (await r.app.inject({ url: `/api/files/${encodeURIComponent(page.id)}/text` })).json() as { name: string; text: string };
      expect(text.text).toContain("Week of March 8: Read Chapter 5.1 Hash tables");
      expect((await r.app.inject({ url: `/api/files/${encodeURIComponent(slides.id)}/text` })).statusCode).toBe(415);
      // Ordinary pages still refuse to be framed.
      expect((await r.app.inject({ url: "/api/dashboard" })).headers["x-frame-options"]).toBe("DENY");

      await r.app.inject({ method: "DELETE", url: "/api/link/blackboard" });
      expect(r.secrets.data.has(SESSION_COOKIES)).toBe(false);
      expect((await r.dashboard()).links.blackboard.linked).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Gradescope, opened through Blackboard", () => {
  const settled = (x: Rig) =>
    waitFor(async () => {
      const d = await x.dashboard();
      const st = (await x.app.inject({ url: "/api/link/status" })).json() as LinkStatus;
      return d.links.gradescope.linked && !d.syncing && st.phase !== "opening" && st.phase !== "waiting" && st.phase !== "syncing" ? d : undefined;
    });

  it("links by itself right after Blackboard, brings in Gradescope-only work, and shows both scores where they differ", async () => {
    r = rig({ gradescope: true });
    await r.link();
    let d = await settled(r);

    // Nobody pressed anything for Gradescope: the app opened the Blackboard link with the Blackboard sign-in.
    expect(r.windows).toEqual([
      { url: "https://learn.fake-school.test/", headless: undefined, closed: true },
      { url: "https://learn.fake-school.test/webapps/blackboard/execute/blti/launchLink?course_id=_172_1&content_id=_g2_1", headless: undefined, closed: true, cookies: ["BbRouter"] },
    ]);
    expect(d.links.gradescope).toMatchObject({ linked: true, expired: false, viaBlackboard: true });
    expect(r.secrets.data.get(GRADESCOPE_COOKIES)).toContain("_gradescope_session");
    expect(r.secrets.data.get(GRADESCOPE_COOKIES)).not.toContain("BbRouter");

    const csc = d.assignments.filter((a) => a.courseId === "bb:_172_1" && a.origin !== "Syllabus");
    expect(csc.map((a) => [a.title, a.origin, a.score, a.possible])).toEqual([
      ["Project 1", "Blackboard", 47, 50], // one row, not two: matched by the Gradescope number, not the name
      ["Quiz 1", "Blackboard", 8, 10],
      ["Lab 3", "Gradescope", 18, 20], // exists only in Gradescope
      ["Homework 5", "Gradescope", undefined, undefined],
      ["Project 2", "Blackboard", undefined, undefined],
    ]);
    const p1 = csc[0]!;
    expect(p1).toMatchObject({ scoreFrom: "Gradescope", scoresDiffer: true });
    expect(p1.scores).toEqual([
      { from: "Blackboard", score: 45, possible: 50 },
      { from: "Gradescope", score: 47, possible: 50 },
    ]);
    expect(d.notices.map((n) => n.id)).toEqual(["scores-differ"]);
    // Projects (47 + 18) / 70 at 40%, quizzes 8/10 at 20%.
    expect(d.courses[1]!.grade.percent).toBeCloseTo(((65 / 70) * 100 * 40 + 80 * 20) / 60);

    // One click switches which score counts; it sticks across syncs and can be switched back.
    const id = encodeURIComponent(p1.id);
    expect((await r.app.inject({ method: "PATCH", url: `/api/assignments/${id}`, payload: { gradeFrom: "canvas" } })).statusCode).toBe(400);
    await r.app.inject({ method: "PATCH", url: `/api/assignments/${id}`, payload: { gradeFrom: "blackboard" } });
    await r.app.inject({ method: "POST", url: "/api/sync", payload: {} });
    d = await settled(r);
    expect(d.assignments.find((a) => a.id === p1.id)).toMatchObject({ score: 45, scoreFrom: "Blackboard", scoresDiffer: true });
    // Your own entry always wins over both.
    await r.app.inject({ method: "PUT", url: `/api/grades/${id}`, payload: { score: 50, pointsPossible: 50 } });
    expect((await r.dashboard()).assignments.find((a) => a.id === p1.id)).toMatchObject({ score: 50, scoreFrom: "You" });
    await r.app.inject({ method: "DELETE", url: `/api/grades/${id}` });
    await r.app.inject({ method: "PATCH", url: `/api/assignments/${id}`, payload: { gradeFrom: null } });
    expect((await r.dashboard()).assignments.find((a) => a.id === p1.id)).toMatchObject({ score: 47, scoreFrom: "Gradescope" });

    // Still read-only everywhere, and it does not keep opening windows.
    expect(r.bb.state.log.filter((l) => !l.startsWith("GET /"))).toEqual([]);
    expect(r.gs.seen.every((x) => x === "www.gradescope.com/account" || x === "www.gradescope.com/courses/9001")).toBe(true);
    expect(r.windows).toHaveLength(2);
  });

  it("does it with no window at all when the sign-in browser's profile is there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-gs-"));
    try {
      mkdirSync(join(dir, "browser-profile"));
      r = rig({ gradescope: true, dataDir: dir, renewMs: 500 });
      await r.link();
      const d = await settled(r);
      expect(r.windows.map((w) => [w.headless, w.closed, w.cookies])).toEqual([
        [undefined, true, undefined],
        [true, true, ["BbRouter"]],
      ]);
      expect(d.assignments.some((a) => a.title === "Lab 3" && a.score === 18)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unlinking Gradescope takes its items away again and leaves Blackboard alone", async () => {
    r = rig({ gradescope: true });
    await r.link();
    await settled(r);
    await r.app.inject({ method: "DELETE", url: "/api/link/gradescope" });
    await r.app.ctx.sync.run();
    const d = await r.dashboard();
    expect(d.links.gradescope.linked).toBe(false);
    expect(d.links.blackboard.linked).toBe(true);
    expect(d.assignments.find((a) => a.title === "Project 1")).toMatchObject({ score: 45, scoreFrom: "Blackboard" });
    expect(d.assignments.find((a) => a.title === "Project 1")!.scoresDiffer).toBeUndefined();
    expect(d.assignments.some((a) => a.origin === "Gradescope")).toBe(false);
    // You unlinked it on purpose, so it is not opened again behind your back, not even on "Sync now"…
    await r.app.inject({ method: "POST", url: "/api/sync", payload: {} });
    await new Promise((res) => setTimeout(res, 60));
    expect(r.windows).toHaveLength(2);
    // …until you ask for it.
    await r.app.inject({ method: "POST", url: "/api/link/gradescope", payload: {} });
    expect((await settled(r)).assignments.some((a) => a.title === "Lab 3")).toBe(true);
    expect(r.windows).toHaveLength(3);
  });
});

describe("the demo can't swallow a real sign-in", () => {
  it("only links its own pretend Blackboard, and says where to go instead", async () => {
    r = rig({ gradescope: true, env: { BLACKBOARD_REQUEST_GAP_MS: "0", GRADESCOPE_REQUEST_GAP_MS: "0", DEMO_ONLY_BASE: "https://learn.fake-school.test" } });
    const info = (await r.app.inject({ url: "/api/settings" })).json() as SettingsInfo;
    expect(info.demo).toBe(true);

    const real = await r.app.inject({ method: "POST", url: "/api/link/blackboard", payload: { baseUrl: "learn.real-school.edu" } });
    expect(real.json()).toMatchObject({ phase: "error", message: expect.stringContaining("This is the demo") });
    expect((await r.app.inject({ method: "POST", url: "/api/link/gradescope", payload: {} })).json()).toMatchObject({ phase: "error" });
    expect((await r.app.inject({ method: "PUT", url: "/api/settings/gmail", payload: { clientId: "x.apps.googleusercontent.com", clientSecret: "0123456789abc" } })).statusCode).toBe(400);
    expect(r.windows).toEqual([]);
    expect(r.secrets.data.size).toBe(0);

    // Its own pretend Blackboard still links, and no Gradescope window follows.
    expect(await r.link({ baseUrl: "learn.fake-school.test" })).toMatchObject({ phase: "done" });
    await new Promise((res) => setTimeout(res, 60));
    expect(r.windows).toHaveLength(1);
  });
});
