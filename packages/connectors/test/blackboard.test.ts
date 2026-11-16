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

describe("guessKind", () => {
  it("calls a final draft writing, not an exam", async () => {
    const { guessKind } = await import("../src/kinds.js");
    expect(guessKind("FA #1 Final Draft + Reflection")).toBe("paper");
    expect(guessKind("Final paper")).toBe("paper");
    expect(guessKind("Final Exam")).toBe("exam");
    expect(guessKind("Midterm 1")).toBe("exam");
    expect(guessKind("Lab report 4")).toBe("lab");
    expect(guessKind("Final project")).toBe("project");
    expect(guessKind("Webwork 3")).toBe("homework");
  });
});

describe("Blackboard session sync", () => {
  it("pulls courses, gradebook, totals, announcements, files (also ones embedded in Ultra documents); reports what the school hides", async () => {
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

    expect(r.announcements).toHaveLength(1);
    expect(r.announcements![0]!.body).toBe("Midterm 2 is now Thursday & covers ch. 5–7.\nReview sheet (https://example.edu/review)");

    // The syllabus sits where Ultra courses keep it: a file embedded in a document under "Course Overview → Syllabus".
    expect(r.files!.map((f) => [f.name, f.isSyllabus, f.folder.join("/")])).toEqual([
      ["CHEM101_Syllabus.pdf", true, "Course Overview - Start Here/Syllabus"],
      ["week1.pptx", false, "Week 1"],
      ["Lab 1 handout.pdf", false, "Week 1"],
      ["Syllabus.txt", true, ""],
      ["Course Schedule.txt", true, ""],
    ]);
    expect(r.files![0]).toMatchObject({ mimeType: "application/pdf", url: "/learn/api/public/v1/courses/_101_1/contents/_f2_1#xid-1_1" });
    expect(r.extras).toEqual({ gradescopeLaunch: [], studentName: "Test" });
    expect(r.notes!.join("\n")).toMatch(/announcements: not shared with students \(CSC 172\)/);
    expect(r.authoritative!.assignments).toEqual(["bb:_101_1:", "bb:_172_1:"]);

    // Only GETs, only the linked host; newest session cookie saved.
    expect(bb.state.log.every((l) => l.startsWith("GET /learn/api/public/"))).toBe(true);
    expect(ctx.secrets.data.get(SESSION_COOKIES)).toMatch(/ok-\d+/);
    expect(ctx.secrets.data.get(SESSION_COOKIES)).not.toContain('"ok-0"');

    // All three kinds of "file" download: embedded in a document, a plain file item, and a typed page.
    const pdf = await blackboardSession.download!(ctx, r.files![0]!);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe("%PDF-");
    expect(pdf.filename).toBe("CHEM101_Syllabus.pdf");
    const handout = await blackboardSession.download!(ctx, r.files![2]!);
    expect(new TextDecoder().decode(handout.bytes)).toMatch(/pretend handout/);
    const page = await blackboardSession.download!(ctx, r.files![3]!);
    expect(new TextDecoder().decode(page.bytes)).toMatch(/Projects: 40%/);
    expect(bb.state.log.every((l) => l.startsWith("GET /"))).toBe(true);
  });

  it("finds the way into Gradescope: the linked item's exact Gradescope number and a launch address", async () => {
    const bb = fakeBlackboard({ now: NOW, gradescope: true });
    const r = await blackboardSession.sync(context(bb));
    const p1 = r.assignments!.find((a) => a.title === "Project 1")!;
    expect(p1).toMatchObject({ externalRefs: ["gradescope:5001"], contentId: "_g2_1" });
    expect(p1.url).toBe("https://learn.fake-school.test/ultra/redirect?redirectType=nautilus&courseId=_172_1&contentId=_g2_1");
    expect(r.assignments!.find((a) => a.title === "Quiz 1")!.externalRefs).toBeUndefined();
    expect(r.extras!.gradescopeLaunch).toEqual(["/webapps/blackboard/execute/blti/launchLink?course_id=_172_1&content_id=_g2_1"]);
  });

  it("attaches to a course you added by hand, skips hidden ones, and a light pass skips the slow extras", async () => {
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
    // Files come along on every pass now (one request per course), so a new syllabus or reading shows up fast.
    expect(r.files!.map((f) => f.courseId)).toEqual(["manual:chem101", "manual:chem101", "manual:chem101"]);
    expect(r.authoritative!.files).toEqual(["bbfile:_101_1:"]);
    expect(bb.state.log.some((l) => l.includes("_172_1/"))).toBe(false);
    expect(bb.state.log.some((l) => /\/users\?|schemas/.test(l))).toBe(false);
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

  it("keeps each course's content as Blackboard lays it out: folders, pages, files, links and tools", async () => {
    const bb = fakeBlackboard({ now: NOW, gradescope: true });
    const r = await blackboardSession.sync(context(bb));
    const chem = r.contents!.find((c) => c.courseId === r.courses!.find((x) => x.code === "CHEM 101")!.id)!.items;
    const row = (id: string) => chem.find((x) => x.id === id);
    // Blackboard's order and nesting.
    expect(chem.map((x) => [x.title, x.kind, x.parentId ?? "top"])).toEqual([
      ["Course Overview - Start Here", "folder", "top"],
      ["Syllabus", "page", "_f1_1"],
      ["Week 1", "folder", "top"],
      ["Week 1 slides", "file", "_f5_1"],
      ["Lab 1 handout", "file", "_f5_1"],
      ["Textbook site", "link", "_f5_1"],
      ["Qwickly Attendance", "tool", "top"],
    ]);
    // An Ultra page's hidden body is folded into the page: its text, and where its files live.
    expect(row("_f4_1")).toMatchObject({ kind: "page", bodyIds: ["_f2_1"] });
    expect(row("_f4_1")!.text).toContain("The syllabus for this term");
    expect(row("_f9_1")!.href).toBe("https://textbook.example/chem");
    expect(row("_f8_1")).toMatchObject({ tool: "Qwickly" });
    expect(row("_f8_1")!.url).toContain("/ultra/redirect?");
    // Hidden items stay hidden.
    expect(row("_f7_1")).toBeUndefined();
    const csc = r.contents!.find((c) => c.courseId === r.courses!.find((x) => x.code === "CSC 172")!.id)!.items;
    expect(csc.find((x) => x.id === "_g2_1")).toMatchObject({ kind: "tool", tool: "Gradescope" });
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
