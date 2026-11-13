import { describe, expect, it } from "vitest";
import type { Course } from "@sd/core";
import {
  AuthExpiredError,
  CookieJar,
  GMAIL_TOKEN,
  GRADESCOPE_COOKIES,
  REST_TOKENS,
  blackboardRest,
  buildMime,
  composeLink,
  gmail,
  gmailAuthUrl,
  gradescope,
  parseAddress,
  parseGsAssignments,
  parseGsCourses,
  restAuthUrl,
  restExchangeCode,
  type ConnectorContext,
  type FetchLike,
  type SecretStore,
} from "../src/index.js";
import { fakeBlackboard } from "./fake-blackboard.js";

const NOW = new Date("2027-03-01T15:00:00Z");
const course = (id: string, code: string, name: string, email?: string): Course => ({
  id, code, name, term: "S27", credits: 3, level: "regular", color: "c1",
  instructors: email ? [{ name: "Prof", email, role: "instructor" }] : [], meetings: [], sources: [],
});

function ctx(fetchImpl: FetchLike, env: NodeJS.ProcessEnv = {}, known: Course[] = []): ConnectorContext & { secrets: SecretStore & { data: Map<string, string> } } {
  const data = new Map<string, string>();
  return {
    env, knownCourses: known, now: NOW, fetch: fetchImpl, timezone: "America/New_York", termName: "Spring 2027", deep: true,
    secrets: { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) },
  };
}

const GS_ACCOUNT = `
<h1>Your Courses</h1>
<div class="courseList"><div class="courseList--term">Spring 2027</div>
<div class="courseList--coursesForTerm">
  <a class="courseBox" href="/courses/9001"><h3 class="courseBox--shortname">CSC 172</h3><div class="courseBox--name">Data Structures &amp; Algorithms</div><div class="courseBox--assignments">3 assignments</div></a>
  <a class="courseBox" href="/courses/9002"><h3 class="courseBox--shortname">ART 110</h3><div class="courseBox--name">Drawing</div></a>
</div>
<div class="courseList--term">Fall 2026</div>
<div class="courseList--coursesForTerm"><a class="courseBox" href="/courses/8000"><h3 class="courseBox--shortname">MTH 161</h3><div class="courseBox--name">Calculus</div></a></div></div>`;

const GS_COURSE = `
<table class="table" id="assignments-student-table"><thead><tr><th>Name</th><th>Status</th><th>Released</th></tr></thead><tbody>
<tr role="row"><th class="table--primaryLink" role="rowheader" scope="row"><a href="/courses/9001/assignments/501/submissions/77">Project 1</a></th>
  <td class="submissionStatus"><div class="submissionStatus--score">45.0 / 50.0</div></td>
  <td><time class="submissionTimeChart--releaseDate" datetime="2027-02-01 00:00:00 -0500">Feb 1</time><time class="submissionTimeChart--dueDate" datetime="2027-02-17 23:59:00 -0500">Feb 17</time></td></tr>
<tr role="row"><th class="table--primaryLink" role="rowheader" scope="row"><a href="/courses/9001/assignments/502/submissions/78">Lab 3 &amp; 4</a></th>
  <td class="submissionStatus"><div class="submissionStatus--text">Submitted</div></td>
  <td><time class="submissionTimeChart--dueDate" datetime="2027-02-24 23:59:00 -0500">Feb 24</time></td></tr>
<tr role="row"><th class="table--primaryLink" role="rowheader" scope="row"><button class="js-submitAssignment" data-assignment-id="503">Project 2</button></th>
  <td class="submissionStatus"><div class="submissionStatus--text">No Submission</div></td>
  <td><time class="submissionTimeChart--dueDate" datetime="2027-03-10 23:59:00 -0500">Mar 10</time><time class="submissionTimeChart--dueDate" datetime="2027-03-12 23:59:00 -0500">Late Due Date</time></td></tr>
</tbody></table>`;

describe("Gradescope", () => {
  it("parses the course list (current term only) and the assignment table", () => {
    expect(parseGsCourses(GS_ACCOUNT)).toEqual([
      { id: "9001", shortName: "CSC 172", name: "Data Structures & Algorithms" },
      { id: "9002", shortName: "ART 110", name: "Drawing" },
    ]);
    const rows = parseGsAssignments(GS_COURSE);
    expect(rows.map((r) => [r.id, r.title, r.score, r.possible, r.statusText, r.dueAt])).toEqual([
      ["501", "Project 1", 45, 50, undefined, "2027-02-18T04:59:00.000Z"],
      ["502", "Lab 3 & 4", undefined, undefined, "Submitted", "2027-02-25T04:59:00.000Z"],
      ["503", "Project 2", undefined, undefined, "No Submission", "2027-03-11T04:59:00.000Z"],
    ]);
    expect(parseGsAssignments("<html>layout changed</html>")).toEqual([]);
  });

  it("syncs matched courses, reports unmatched ones, and notices an expired sign-in", async () => {
    const seen: string[] = [];
    const f: FetchLike = async (input, init) => {
      const u = new URL(String(input));
      seen.push(`${u.host}${u.pathname} ${new Headers(init?.headers).get("cookie")}`);
      if (u.pathname === "/account") return new Response(GS_ACCOUNT, { status: 200, headers: { "content-type": "text/html" } });
      if (u.pathname === "/courses/9001") return new Response(GS_COURSE, { status: 200, headers: { "content-type": "text/html" } });
      return new Response("", { status: 404 });
    };
    const c = ctx(f, { GRADESCOPE_REQUEST_GAP_MS: "0" }, [course("bb:_172_1", "CSC 172", "Data Structures")]);
    expect((await gradescope.status(c)).state).toBe("not-configured");
    c.secrets.data.set(GRADESCOPE_COOKIES, new CookieJar([{ name: "_gradescope_session", value: "s", domain: "www.gradescope.com", path: "/", secure: true, hostOnly: true }]).serialize());
    const r = await gradescope.sync(c);
    expect(r.assignments!.map((a) => [a.id, a.courseId, a.status])).toEqual([
      ["gs:9001:501", "bb:_172_1", "graded"],
      ["gs:9001:502", "bb:_172_1", "submitted"],
      ["gs:9001:503", "bb:_172_1", "upcoming"],
    ]);
    expect(r.grades).toEqual([expect.objectContaining({ assignmentId: "gs:9001:501", score: 45, pointsPossible: 50 })]);
    expect(r.notes!.join(" ")).toMatch(/1 Gradescope course matched none/);
    expect(seen).toEqual(["www.gradescope.com/account _gradescope_session=s", "www.gradescope.com/courses/9001 _gradescope_session=s"]);

    const bounced: FetchLike = async () => new Response(null, { status: 302, headers: { location: "/login" } });
    const c2 = ctx(bounced);
    c2.secrets.data.set(GRADESCOPE_COOKIES, "[]");
    await expect(gradescope.sync(c2)).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe("Gmail", () => {
  it("builds a safe message and a compose link", () => {
    const mime = buildMime({ to: ["ada.lin@example.edu"], subject: "Extension\r\nBcc: evil@example.com", body: "Hello,\ncafé ☕" });
    const [head, body] = mime.split("\r\n\r\n");
    expect(head!.split("\r\n")).toHaveLength(5);
    expect(head).not.toMatch(/^Bcc:/m);
    expect(Buffer.from(/=\?UTF-8\?B\?(.+)\?=/.exec(head!)![1]!, "base64").toString()).toBe("Extension Bcc: evil@example.com");
    expect(Buffer.from(body!.replace(/\r\n/g, ""), "base64").toString()).toBe("Hello,\r\ncafé ☕");
    expect(() => buildMime({ to: ["not-an-email"], subject: "x", body: "y" })).toThrow(/address/);
    expect(() => buildMime({ to: ["a@b.co, c@d.co"], subject: "x", body: "y" })).toThrow(/address/);
    expect(composeLink({ to: ["a@b.co"], subject: "Hi & bye", body: "x" })).toBe("https://mail.google.com/mail/?view=cm&fs=1&to=a%40b.co&su=Hi+%26+bye&body=x");
    expect(parseAddress('"Lin, Ada" <ada.lin@example.edu>')).toMatchObject({ name: "Lin, Ada", email: "ada.lin@example.edu" });
  });

  it("signs in with PKCE, lists teacher mail, sends, and flags an expired token", async () => {
    const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", PORT: "5179" };
    const auth = new URL(gmailAuthUrl(env, "st4te", "ch4llenge"));
    expect(auth.origin + auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(auth.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5179/auth/google/callback");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");

    const calls: { url: string; body?: string; auth?: string | null }[] = [];
    let tokenOk = true;
    const f: FetchLike = async (input, init) => {
      const u = new URL(String(input));
      calls.push({ url: u.pathname + u.search, body: typeof init?.body === "string" ? init.body : undefined, auth: new Headers(init?.headers).get("authorization") });
      if (u.host === "oauth2.googleapis.com") {
        return tokenOk ? Response.json({ access_token: "at", refresh_token: "rt" }) : Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      if (u.pathname.endsWith("/messages") && init?.method !== "POST") return Response.json({ messages: [{ id: "m1" }] });
      if (u.pathname.endsWith("/messages/m1")) {
        return Response.json({
          id: "m1", threadId: "t1", labelIds: ["UNREAD", "INBOX"], snippet: "See you Thursday", internalDate: String(NOW.getTime()),
          payload: { headers: [{ name: "From", value: "Ada Lin <Ada.Lin@example.edu>" }, { name: "Subject", value: "Re: office hours" }, { name: "To", value: "me@school.edu" }] },
        });
      }
      if (u.pathname.endsWith("/messages/send")) return Response.json({ id: "sent1" });
      return new Response("{}", { status: 404 });
    };
    const c = ctx(f, env, [course("chem", "CHEM 101", "General Chemistry", "ada.lin@example.edu")]);
    expect((await gmail.status(c)).state).toBe("needs-sign-in");
    const { gmailExchangeCode } = await import("../src/index.js");
    await gmailExchangeCode(c, "the-code", "the-verifier");
    expect(c.secrets.data.get(GMAIL_TOKEN)).toBe("rt");
    expect(calls[0]!.body).toContain("code_verifier=the-verifier");
    expect((await gmail.status(c)).state).toBe("ready");

    const r = await gmail.sync(c);
    expect(r.messages).toEqual([
      expect.objectContaining({ id: "gmail:m1", courseId: "chem", subject: "Re: office hours", unread: true, from: expect.objectContaining({ email: "Ada.Lin@example.edu", role: "instructor" }) }),
    ]);
    expect(decodeURIComponent(calls.find((x) => x.url.includes("?maxResults"))!.url)).toContain('(from:ada.lin@example.edu OR "CHEM 101") newer_than:30d');

    await gmail.sendMessage!(c, { to: ["ada.lin@example.edu"], subject: "Question", body: "Hi" });
    const sent = JSON.parse(calls.at(-1)!.body!) as { raw: string };
    expect(Buffer.from(sent.raw, "base64url").toString()).toMatch(/^To: ada\.lin@example\.edu\r\nSubject: /);
    expect(calls.at(-1)!.auth).toBe("Bearer at");

    tokenOk = false;
    await expect(gmail.sync(c)).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe("Blackboard official API (OAuth)", () => {
  it("builds the approval link, stores tokens, refreshes them, and syncs with a bearer token", async () => {
    const bb = fakeBlackboard({ now: NOW });
    const env = { BLACKBOARD_BASE_URL: bb.base, BLACKBOARD_APP_KEY: "key", BLACKBOARD_APP_SECRET: "secret", BLACKBOARD_REQUEST_GAP_MS: "0", PORT: "5179" };
    const link = new URL(restAuthUrl(env, "xyz"));
    expect(link.pathname).toBe("/learn/api/public/v1/oauth2/authorizationcode");
    expect(link.searchParams.get("scope")).toBe("read");
    expect(link.searchParams.get("state")).toBe("xyz");

    const tokenCalls: string[] = [];
    const f: FetchLike = async (input, init) => {
      const u = new URL(String(input));
      const h = new Headers(init?.headers);
      if (u.pathname.endsWith("/oauth2/token")) {
        tokenCalls.push(String(init?.body));
        expect(h.get("authorization")).toBe(`Basic ${Buffer.from("key:secret").toString("base64")}`);
        return Response.json({ access_token: `at${tokenCalls.length}`, refresh_token: "rt", expires_in: 3600 });
      }
      // The fake site checks a cookie; a bearer token stands in for it here.
      return bb.fetch(input, { ...init, headers: { cookie: h.get("authorization")?.startsWith("Bearer at") ? "BbRouter=ok" : "" } });
    };
    const c = ctx(f, env);
    expect((await blackboardRest.status(c)).state).toBe("needs-sign-in");
    await restExchangeCode(c, "one-time-code");
    expect(tokenCalls[0]).toContain("grant_type=authorization_code");
    expect((await blackboardRest.status(c)).state).toBe("ready");

    const r = await blackboardRest.sync(c);
    expect(r.courses).toHaveLength(2);
    expect(r.assignments![0]!.sources[0]!.source).toBe("blackboard-rest");

    // Expired access token → refreshed before the next sync.
    const t = JSON.parse(c.secrets.data.get(REST_TOKENS)!) as { expires_at: number };
    c.secrets.data.set(REST_TOKENS, JSON.stringify({ ...t, expires_at: NOW.getTime() - 1 }));
    await blackboardRest.sync(c);
    expect(tokenCalls[1]).toContain("grant_type=refresh_token");
    expect(JSON.parse(c.secrets.data.get(REST_TOKENS)!)).toMatchObject({ access_token: "at2", refresh_token: "rt" });
  });
});
