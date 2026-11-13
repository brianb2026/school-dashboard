import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FetchLike } from "@sd/connectors";
import type { DashboardData, SettingsInfo, SyllabusRecord, UnmatchedItem } from "@sd/core";
import { openDb } from "../src/db/client.js";
import { rig, type Rig } from "./helpers.js";

const SYLLABUS = `CHEM 101 — General Chemistry I        Spring 2027
Instructor: Dr. Ada Lin   ada.lin@example.edu
Office hours: Tue/Thu 2:00–3:30 pm, Science 214
Lecture: MWF 10:25-11:15 am, Hutchison 141

  Homework ............ 15%
  Labs                  20%
  Quizzes: 10%
  Midterm Exams (2)     25 %
  Final Exam - 30 percent

Grades: A 93-100, A- 90-92, B+ 87-89, B 83-86, B- 80-82, C 70-79, D 60-69, F 0-59
Late policy: no work accepted after solutions post.

Week 3  Feb 4    Quiz 1
Week 6  Thu, Feb 25  Midterm Exam 1
3/18  Lab report 4 due
`;

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:bb-1",
  "SUMMARY:Problem set 8 - MATH-221-001",
  "DTSTART:20270210T045900Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:bb-2",
  "SUMMARY:Reading response 3",
  "DESCRIPTION:HIS140 Modern Europe",
  "DTSTART:20270211T045900Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

let r: Rig;
afterEach(async () => {
  await r?.app.close();
});

const upload = (name: string, body: string | Buffer) =>
  r.app.inject({ method: "POST", url: `/api/syllabus?name=${encodeURIComponent(name)}`, headers: { "content-type": "application/octet-stream" }, payload: Buffer.from(body) });

describe("database", () => {
  it("runs each migration once and reopens an existing file cleanly, readable by you only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-"));
    try {
      const a = openDb(dir);
      a.prepare("INSERT INTO settings (key, value) VALUES ('k', 'v')").run();
      a.close();
      const b = openDb(dir);
      expect(b.prepare("PRAGMA user_version").get()?.user_version).toBe(4);
      expect(b.prepare("SELECT value FROM settings WHERE key = 'k'").get()?.value).toBe("v");
      b.close();
      const { statSync } = await import("node:fs");
      if (process.platform !== "win32") expect(statSync(join(dir, "school.sqlite")).mode & 0o077).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("guarding the local API", () => {
  it("refuses other sites, other host names and plain HTML forms", async () => {
    r = rig();
    const get = (headers: Record<string, string>, url = "/api/settings") => r.app.inject({ url, headers });
    expect((await get({ origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await get({ host: "evil.example:5179" })).statusCode).toBe(403);
    expect((await get({ "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
    expect((await get({ "sec-fetch-site": "cross-site" }, "/api/files/x/download")).statusCode).toBe(403);
    expect((await get({ host: "127.0.0.1:5179", origin: "http://127.0.0.1:5179", "sec-fetch-site": "same-origin" })).statusCode).toBe(200);
    // Another local port (some other app on this Mac) is refused too, unless the server runs in dev mode.
    expect((await get({ host: "127.0.0.1:5179", origin: "http://127.0.0.1:5173" })).statusCode).toBe(403);
    const dev = rig({ env: { SD_DEV: "1" } });
    expect((await dev.app.inject({ url: "/api/settings", headers: { host: "127.0.0.1:5179", origin: "http://127.0.0.1:5173" } })).statusCode).toBe(200);
    expect((await dev.app.inject({ url: "/api/settings", headers: { host: "127.0.0.1:5179", origin: "https://evil.example" } })).statusCode).toBe(403);
    await dev.app.close();
    const form = await r.app.inject({ method: "POST", url: "/api/wipe", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "confirm=WIPE" });
    expect(form.statusCode).toBe(415);
    const ok = await get({});
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect(ok.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(ok.headers["cache-control"]).toBe("no-store");
  });

  it("serves the built UI but never a file outside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sd-web-"));
    try {
      mkdirSync(join(dir, "dist", "assets"), { recursive: true });
      writeFileSync(join(dir, "dist", "index.html"), "<title>ui</title>");
      writeFileSync(join(dir, "dist", "assets", "app.js"), "console.log(1)");
      writeFileSync(join(dir, "secret.txt"), "top secret");
      r = rig({ webDist: join(dir, "dist") });
      expect((await r.app.inject({ url: "/" })).body).toBe("<title>ui</title>");
      expect((await r.app.inject({ url: "/assets/app.js" })).headers["content-type"]).toMatch(/javascript/);
      expect((await r.app.inject({ url: "/some/page" })).body).toBe("<title>ui</title>");
      for (const url of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt", "/%2e%2e%5csecret.txt"]) {
        const res = await r.app.inject({ url });
        expect(res.body, url).not.toContain("top secret");
      }
      expect((await r.app.inject({ url: "/api/nope" })).statusCode).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("settings", () => {
  it("stores the calendar link as a secret and only ever returns its host", async () => {
    r = rig();
    expect((await r.app.inject({ method: "PUT", url: "/api/settings/calendar-link", payload: { url: "not a link" } })).statusCode).toBe(400);
    expect((await r.app.inject({ method: "PUT", url: "/api/settings/calendar-link", payload: { url: "http://school.example/x.ics" } })).statusCode).toBe(400);
    const res = await r.app.inject({
      method: "PUT",
      url: "/api/settings/calendar-link",
      payload: { url: "webcal://school.blackboard.com/webapps/calendar/calendarFeed/abc123/learn.ics" },
    });
    const info = res.json() as SettingsInfo;
    expect(info.calendarLink).toEqual({ set: true, host: "school.blackboard.com", fromEnv: false });
    expect(res.body).not.toContain("abc123");
    expect(r.secrets.data.get("blackboard.ical_url")).toMatch(/^https:\/\/school\.blackboard\.com\//);
    expect(((await r.app.inject({ method: "DELETE", url: "/api/settings/calendar-link" })).json() as SettingsInfo).calendarLink.set).toBe(false);

    const off = (await r.app.inject({ method: "PUT", url: "/api/settings/notifications", payload: { enabled: false } })).json() as SettingsInfo;
    expect(off.notifications).toBe(false);
    expect((await r.dashboard()).notifications).toBe(false);
  });

  it("wipes everything only when asked plainly", async () => {
    r = rig();
    await r.link();
    expect((await r.app.inject({ method: "POST", url: "/api/wipe", payload: { confirm: "yes" } })).statusCode).toBe(400);
    expect((await r.app.inject({ method: "POST", url: "/api/wipe", payload: { confirm: "WIPE" } })).json()).toEqual({ ok: true });
    const d = await r.dashboard();
    expect(d).toMatchObject({ hasData: false, courses: [], assignments: [] });
    expect(d.links.blackboard.linked).toBe(false);
    expect(r.secrets.data.size).toBe(0);
  });
});

describe("calendar feed + course matching", () => {
  it("syncs the feed, matches by code, and lets you fix the rest with an alias", async () => {
    const seen: string[] = [];
    const feed: FetchLike = async (input) => {
      seen.push(String(input));
      return new Response(ICS, { status: 200 });
    };
    r = rig({ fetch: feed });
    await r.app.inject({ method: "PUT", url: "/api/settings/calendar-link", payload: { url: "https://school.example/feed.ics" } });
    await r.app.inject({ method: "POST", url: "/api/courses", payload: { code: "MATH 221", name: "Calculus II", credits: 4 } });
    expect((await r.app.inject({ method: "POST", url: "/api/courses", payload: { code: "math-221", name: "Again" } })).statusCode).toBe(409);
    const hist = (await r.app.inject({ method: "POST", url: "/api/courses", payload: { code: "HIST 140", name: "Modern Europe", color: "c1" } })).json() as {
      course: { id: string };
    };

    const report = (await r.app.inject({ method: "POST", url: "/api/sync", payload: {} })).json() as { connector: string; ok: boolean }[];
    expect(report.find((x) => x.connector === "blackboard-ical")?.ok).toBe(true);
    expect(seen).toEqual(["https://school.example/feed.ics"]);

    // "HIS140" isn't "HIST 140" by code, but the full name "Modern Europe" matches.
    let d = await r.dashboard();
    expect(d.unmatchedCount).toBe(0);
    expect(d.assignments.map((a) => a.courseId).sort()).toEqual(["manual:hist140", "manual:math221"]);
    expect(d.assignments[0]!.origin).toBe("Calendar feed");

    // Delete the course: its item goes to Unmatched; recreate + alias puts it back.
    await r.app.inject({ method: "DELETE", url: `/api/courses/${encodeURIComponent(hist.course.id)}` });
    d = await r.dashboard();
    expect(d.notices.map((n) => n.id)).toEqual(["unmatched"]);
    const unmatched = (await r.app.inject({ url: "/api/unmatched" })).json() as UnmatchedItem[];
    expect(unmatched.map((u) => u.suggestedPattern)).toEqual(["HIS140"]);
    const again = (await r.app.inject({ method: "POST", url: "/api/courses", payload: { code: "HIST 140", name: "Europe since 1789" } })).json() as {
      course: { id: string };
      matched: number;
    };
    expect(again.matched).toBe(0);
    expect((await r.app.inject({ method: "POST", url: "/api/aliases", payload: { pattern: "HIS140", courseId: again.course.id } })).json()).toEqual({ matched: 1 });

    // An item that leaves the feed leaves the dashboard; the chosen course survives a re-sync.
    await r.app.inject({ method: "POST", url: "/api/sync", payload: {} });
    expect((await r.dashboard()).unmatchedCount).toBe(0);

    const ics = await r.app.inject({ url: "/calendar.ics" });
    expect(ics.headers["content-type"]).toMatch(/text\/calendar/);
    expect(ics.body).toContain("SUMMARY:MATH 221 Problem set 8 - MATH-221-001");

    const bad: FetchLike = async () => new Response("<html>login</html>", { status: 200 });
    await r.app.close();
    r = rig({ fetch: bad });
    await r.app.inject({ method: "PUT", url: "/api/settings/calendar-link", payload: { url: "https://school.example/feed.ics" } });
    const rep = (await r.app.inject({ method: "POST", url: "/api/sync", payload: {} })).json() as { connector: string; ok: boolean; detail?: string }[];
    expect(rep.find((x) => x.connector === "blackboard-ical")).toMatchObject({ ok: false, detail: expect.stringContaining("did not return a calendar") });
  });
});

describe("syllabus upload", () => {
  it("waits for review when it can't tell the course; applies only what you confirm", async () => {
    r = rig();
    expect((await upload("notes.exe", "x")).statusCode).toBe(400);
    expect((await upload("empty.txt", "")).statusCode).toBe(400);
    const up = await upload("chem101.txt", SYLLABUS);
    expect(up.statusCode).toBe(200);
    const rec = up.json() as SyllabusRecord;
    expect(rec).toMatchObject({ confirmed: false, auto: false });
    expect(rec.suggestedCourseId).toBeUndefined();
    expect(rec.parse.course).toEqual({ code: "CHEM 101", title: "General Chemistry I" });
    expect(rec.parse.weights.total).toBe(100);
    expect(rec.parse.letterScale?.[0]).toEqual({ letter: "A", min: 93 });
    expect((await r.dashboard()).hasData).toBe(false);

    const confirm = (payload: object) => r.app.inject({ method: "POST", url: `/api/syllabus/${rec.id}/confirm`, payload });
    const base = { newCourse: { code: "CHEM 101", name: "General Chemistry I" }, items: [], instructorEmails: [] };
    expect((await confirm({ ...base, weights: [{ name: "Homework", weight: 50 }] })).json()).toEqual({ error: "Weights add up to 50%, not 100%." });
    expect((await confirm({ ...base, weights: [{ name: "A", weight: 50 }, { name: "a", weight: 50 }] })).json()).toEqual({ error: "Two grading categories have the same name." });
    expect((await confirm({ ...base, weights: "nope" })).statusCode).toBe(400);
    expect((await confirm({ ...base, weights: [], items: [{ date: "2027-13-45", title: "x", kind: "quiz" }] })).statusCode).toBe(400);

    const body = {
      newCourse: { code: "CHEM 101", name: "General Chemistry I", credits: 4, level: "regular", color: "c4" },
      weights: rec.parse.weights.weights.map((w) => ({ name: w.name, weight: w.weight })),
      // You unticked the quiz in the review screen and set the midterm time.
      items: rec.parse.dates.filter((d) => d.kind !== "quiz").map((d) => ({ date: d.date, title: d.title, kind: d.kind, time: d.kind === "exam" ? "09:30" : undefined })),
      instructorEmails: [...rec.parse.policies.instructorEmails, "not an email"],
      officeHours: rec.parse.policies.officeHours,
      latePolicy: rec.parse.policies.latePolicy,
      letterScale: rec.parse.letterScale,
    };
    expect((await confirm(body)).json()).toEqual({ courseId: "manual:chem101", items: 2, categories: 5 });
    // Confirming again replaces, not duplicates.
    await confirm({ ...body, newCourse: undefined, courseId: "manual:chem101" });

    let d = await r.dashboard();
    const chem = d.courses[0]!;
    expect(chem).toMatchObject({ schemeFrom: "syllabus", syllabus: "applied", cutoffsFrom: "syllabus" });
    expect(chem.scheme).toHaveLength(5);
    expect(chem.instructors.map((p) => p.email)).toEqual(["ada.lin@example.edu"]);
    expect(chem.policies?.latePolicy).toMatch(/no work accepted/);
    expect(chem.meetings.map((m) => m.weekday)).toEqual([1, 3, 5]);
    expect(d.assignments.map((a) => [a.title, a.categoryResolved, a.origin])).toEqual([
      ["Midterm Exam 1", "Midterm Exams (2)", "Syllabus"],
      ["Lab report 4 due", "Labs", "Syllabus"],
    ]);
    const reopened = (await r.app.inject({ url: `/api/syllabus/${rec.id}` })).json() as SyllabusRecord;
    expect(reopened).toMatchObject({ confirmed: true, auto: false, suggestedCourseId: "manual:chem101" });
    expect(reopened.applied?.items.map((i) => i.kind)).toEqual(["exam", "lab"]);

    const cal = (await r.app.inject({ url: "/calendar.ics" })).body;
    // Midterm Feb 25 at 09:30 New York time = 14:30 UTC; lab report at 23:59 → next day 03:59 UTC (after DST).
    expect(cal).toContain("DTSTART:20270225T143000Z");
    expect(cal).toContain("DTSTART:20270319T035900Z");

    // Deleting the syllabus removes what it added.
    await r.app.inject({ method: "DELETE", url: `/api/syllabus/${rec.id}` });
    d = await r.dashboard();
    expect(d.assignments).toEqual([]);
    expect(d.courses[0]!.scheme).toBeUndefined();
  });

  it("applies at once when the course is known and the weights add up; never over weights you set", async () => {
    r = rig();
    await r.app.inject({ method: "POST", url: "/api/courses", payload: { code: "CHEM 101", name: "General Chemistry" } });
    const rec = (await upload("chem101.txt", SYLLABUS)).json() as SyllabusRecord;
    expect(rec).toMatchObject({ confirmed: true, auto: true, courseId: "manual:chem101" });
    let d = await r.dashboard();
    expect(d.courses[0]!.scheme).toHaveLength(5);
    expect(d.assignments).toHaveLength(3);

    // You edit the weights by hand; a second upload must not overwrite them.
    const put = await r.app.inject({ method: "PUT", url: "/api/courses/manual%3Achem101/scheme", payload: { categories: [{ name: "Everything", weight: 100 }] } });
    expect(put.statusCode).toBe(200);
    const second = (await upload("chem101-v2.txt", SYLLABUS + "\n")).json() as SyllabusRecord;
    expect(second.confirmed).toBe(false);
    d = await r.dashboard();
    expect(d.courses[0]).toMatchObject({ schemeFrom: "you" });
    expect(d.courses[0]!.scheme).toEqual([{ name: "Everything", weight: 100 }]);
    // No nagging: you already set the weights, so the new file is just there if you want it.
    expect(d.notices.map((n) => n.id)).not.toContain("syllabus-review");
    expect((await r.app.inject({ method: "PUT", url: "/api/courses/manual%3Achem101/scheme", payload: { categories: [{ name: "X", weight: 60 }] } })).statusCode).toBe(400);
  });
});

describe("your own entries", () => {
  it("adds work, scores, done marks and attendance; computes the grade and GPA from them", async () => {
    r = rig();
    await r.app.inject({ method: "POST", url: "/api/courses", payload: { code: "ART 110", name: "Drawing", credits: 2 } });
    const add = (payload: object) => r.app.inject({ method: "POST", url: "/api/assignments", payload });
    expect((await add({ courseId: "nope", title: "x", kind: "quiz", date: "2027-02-01" })).statusCode).toBe(400);
    expect((await add({ courseId: "manual:art110", title: "", kind: "quiz", date: "2027-02-01" })).statusCode).toBe(400);
    const a1 = (await add({ courseId: "manual:art110", title: "Sketchbook 1", kind: "homework", date: "2027-02-01", pointsPossible: 20 })).json() as { id: string };
    const a2 = (await add({ courseId: "manual:art110", title: "Critique", kind: "discussion", date: "2027-02-08", time: "14:00" })).json() as { id: string };
    const enc = encodeURIComponent;

    expect((await r.app.inject({ method: "PUT", url: `/api/grades/${enc(a1.id)}`, payload: { score: "abc" } })).statusCode).toBe(400);
    expect((await r.app.inject({ method: "PUT", url: `/api/grades/${enc(a2.id)}`, payload: { score: 5 } })).statusCode).toBe(400); // out of what?
    await r.app.inject({ method: "PUT", url: `/api/grades/${enc(a1.id)}`, payload: { score: 19 } });
    await r.app.inject({ method: "PATCH", url: `/api/assignments/${enc(a2.id)}`, payload: { done: true } });
    expect((await r.app.inject({ method: "PATCH", url: `/api/assignments/${enc(a2.id)}`, payload: { effortHours: 500 } })).statusCode).toBe(400);
    expect((await r.app.inject({ method: "PATCH", url: "/api/assignments/missing", payload: { done: true } })).statusCode).toBe(404);

    for (const [date, status] of [["2027-02-01", "present"], ["2027-02-03", "late"], ["2027-02-05", "absent"], ["2027-02-08", "excused"]]) {
      await r.app.inject({ method: "POST", url: "/api/attendance", payload: { courseId: "manual:art110", date, status } });
    }
    expect((await r.app.inject({ method: "POST", url: "/api/attendance", payload: { courseId: "manual:art110", date: "2027-02-10", status: "asleep" } })).statusCode).toBe(400);

    let d = await r.dashboard();
    const art = d.courses[0]!;
    expect(art.grade).toMatchObject({ basis: "points", letter: "A" });
    expect(art.grade.percent).toBeCloseTo(95);
    expect(d.gpa).toMatchObject({ gpa: 4, credits: 2 });
    expect(art.attendance?.percent).toBeCloseTo((2 / 3) * 100);
    expect(d.assignments.map((a) => [a.title, a.done, a.manual, a.score])).toEqual([
      ["Sketchbook 1", true, true, 19],
      ["Critique", true, true, undefined],
    ]);

    await r.app.inject({ method: "DELETE", url: `/api/grades/${enc(a1.id)}` });
    await r.app.inject({ method: "DELETE", url: `/api/assignments/${enc(a2.id)}` });
    await r.app.inject({ method: "DELETE", url: "/api/attendance?courseId=manual%3Aart110&date=2027-02-05" });
    d = await r.dashboard();
    expect(d.assignments.map((a) => a.title)).toEqual(["Sketchbook 1"]);
    expect(d.courses[0]!.grade.basis).toBe("none");
    expect(d.courses[0]!.attendance?.percent).toBe(100);

    // Per-course letter scale and class times; bad values are refused.
    const patch = (payload: object) => r.app.inject({ method: "PATCH", url: "/api/courses/manual%3Aart110", payload });
    expect((await patch({ meetings: [{ weekday: 9, start: "10:00", end: "11:00" }] })).statusCode).toBe(400);
    expect((await patch({ meetings: [{ weekday: 2, start: "11:00", end: "10:00" }] })).statusCode).toBe(400);
    expect((await patch({ letterCutoffs: [{ letter: "A", min: 900 }, { letter: "F", min: 0 }] })).statusCode).toBe(400);
    expect((await patch({ gradeSource: "vibes" })).statusCode).toBe(400);
    expect((await patch({ meetings: [{ weekday: 2, start: "10:00", end: "11:15", location: "Sage 12" }], letterCutoffs: [{ letter: "P", min: 60 }, { letter: "F", min: 0 }] })).statusCode).toBe(200);
    expect((await r.dashboard()).courses[0]).toMatchObject({ cutoffsFrom: "manual", meetings: [{ weekday: 2, start: "10:00", end: "11:15", location: "Sage 12" }] });
  });
});

describe("writing to a professor", () => {
  it("without Gmail set up, hands back a filled-in compose link; checks the address either way", async () => {
    r = rig();
    const send = (payload: object) => r.app.inject({ method: "POST", url: "/api/messages/send", payload });
    expect((await send({ to: ["nope"], subject: "Hi", body: "x" })).statusCode).toBe(400);
    expect((await send({ to: ["ada.lin@example.edu"], subject: "", body: "x" })).statusCode).toBe(400);
    const out = (await send({ to: ["ada.lin@example.edu"], subject: "Extension request", body: "Hello Professor Lin," })).json() as { sent: boolean; composeUrl: string };
    expect(out.sent).toBe(false);
    expect(out.composeUrl).toBe("https://mail.google.com/mail/?view=cm&fs=1&to=ada.lin%40example.edu&su=Extension+request&body=Hello+Professor+Lin%2C");
    expect((await r.app.inject({ method: "POST", url: "/api/link/gmail", payload: {} })).statusCode).toBe(400);
    expect((await r.app.inject({ method: "POST", url: "/api/ai/summarize", payload: { text: "long announcement" } })).json()).toEqual({ error: "AI is off. Set AI_PROVIDER in .env to turn it on." });
  });

  it("with Gmail connected, signs in through Google and sends from your account", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const google: FetchLike = async (input, init) => {
      const u = new URL(String(input));
      calls.push({ url: u.host + u.pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if (u.host === "oauth2.googleapis.com") return Response.json({ access_token: "at", refresh_token: "rt" });
      if (u.pathname.endsWith("/messages/send")) return Response.json({ id: "sent" });
      if (u.pathname.endsWith("/messages")) return Response.json({ messages: [] });
      return new Response("{}", { status: 404 });
    };
    r = rig({ fetch: google, env: { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" } });
    const { openUrl } = (await r.app.inject({ method: "POST", url: "/api/link/gmail", payload: {} })).json() as { openUrl: string };
    const state = new URL(openUrl).searchParams.get("state")!;
    expect((await r.app.inject({ url: "/auth/google/callback?code=abc&state=wrong" })).statusCode).toBe(400);
    const back = await r.app.inject({ url: `/auth/google/callback?code=abc&state=${state}` });
    expect(back.statusCode).toBe(200);
    expect(back.body).toContain("Gmail connected");
    expect(back.body).not.toContain("abc");
    // The one-time state can't be replayed.
    expect((await r.app.inject({ url: `/auth/google/callback?code=abc&state=${state}` })).statusCode).toBe(400);
    expect((await r.dashboard()).links.gmail).toEqual({ connected: true, configured: true });

    const out = (await r.app.inject({ method: "POST", url: "/api/messages/send", payload: { to: ["ada.lin@example.edu"], subject: "Question", body: "Hi" } })).json();
    expect(out).toEqual({ sent: true });
    const sent = calls.find((c) => c.url.endsWith("/messages/send"))!;
    expect(Buffer.from((JSON.parse(sent.body!) as { raw: string }).raw, "base64url").toString()).toMatch(/^To: ada\.lin@example\.edu\r\n/);

    await r.app.inject({ method: "DELETE", url: "/api/link/gmail" });
    expect((await r.dashboard()).links.gmail.connected).toBe(false);
  });
});

describe("dashboard shape", () => {
  it("starts empty and well-formed", async () => {
    r = rig();
    const d = (await r.dashboard()) as DashboardData;
    expect(d).toMatchObject({ hasData: false, courses: [], assignments: [], notices: [], syncing: false, ai: { provider: "none" }, notifications: true });
    expect(d.workload).toHaveLength(14);
    expect(d.links.blackboard).toMatchObject({ linked: false, expired: false });
  });
});

describe("term", () => {
  it("uses the configured term while it is current, otherwise works it out from the date", async () => {
    const { resolveTerm } = await import("../src/config.js");
    const spring = { name: "Spring 2027", start: "2027-01-19", end: "2027-05-14" };
    expect(resolveTerm(spring, new Date("2027-03-01T12:00:00Z"))).toBe(spring);
    expect(resolveTerm(spring, new Date("2026-11-13T12:00:00Z"))).toEqual({ name: "Fall 2026", start: "2026-08-20", end: "2026-12-22" });
    expect(resolveTerm(undefined, new Date("2027-06-15T12:00:00Z")).name).toBe("Summer 2027");
    expect(resolveTerm(undefined, new Date("2027-02-15T12:00:00Z")).name).toBe("Spring 2027");
  });
});
