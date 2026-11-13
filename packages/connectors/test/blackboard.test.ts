import { describe, expect, it } from "vitest";
import type { Course } from "@sd/core";
import {
  AuthExpiredError,
  BlackboardClient,
  CookieJar,
  blackboardSession,
  displayCode,
  isCurrent,
  mapLetterScale,
  normalizeBaseUrl,
  SESSION_COOKIES,
  sessionWorks,
  type ConnectorContext,
  type SecretStore,
} from "../src/index.js";
import { fakeBlackboard } from "./fake-blackboard.js";

const NOW = new Date("2027-03-01T15:00:00Z");

function memory(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

function context(bb: ReturnType<typeof fakeBlackboard>, known: Course[] = [], deep = true): ConnectorContext & { secrets: ReturnType<typeof memory> } {
  const secrets = memory();
  secrets.data.set(SESSION_COOKIES, new CookieJar([bb.sessionCookie]).serialize());
  return {
    env: { BLACKBOARD_BASE_URL: bb.base, BLACKBOARD_REQUEST_GAP_MS: "0" },
    secrets,
    knownCourses: known,
    now: NOW,
    fetch: bb.fetch,
    timezone: "America/New_York",
    termName: "Spring 2027",
    deep,
  };
}

describe("CookieJar", () => {
  const url = new URL("https://learn.school.edu/learn/api/public/v1/users/me");
  it("sends only matching, unexpired cookies and follows Set-Cookie", () => {
    const jar = new CookieJar([
      { name: "BbRouter", value: "a", domain: "learn.school.edu", path: "/", secure: true, hostOnly: true },
      { name: "sso", value: "b", domain: "school.edu", path: "/", secure: true, hostOnly: false },
      { name: "other", value: "c", domain: "evil.example", path: "/", secure: false, hostOnly: true },
      { name: "deep", value: "d", domain: "learn.school.edu", path: "/webapps", secure: false, hostOnly: true },
      { name: "old", value: "e", domain: "learn.school.edu", path: "/", secure: false, hostOnly: true, expires: 1 },
    ]);
    expect(jar.header(url)).toBe("BbRouter=a; sso=b");
    expect(jar.header(new URL("http://learn.school.edu/"))).toBe("");
    expect(jar.header(new URL("https://notlearn.school.edu.evil.example/"))).toBe("other=c".slice(0, 0));

    jar.store(url, ["BbRouter=new; Path=/; Secure; HttpOnly", "gone=1; Max-Age=0", "x=1; Domain=evil.example"]);
    expect(jar.dirty).toBe(true);
    expect(jar.header(url)).toContain("BbRouter=new");
    // A server can't plant a cookie for someone else's domain: it stays host-only.
    expect(jar.header(new URL("https://evil.example/"))).toBe("other=c");
    expect(CookieJar.parse(jar.serialize()).header(url)).toBe(jar.header(url));
    expect(CookieJar.parse("not json").size).toBe(0);
  });
});

describe("BlackboardClient", () => {
  it("treats a bounce to the sign-in page as an expired session, and never leaves the host", async () => {
    const bb = fakeBlackboard();
    const jar = new CookieJar([bb.sessionCookie]);
    const client = new BlackboardClient({ baseUrl: bb.base, fetch: bb.fetch, jar, minIntervalMs: 0 });
    expect((await client.json<{ id: string }>("/learn/api/public/v1/users/me")).id).toBe("_77_1");
    expect(jar.dirty).toBe(true); // sliding session cookie was saved

    bb.state.sessionValid = false;
    await expect(client.json("/learn/api/public/v1/users/me")).rejects.toBeInstanceOf(AuthExpiredError);
    await expect(client.json("https://evil.example/learn/api/public/v1/users/me")).rejects.toThrow(/outside/);

    const sso: typeof bb.fetch = async () => new Response(null, { status: 302, headers: { location: "https://sso.school.edu/login" } });
    const c2 = new BlackboardClient({ baseUrl: bb.base, fetch: sso, jar, minIntervalMs: 0 });
    await expect(c2.json("/learn/api/public/v1/users/me")).rejects.toBeInstanceOf(AuthExpiredError);
    const html: typeof bb.fetch = async () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(new BlackboardClient({ baseUrl: bb.base, fetch: html, jar, minIntervalMs: 0 }).json("/x")).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it("does not send the session cookie to another host on a download redirect", async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    const f: typeof fetch = async (input, init) => {
      const u = new URL(String(input));
      seen.push({ url: u.href, cookie: new Headers(init?.headers).get("cookie") });
      if (u.hostname === "learn.fake-school.test") return new Response(null, { status: 302, headers: { location: "https://cdn.example/file.pdf?sig=1" } });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/pdf" } });
    };
    const bb = fakeBlackboard();
    const client = new BlackboardClient({ baseUrl: bb.base, fetch: f, jar: new CookieJar([bb.sessionCookie]), minIntervalMs: 0 });
    const got = await client.download("/learn/api/public/v1/courses/x/contents/y/attachments/z/download", 1000);
    expect(got.bytes).toHaveLength(3);
    expect(seen[0]!.cookie).toContain("BbRouter=");
    expect(seen[1]).toEqual({ url: "https://cdn.example/file.pdf?sig=1", cookie: null });
    await expect(client.download("/learn/api/public/v1/courses/x/contents/y/attachments/z/download", 2)).rejects.toThrow(/larger/);
  });
});

describe("mapping helpers", () => {
  it("finds the course code in the ways schools write it", () => {
    expect(displayCode({ id: "1", courseId: "CSC172.2026FALL.80123" })).toBe("CSC 172");
    expect(displayCode({ id: "1", courseId: "2027SP-CHEM-101-01" })).toBe("CHEM 101");
    expect(displayCode({ id: "1", courseId: "FALL2026-80123", name: "Calculus IA (MTH 141)" })).toBe("MTH 141");
    expect(displayCode({ id: "1", courseId: "ORIENTATION" })).toBe("ORIENTATION");
  });
  it("keeps current classes, drops old ones and club pages", () => {
    const m = (extra: object, course: object = {}) => ({ courseId: "x", course: { id: "x", ...course }, ...extra });
    const term = { id: "t", availability: { duration: { start: "2027-01-19T00:00:00Z", end: "2027-05-14T00:00:00Z" } } };
    expect(isCurrent(m({}), term, NOW)).toBe(true);
    expect(isCurrent(m({}), { id: "t", availability: { duration: { start: "2026-08-25T00:00:00Z", end: "2026-12-18T00:00:00Z" } } }, NOW)).toBe(false);
    expect(isCurrent(m({ lastAccessed: "2026-02-01T00:00:00Z" }), undefined, NOW)).toBe(false);
    expect(isCurrent(m({ lastAccessed: "2027-02-20T00:00:00Z" }), undefined, NOW)).toBe(true);
    expect(isCurrent(m({}, { organization: true }), term, NOW)).toBe(false);
    expect(isCurrent(m({}, { availability: { available: "No" } }), term, NOW)).toBe(false);
  });
  it("reads a letter schema and validates the Blackboard address", () => {
    expect(mapLetterScale([{ id: "1", title: "Score" }, { id: "2", title: "Letter", symbols: [{ text: "A", lowerBound: 94 }, { text: "B", lowerBound: 84 }, { text: "F", lowerBound: 0 }] }])).toEqual([
      { letter: "A", min: 94 },
      { letter: "B", min: 84 },
      { letter: "F", min: 0 },
    ]);
    expect(normalizeBaseUrl("learn.school.edu/ultra/stream")).toBe("https://learn.school.edu");
    expect(normalizeBaseUrl("http://learn.school.edu")).toBeUndefined();
    expect(normalizeBaseUrl("https://user:pw@learn.school.edu")).toBeUndefined();
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeBaseUrl("http://127.0.0.1:5999")).toBe("http://127.0.0.1:5999");
    expect(normalizeBaseUrl("127.0.0.1:5999")).toBe("http://127.0.0.1:5999");
    expect(normalizeBaseUrl("ftp://learn.school.edu")).toBeUndefined();
  });
});

describe("Blackboard session sync", () => {
  it("pulls courses, gradebook, totals, attendance, announcements, files; reports what the school hides", async () => {
    const bb = fakeBlackboard({ now: NOW });
    const ctx = context(bb);
    expect((await blackboardSession.status(ctx)).state).toBe("ready");
    expect(await sessionWorks(bb.base, CookieJar.parse(ctx.secrets.data.get(SESSION_COOKIES)), bb.fetch)).toBe(true);

    const r = await blackboardSession.sync(ctx);
    expect(r.courses!.map((c) => [c.id, c.code, c.name, c.term])).toEqual([
      ["bb:_101_1", "CHEM 101", "General Chemistry I", "Spring 2027"],
      ["bb:_172_1", "CSC 172", "Data Structures & Algorithms", "Spring 2027"],
    ]);
    expect(new Set(r.courses!.map((c) => c.color)).size).toBe(2);
    const chem = r.courses![0]!;
    expect(chem.instructors).toEqual([{ name: "Ada Lin", email: "ada.lin@example.edu", role: "instructor" }]);
    expect(chem.letterCutoffs?.[0]).toEqual({ letter: "A", min: 94 });

    const byTitle = new Map(r.assignments!.map((a) => [a.title, a]));
    expect(byTitle.get("Homework 1")).toMatchObject({ status: "graded", category: "Homework", pointsPossible: 10, kind: "homework" });
    expect(byTitle.get("Homework 2")).toMatchObject({ status: "upcoming" });
    expect(byTitle.get("Lab 1")).toMatchObject({ status: "submitted", kind: "lab" });
    expect(byTitle.get("Homework 0 (old)")).toMatchObject({ status: "missing" });
    expect(byTitle.get("Start-of-term survey")).toMatchObject({ countsTowardGrade: false });
    expect(byTitle.has("Weighted Total")).toBe(false);
    expect(byTitle.has("Hidden column")).toBe(false);

    expect(r.grades!.find((g) => g.assignmentId === "bb:_101_1:_c3_1")).toMatchObject({ score: 84, pointsPossible: 100 });
    expect(r.overall!.filter((o) => o.courseId === "bb:_101_1").map((o) => [o.kind, Math.round(o.percent! * 10) / 10])).toEqual([
      ["weighted-total", 88.2],
      ["total", 85.9],
    ]);
    expect(r.attendanceSummaries).toEqual([expect.objectContaining({ courseId: "bb:_101_1", percent: 90, source: expect.objectContaining({ source: "qwickly" }) })]);

    expect(r.announcements).toHaveLength(1);
    expect(r.announcements![0]!.body).toBe("Midterm 2 is now Thursday & covers ch. 5–7.\nReview sheet (https://example.edu/review)");

    expect(r.files!.map((f) => [f.name, f.isSyllabus, f.folder.join("/")])).toEqual([
      ["CHEM101_Syllabus.pdf", true, "Course Information"],
      ["week1.pptx", false, "Course Information"],
      ["Syllabus.txt", true, ""],
    ]);
    expect(r.notes!.join("\n")).toMatch(/attendance: not shared with students \(2 courses\)/);
    expect(r.notes!.join("\n")).toMatch(/announcements: not shared with students \(CSC 172\)/);
    expect(r.authoritative!.assignments).toEqual(["bb:_101_1:", "bb:_172_1:"]);

    // Only GETs, only the linked host; newest session cookie saved.
    expect(bb.state.log.every((l) => l.startsWith("GET /learn/api/public/"))).toBe(true);
    expect(ctx.secrets.data.get(SESSION_COOKIES)).toMatch(/ok-\d+/);
    expect(ctx.secrets.data.get(SESSION_COOKIES)).not.toContain('"ok-0"');

    const pdf = await blackboardSession.download!(ctx, r.files![0]!);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe("%PDF-");
    const page = await blackboardSession.download!(ctx, r.files![2]!);
    expect(new TextDecoder().decode(page.bytes)).toMatch(/Projects: 40%/);
  });

  it("attaches to a course you added by hand, skips hidden ones, and a light pass skips files", async () => {
    const bb = fakeBlackboard({ now: NOW });
    const mine: Course = {
      id: "manual:chem101", code: "chem-101", name: "My chem", term: "S27", credits: 4, level: "regular", color: "c6",
      instructors: [], meetings: [], sources: [{ source: "manual", fetchedAt: "x" }],
    };
    const hidden: Course = { ...mine, id: "bb:_172_1", code: "CSC 172", hidden: true, color: "c2", sources: [{ source: "blackboard-session", externalId: "_172_1", fetchedAt: "x" }] };
    const r = await blackboardSession.sync(context(bb, [mine, hidden], false));
    expect(r.courses!.map((c) => c.id)).toEqual(["manual:chem101"]);
    expect(r.courses![0]).toMatchObject({ credits: 4, color: "c6" });
    expect(r.assignments!.every((a) => a.courseId === "manual:chem101")).toBe(true);
    expect(r.files).toEqual([]);
    expect(r.authoritative!.files).toEqual([]);
    expect(bb.state.log.some((l) => l.includes("_172_1/gradebook"))).toBe(false);
    expect(bb.state.log.some((l) => l.includes("/contents"))).toBe(false);
  });

  it("does not mistake a 401 on one hidden feature for a lost sign-in", async () => {
    const bb = fakeBlackboard({ now: NOW });
    bb.state.unauthorized.add("announcements");
    const r = await blackboardSession.sync(context(bb));
    expect(r.courses).toHaveLength(2);
    expect(r.grades!.length).toBeGreaterThan(3);
    expect(r.announcements).toEqual([]);
    expect(r.notes!.join("\n")).toMatch(/announcements: not shared with students \(2 courses\)/);
  });

  it("raises AuthExpiredError when the session is gone", async () => {
    const bb = fakeBlackboard({ now: NOW });
    bb.state.sessionValid = false;
    await expect(blackboardSession.sync(context(bb))).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe("when the school's term data is no help", () => {
  it("falls back to the most recently opened classes and says so", async () => {
    const bb = fakeBlackboard({ now: NOW });
    // Pretend it's two years later: every term has ended, nothing looks current.
    const later = new Date(NOW.getTime() + 2 * 365 * 86_400_000);
    const ctx = { ...context(bb), now: later };
    const r = await blackboardSession.sync(ctx);
    expect(r.courses!.map((c) => c.code).sort()).toEqual(["CHEM 101", "CSC 172", "HIS 140"]);
    expect(r.notes!.join("\n")).toMatch(/most recently opened/);
  });
});
