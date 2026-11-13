import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecretStore } from "@sd/connectors";
import type { DashboardData, SettingsInfo, SyllabusRecord, UnmatchedItem } from "@sd/core";
import { buildApp } from "../src/app.js";
import type { SchoolConfig } from "../src/config.js";
import { openDb } from "../src/db/client.js";

const cfg = JSON.parse(readFileSync(new URL("../../../config/school.example.json", import.meta.url), "utf8")) as SchoolConfig;

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k);
    },
    async set(k, v) {
      data.set(k, v);
    },
    async delete(k) {
      data.delete(k);
    },
  };
}

const SYLLABUS = `CHEM 101 — General Chemistry I        Spring 2027
Instructor: Dr. Ada Lin   ada.lin@example.edu
Office hours: Tue/Thu 2:00–3:30 pm, Science 214

  Homework ............ 15%
  Labs                  20%
  Quizzes: 10%
  Midterm Exams (2)     25 %
  Final Exam - 30 percent

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

let app: ReturnType<typeof buildApp>;
let secrets: ReturnType<typeof memorySecrets>;

beforeEach(() => {
  secrets = memorySecrets();
  app = buildApp({ db: openDb(":memory:"), cfg, secrets, env: {} });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

describe("database", () => {
  it("runs each migration once and reopens an existing file cleanly", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "sd-"));
    try {
      const a = openDb(dir);
      a.prepare("INSERT INTO settings (key, value) VALUES ('k', 'v')").run();
      a.close();
      const b = openDb(dir);
      expect(b.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
      expect(b.prepare("SELECT value FROM settings WHERE key = 'k'").get()?.value).toBe("v");
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("settings", () => {
  it("stores the calendar link as a secret and only ever returns its host", async () => {
    const bad = await app.inject({ method: "PUT", url: "/api/settings/calendar-link", payload: { url: "not a link" } });
    expect(bad.statusCode).toBe(400);

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/calendar-link",
      payload: { url: "webcal://school.blackboard.com/webapps/calendar/calendarFeed/abc123/learn.ics" },
    });
    const info = res.json() as SettingsInfo;
    expect(info.calendarLink).toEqual({ set: true, host: "school.blackboard.com", fromEnv: false });
    expect(res.body).not.toContain("abc123");
    expect(secrets.data.get("blackboard.ical_url")).toMatch(/^https:\/\/school\.blackboard\.com\//);

    const cleared = (await app.inject({ method: "DELETE", url: "/api/settings/calendar-link" })).json() as SettingsInfo;
    expect(cleared.calendarLink.set).toBe(false);
  });

  it("won't turn on a session reader without acknowledging the warning", async () => {
    const no = await app.inject({ method: "PUT", url: "/api/settings/toggles", payload: { key: "blackboardSessionReader", enabled: true } });
    expect(no.statusCode).toBe(400);
    const yes = await app.inject({
      method: "PUT",
      url: "/api/settings/toggles",
      payload: { key: "blackboardSessionReader", enabled: true, acknowledged: true },
    });
    expect((yes.json() as SettingsInfo).toggles.blackboardSessionReader).toBe(true);
    const conns = (await app.inject({ url: "/api/connectors" })).json() as { id: string; status: { state: string } }[];
    expect(conns.find((c) => c.id === "blackboard-session")?.status.state).toBe("needs-sign-in");
  });

  it("rejects requests from other web pages", async () => {
    const res = await app.inject({ url: "/api/settings", headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
    const rebound = await app.inject({ url: "/api/settings", headers: { host: "evil.example:5179" } });
    expect(rebound.statusCode).toBe(403);
    const local = await app.inject({ url: "/api/settings", headers: { host: "127.0.0.1:5179", origin: "http://127.0.0.1:5173" } });
    expect(local.statusCode).toBe(200);
  });
});

describe("calendar sync + course matching", () => {
  it("syncs the feed, matches by code, and lets you fix the rest with an alias", async () => {
    await app.inject({ method: "PUT", url: "/api/settings/calendar-link", payload: { url: "https://school.example/feed.ics" } });
    const fetchMock = vi.fn(async () => new Response(ICS, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await app.inject({ method: "POST", url: "/api/courses", payload: { code: "MATH 221", name: "Calculus II", credits: 4 } });
    const dup = await app.inject({ method: "POST", url: "/api/courses", payload: { code: "math-221", name: "Again" } });
    expect(dup.statusCode).toBe(409);
    const hist = (
      await app.inject({ method: "POST", url: "/api/courses", payload: { code: "HIST 140", name: "Modern Europe", color: "c1" } })
    ).json() as { course: { id: string } };

    const report = (await app.inject({ method: "POST", url: "/api/sync" })).json() as { connector: string; ok: boolean }[];
    expect(report.find((r) => r.connector === "blackboard-ical")?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://school.example/feed.ics");

    // "HIS140" isn't "HIST 140" by code, but the full name "Modern Europe" matches.
    let dash = (await app.inject({ url: "/api/dashboard" })).json() as DashboardData;
    expect(dash.hasData).toBe(true);
    expect(dash.unmatchedCount).toBe(0);
    expect(dash.assignments.map((a) => a.courseId).sort()).toEqual(["manual:hist140", "manual:math221"]);

    // Rename the course so the name no longer matches; on re-sync the item stays where it was.
    await app.inject({ method: "PATCH", url: `/api/courses/${hist.course.id}`, payload: { name: "Europe since 1789" } });
    await app.inject({ method: "POST", url: "/api/sync" });
    dash = (await app.inject({ url: "/api/dashboard" })).json() as DashboardData;
    expect(dash.unmatchedCount).toBe(0);

    // Delete it: the item goes to Unmatched; recreate + alias puts it back.
    await app.inject({ method: "DELETE", url: `/api/courses/${hist.course.id}` });
    const unmatched = (await app.inject({ url: "/api/unmatched" })).json() as UnmatchedItem[];
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.suggestedPattern).toBe("HIS140");
    const again = (await app.inject({ method: "POST", url: "/api/courses", payload: { code: "HIST 140", name: "Europe since 1789" } })).json() as {
      course: { id: string };
      matched: number;
    };
    expect(again.matched).toBe(0);
    const alias = (await app.inject({ method: "POST", url: "/api/aliases", payload: { pattern: "HIS140", courseId: again.course.id } })).json();
    expect(alias).toEqual({ matched: 1 });

    const ics = await app.inject({ url: "/calendar.ics" });
    expect(ics.headers["content-type"]).toMatch(/text\/calendar/);
    expect(ics.body).toContain("SUMMARY:MATH 221 Problem set 8 - MATH-221-001");
  });
});

describe("syllabus upload + review", () => {
  it("parses, suggests a course, and applies only what you confirm", async () => {
    const wrongType = await app.inject({
      method: "POST",
      url: "/api/syllabus?name=notes.exe",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("x"),
    });
    expect(wrongType.statusCode).toBe(400);

    const up = await app.inject({
      method: "POST",
      url: "/api/syllabus?name=chem101.txt",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(SYLLABUS),
    });
    expect(up.statusCode).toBe(200);
    const rec = up.json() as SyllabusRecord;
    expect(rec.confirmed).toBe(false);
    expect(rec.suggestedCourseId).toBeUndefined();
    expect(rec.parse.course).toEqual({ code: "CHEM 101", title: "General Chemistry I" });
    expect(rec.parse.weights.total).toBe(100);
    expect(JSON.stringify(rec)).not.toContain("Office hours: Tue/Thu 2:00–3:30 pm, Science 214\n");

    // Nothing applied yet.
    let dash = (await app.inject({ url: "/api/dashboard" })).json() as DashboardData;
    expect(dash.hasData).toBe(false);

    const badTotal = await app.inject({
      method: "POST",
      url: `/api/syllabus/${rec.id}/confirm`,
      payload: { newCourse: { code: "CHEM 101", name: "General Chemistry I" }, weights: [{ name: "Homework", weight: 50 }], items: [], instructorEmails: [] },
    });
    expect(badTotal.json()).toEqual({ error: "Weights add up to 50%, not 100%." });

    const body = {
      newCourse: { code: "CHEM 101", name: "General Chemistry I", credits: 4, level: "regular", color: "c4" },
      weights: rec.parse.weights.weights.map((w) => ({ name: w.name, weight: w.weight })),
      // You unticked the quiz in the review screen and moved the midterm time.
      items: rec.parse.dates.filter((d) => d.kind !== "quiz").map((d) => ({ date: d.date, title: d.title, kind: d.kind, time: d.kind === "exam" ? "09:30" : undefined })),
      instructorEmails: rec.parse.policies.instructorEmails,
      officeHours: rec.parse.policies.officeHours,
      latePolicy: rec.parse.policies.latePolicy,
    };
    const ok = await app.inject({ method: "POST", url: `/api/syllabus/${rec.id}/confirm`, payload: body });
    expect(ok.json()).toEqual({ courseId: "manual:chem101", items: 2, categories: 5 });
    // Confirming again replaces, not duplicates.
    await app.inject({ method: "POST", url: `/api/syllabus/${rec.id}/confirm`, payload: { ...body, newCourse: undefined, courseId: "manual:chem101" } });

    dash = (await app.inject({ url: "/api/dashboard", query: {} })).json() as DashboardData;
    const chem = dash.courses.find((c) => c.id === "manual:chem101")!;
    expect(chem.hasScheme).toBe(true);
    expect(chem.instructors[0]?.email).toBe("ada.lin@example.edu");
    expect(chem.policies?.latePolicy).toMatch(/no work accepted/);
    const all = (await app.inject({ url: "/api/syllabi" })).json() as SyllabusRecord[];
    expect(all[0]).toMatchObject({ confirmed: true, courseId: "manual:chem101" });
    // Reopening for edits starts from what you saved, not the raw parse.
    const reopened = (await app.inject({ url: `/api/syllabus/${rec.id}` })).json() as SyllabusRecord;
    expect(reopened.applied?.items.map((i) => i.kind)).toEqual(["exam", "lab"]);
    expect(reopened.applied?.courseId).toBe("manual:chem101");
    expect(reopened.suggestedCourseId).toBe("manual:chem101");

    const items = (await app.inject({ url: "/calendar.ics" })).body;
    expect(items.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    // Midterm Feb 25 at 09:30 New York time = 14:30 UTC; lab report at 23:59 → next day 03:59 UTC (after DST).
    expect(items).toContain("DTSTART:20270225T143000Z");
    expect(items).toContain("DTSTART:20270319T035900Z");

    // Deleting the syllabus removes what it added.
    await app.inject({ method: "DELETE", url: `/api/syllabus/${rec.id}` });
    expect((await app.inject({ url: "/calendar.ics" })).body).not.toContain("BEGIN:VEVENT");
    dash = (await app.inject({ url: "/api/dashboard" })).json() as DashboardData;
    expect(dash.courses[0]?.hasScheme).toBe(false);
  });
});
