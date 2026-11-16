/**
 * A pretend Blackboard Learn for tests and local try-outs. It answers the
 * public REST paths with made-up data shaped like the real API, checks the
 * session cookie the way a real site would, and has a sign-in page that
 * signs itself in (so the link flow can be tried with no real account).
 * Nothing here talks to a real school.
 */
import { readFileSync } from "node:fs";
import type { FetchLike } from "../src/net.js";

export interface FakeReply {
  status: number;
  headers: [string, string][];
  body: string | Uint8Array;
}

export interface FakeBlackboard {
  base: string;
  /** Flip to simulate an expired session, endpoints the school hides from students, etc. */
  state: {
    sessionValid: boolean;
    forbidden: Set<string>;
    /** Paths that answer 401 even though the session is fine (some schools do this for hidden features). */
    unauthorized: Set<string>;
    log: string[];
    /** Extra gradebook grade that appears on the next sync (for notification tests). */
    lateGrade: boolean;
    renames: Map<string, string>;
    /** Gradebook columns the instructor deleted. */
    removedColumns: Set<string>;
    /** New due dates the instructor set (column id → ISO), for "deadline moved" tests. */
    moved: Map<string, string>;
  };
  respond(method: string, url: URL, cookie: string): FakeReply;
  fetch: FetchLike;
  /** Cookie a signed-in browser would hold. */
  sessionCookie: { name: string; value: string; domain: string; path: string; secure: boolean; hostOnly: boolean };
}

const SYLLABUS_PDF = new URL("../../syllabus-parser/test/fixtures/chem101.pdf", import.meta.url);

const CSC_SYLLABUS_HTML = `
<h2>CSC 172 Data Structures and Algorithms</h2>
<p>Lecture: TR 2:00-3:15 pm, Wegmans 1400</p>
<p>This is a 4 credit course. Instructor: Prof. Sam Okafor (okafor@example.edu). Office hours: Wed 1-3 pm, Wegmans 2105.</p>
<p>The course covers lists, trees, hashing, graphs and the analysis of algorithms. Work is submitted through Gradescope and scores are posted to Blackboard.
Collaboration is allowed on labs but not on projects or exams. Please read the academic honesty policy carefully before the first project is due.</p>
<h3>Grading</h3>
<ul><li>Projects: 40%</li><li>Quizzes: 20%</li><li>Exams: 40%</li></ul>
<p>Letter grades: A 93-100, A- 90-92, B+ 87-89, B 83-86, B- 80-82, C+ 77-79, C 73-76, C- 70-72, D 60-69, F 0-59</p>
<p>Late policy: projects lose 10% per day.</p>
<h3>Schedule</h3>
<p>Mar 4  Midterm exam</p>
`;

const CSC_SCHEDULE_HTML = `
<h3>Weekly schedule</h3>
<p>Readings are from the course textbook and should be done before the first lecture of the week. Slides are posted in each week's folder after class.</p>
<p>Week of March 8: Read Chapter 5.1 Hash tables</p>
<p>Week of March 15: Read Chapter 6.2 Binary search trees</p>
<p>Week of March 22: Read Chapter 7.1 Graphs</p>
`;

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * A pretend Gradescope: the account page and one course page, shaped like the
 * real HTML. Project 1 is the item Blackboard links to (and scores a little
 * differently); Lab 3 exists only here.
 */
export function fakeGradescope(now = new Date()): { fetch: FetchLike; cookie: FakeBlackboard["sessionCookie"]; seen: string[]; state: { empty: boolean } } {
  const seen: string[] = [];
  const state = { empty: false };
  const stamp = (days: number) => `${new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)} 23:59:00 -0400`;
  const account = () => `<div class="courseList"><div class="courseList--term">Spring 2027</div><div class="courseList--coursesForTerm">${
    state.empty
      ? ""
      : '<a class="courseBox " data-loginrequired="false" href="/courses/9001"><h3 class="courseBox--shortname">CSC 172</h3><div class="courseBox--name">Data Structures</div></a>'
  }<button class="courseBox courseBox-new">Add a course</button></div></div>`;
  const row = (id: string, title: string, score: string, due: number) =>
    `<tr role="row"><th scope="row"><a href="/courses/9001/assignments/${id}/submissions/1">${title}</a></th><td>${score}</td>` +
    `<td><time class="submissionTimeChart--dueDate" datetime="${stamp(due)}">due</time></td></tr>`;
  const course = `<table id="assignments-student-table"><thead><tr><th>Name</th><th>Status</th><th>Due</th></tr></thead><tbody>${
    row("5001", "Project 1", '<div class="submissionStatus--score">47.0 / 50.0</div>', -12) +
    row("5002", "Lab 3", '<div class="submissionStatus--score">18.0 / 20.0</div>', -4) +
    row("5003", "Homework 5", '<div class="submissionStatus--text">No Submission</div>', 6)
  }</tbody></table>`;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    seen.push(`${url.host}${url.pathname}`);
    if (url.host !== "www.gradescope.com") throw new TypeError(`fake Gradescope: unexpected host ${url.host}`);
    if (!/_gradescope_session=ok/.test(cookie)) return new Response(null, { status: 302, headers: { location: "/login" } });
    if (url.pathname === "/account") return new Response(account(), { status: 200, headers: { "content-type": "text/html" } });
    if (url.pathname === "/courses/9001") return new Response(course, { status: 200, headers: { "content-type": "text/html" } });
    return new Response("", { status: 404 });
  };
  return { fetch: fetchImpl, seen, state, cookie: { name: "_gradescope_session", value: "ok", domain: "www.gradescope.com", path: "/", secure: true, hostOnly: true } };
}

export function fakeBlackboard(opts: { base?: string; now?: Date; /** Project 1 is a link into Gradescope, the way schools that launch Gradescope from Blackboard set it up. */ gradescope?: boolean } = {}): FakeBlackboard {
  const base = opts.base ?? "https://learn.fake-school.test";
  const host = new URL(base).hostname;
  const now = opts.now ?? new Date();
  const iso = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const state: FakeBlackboard["state"] = { sessionValid: true, forbidden: new Set(["meetings"]), unauthorized: new Set(), log: [], lateGrade: false, renames: new Map(), removedColumns: new Set(), moved: new Map() };

  const courses = {
    chem: { id: "_101_1", courseId: "CHEM101.2027SPRING.40112", name: "CHEM 101 - General Chemistry I", termId: "_t1_1", availability: { available: "Yes" } },
    csc: { id: "_172_1", courseId: "2027SP-CSC-172-01", name: "Data Structures & Algorithms", termId: "_t1_1", availability: { available: "Yes" } },
    old: { id: "_90_1", courseId: "HIS140.2025FALL.1", name: "Modern Europe", termId: "_t0_1", availability: { available: "Yes" } },
    club: { id: "_5_1", courseId: "CHESS-CLUB", name: "Chess Club", organization: true, availability: { available: "Yes" } },
  };
  const memberships = [
    { courseId: courses.chem.id, courseRoleId: "Student", availability: { available: "Yes" }, lastAccessed: iso(-1), course: courses.chem },
    { courseId: courses.csc.id, courseRoleId: "Student", availability: { available: "Yes" }, lastAccessed: iso(-2), course: courses.csc },
    { courseId: courses.old.id, courseRoleId: "Student", availability: { available: "Yes" }, lastAccessed: iso(-300), course: courses.old },
    { courseId: courses.club.id, courseRoleId: "Student", availability: { available: "Yes" }, lastAccessed: iso(-1), course: courses.club },
  ];
  const terms: Record<string, unknown> = {
    _t1_1: { id: "_t1_1", name: "Spring 2027", availability: { duration: { type: "DateRange", start: iso(-60), end: iso(60) } } },
    _t0_1: { id: "_t0_1", name: "Fall 2025", availability: { duration: { type: "DateRange", start: iso(-500), end: iso(-380) } } },
  };

  const columns: Record<string, unknown[]> = {
    _101_1: [
      { id: "_c1_1", name: "Homework 1", score: { possible: 10 }, grading: { type: "Attempts", due: iso(-20) }, gradebookCategoryId: "_hw_1" },
      { id: "_c2_1", name: "Homework 2", score: { possible: 10 }, grading: { type: "Attempts", due: iso(3) }, gradebookCategoryId: "_hw_1" },
      { id: "_c3_1", name: "Midterm Exam 1", score: { possible: 100 }, grading: { type: "Manual", due: iso(-10) }, gradebookCategoryId: "_ex_1" },
      { id: "_c4_1", name: "Lab 1", score: { possible: 25 }, grading: { type: "Attempts", due: iso(-5) }, gradebookCategoryId: "_lab_1" },
      { id: "_c5_1", name: "Homework 0 (old)", score: { possible: 10 }, grading: { type: "Attempts", due: iso(-30) }, gradebookCategoryId: "_hw_1" },
      { id: "_c7_1", name: "Start-of-term survey", score: { possible: 5 }, grading: { type: "Attempts" }, includeInCalculations: false },
      { id: "_c8_1", name: "Weighted Total", score: { possible: 100 }, grading: { type: "Calculated" } },
      { id: "_c9_1", name: "Total", score: { possible: 170 }, grading: { type: "Calculated" } },
      { id: "_c10_1", name: "Hidden column", score: { possible: 1 }, availability: { available: "No" } },
    ],
    _172_1: [
      { id: "_d1_1", name: "Project 1", score: { possible: 50 }, grading: { type: "Manual", due: iso(-12) }, ...(opts.gradescope ? { contentId: "_g2_1" } : {}) },
      { id: "_d2_1", name: "Quiz 1", score: { possible: 10 }, grading: { type: "Manual", due: iso(-8) } },
      { id: "_d3_1", name: "Project 2", score: { possible: 50 }, grading: { type: "Manual", due: iso(9) } },
      { id: "_d4_1", name: "Total", score: { possible: 110 }, grading: { type: "Calculated" } },
    ],
  };
  const grades = (courseId: string): unknown[] => {
    if (courseId === "_101_1") {
      return [
        { columnId: "_c1_1", status: "Graded", displayGrade: { scaleType: "Score", score: 9, possible: 10 }, lastRelevantDate: iso(-18) },
        { columnId: "_c3_1", status: "Graded", displayGrade: { scaleType: "Score", score: 84, possible: 100 }, lastRelevantDate: iso(-8) },
        { columnId: "_c4_1", status: "NeedsGrading" },
        { columnId: "_c7_1", status: "Graded", displayGrade: { scaleType: "Score", score: 5, possible: 5 } },
        { columnId: "_c8_1", status: "Graded", displayGrade: { scaleType: "Percent", score: 88.2, possible: 100, text: "88.2%" } },
        { columnId: "_c9_1", status: "Graded", displayGrade: { scaleType: "Score", score: 116, possible: 135 } },
        ...(state.lateGrade ? [{ columnId: "_c2_1", status: "Graded", displayGrade: { scaleType: "Score", score: 10, possible: 10 }, lastRelevantDate: iso(0) }] : []),
      ];
    }
    return [
      { columnId: "_d1_1", status: "Graded", displayGrade: { scaleType: "Score", score: 45, possible: 50 }, lastRelevantDate: iso(-9) },
      { columnId: "_d2_1", status: "Graded", displayGrade: { scaleType: "Score", score: 8, possible: 10 }, lastRelevantDate: iso(-6) },
      { columnId: "_d4_1", status: "Graded", displayGrade: { scaleType: "Score", score: 53, possible: 60 } },
    ];
  };
  const categories = [
    { id: "_hw_1", title: "Homework" },
    { id: "_ex_1", title: "Exam" },
    { id: "_lab_1", title: "Lab" },
  ];
  const schemas = [
    { id: "_s1_1", title: "Score", scaleType: "Score" },
    {
      id: "_s2_1",
      title: "Letter",
      scaleType: "Tabular",
      symbols: [
        { text: "A", lowerBound: 94 },
        { text: "A-", lowerBound: 90 },
        { text: "B+", lowerBound: 87 },
        { text: "B", lowerBound: 84 },
        { text: "B-", lowerBound: 80 },
        { text: "C", lowerBound: 70 },
        { text: "D", lowerBound: 60 },
        { text: "F", lowerBound: 0 },
      ],
    },
  ];
  const announcements: Record<string, unknown[]> = {
    _101_1: [
      {
        id: "_a1_1",
        title: "Midterm 2 moved",
        body: '<p>Midterm 2 is now <b>Thursday</b> &amp; covers ch. 5&ndash;7.</p><script>document.title="pwned"</script><p><a href="https://example.edu/review">Review sheet</a></p>',
        created: iso(-1),
      },
      { id: "_a2_1", title: "Draft, not posted", body: "x", draft: true, created: iso(-1) },
    ],
  };
  // Ultra keeps the syllabus as a file embedded in a document, inside "Course Overview → Syllabus".
  const syllabusDoc =
    `<p>The syllabus for this term:</p><a data-bbtype="attachment" data-bbfile="${attr(JSON.stringify({ linkName: "CHEM101_Syllabus.pdf", mimeType: "application/pdf", render: "inline" }))}" ` +
    `href="${base}/bbcswebdav/pid-1-dt-content-rid-2_1/xid-1_1?X-Blackboard-Expiration=1&amp;X-Blackboard-Signature=abc">CHEM101_Syllabus.pdf</a>` +
    `<a data-bbtype="image" data-bbfile="${attr(JSON.stringify({ linkName: "banner.png", mimeType: "image/png" }))}" href="${base}/bbcswebdav/pid-1-dt-content-rid-9_1/xid-9_1">banner</a>`;
  const contents: Record<string, unknown[]> = {
    _101_1: [
      { id: "_f1_1", title: "Course Overview - Start Here", contentHandler: { id: "resource/x-bb-folder" } },
      { id: "_f4_1", parentId: "_f1_1", title: "Syllabus", contentHandler: { id: "resource/x-bb-folder" } },
      { id: "_f2_1", parentId: "_f4_1", title: "ultraDocumentBody", body: syllabusDoc, modified: iso(-50), contentHandler: { id: "resource/x-bb-document" } },
      { id: "_f5_1", title: "Week 1", contentHandler: { id: "resource/x-bb-folder" } },
      { id: "_f3_1", parentId: "_f5_1", title: "Week 1 slides", modified: iso(-40), contentHandler: { id: "resource/x-bb-file", file: { fileName: "week1.pptx" } } },
      { id: "_f6_1", parentId: "_f5_1", title: "Lab 1 handout", modified: iso(-12), contentHandler: { id: "resource/x-bb-file", file: { fileName: "Lab 1 handout.pdf" } } },
      { id: "_f7_1", parentId: "_f5_1", title: "Hidden draft", availability: { available: "No" }, contentHandler: { id: "resource/x-bb-file", file: { fileName: "draft.pdf" } } },
      { id: "_f9_1", parentId: "_f5_1", title: "Textbook site", contentHandler: { id: "resource/x-bb-externallink", url: "https://textbook.example/chem" } },
      { id: "_f8_1", title: "Qwickly Attendance", contentHandler: { id: "resource/x-bb-blti-link", url: "https://attendance.qwickly.example/launch" } },
    ],
    _172_1: [
      { id: "_g1_1", title: "Syllabus", body: CSC_SYLLABUS_HTML, modified: iso(-55), contentHandler: { id: "resource/x-bb-document" } },
      { id: "_g3_1", title: "Course Schedule", body: CSC_SCHEDULE_HTML, modified: iso(-54), contentHandler: { id: "resource/x-bb-document" } },
      ...(opts.gradescope
        ? [
            {
              id: "_g2_1",
              title: "Project 1",
              description: "Submit on Gradescope",
              contentHandler: { id: "resource/x-bb-blti-link", url: "https://gs-proxy.example/launch", customParameters: { custom_gradescope_resource_id: "assignment-5001" } },
            },
          ]
        : []),
    ],
  };
  const attachments: Record<string, unknown[]> = {
    _f3_1: [{ id: "_att2_1", fileName: "week1.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }],
    _f6_1: [{ id: "_att3_1", fileName: "Lab 1 handout.pdf", mimeType: "application/pdf" }],
  };
  const people: Record<string, unknown[]> = {
    _101_1: [
      { courseRoleId: "Instructor", user: { id: "_9_1", name: { given: "Ada", family: "Lin" }, contact: { email: "ada.lin@example.edu" } } },
      { courseRoleId: "Student", user: { id: "_77_1", name: { given: "Test", family: "Student" } } },
    ],
  };

  const json = (data: unknown, extra: [string, string][] = []): FakeReply => ({
    status: 200,
    headers: [["content-type", "application/json;charset=UTF-8"], ...extra],
    body: JSON.stringify(data),
  });
  const page = (results: unknown[], nextPage?: string) => json(nextPage ? { results, paging: { nextPage } } : { results }, slide());
  const status = (s: number): FakeReply => ({ status: s, headers: [["content-type", "application/json"]], body: JSON.stringify({ status: s }) });
  // Real Blackboard re-issues its session cookie on every response.
  const slide = (): [string, string][] => [["set-cookie", `BbRouter=ok-${state.log.length}; Path=/; Secure; HttpOnly`]];

  function respond(method: string, url: URL, cookie: string): FakeReply {
    const p = url.pathname;
    state.log.push(`${method} ${p}${url.search}`);
    const signedIn = state.sessionValid && /(?:^|;\s*)BbRouter=ok/.test(cookie);

    // ---- sign-in pages (browser only) ----
    if (p === "/" || p === "/ultra") {
      if (signedIn) return { status: 200, headers: [["content-type", "text/html"]], body: "<title>Fake Blackboard</title><h1>Signed in</h1>" };
      return { status: 302, headers: [["location", "/webapps/login/"]], body: "" };
    }
    if (p === "/webapps/login/") {
      return {
        status: 200,
        headers: [["content-type", "text/html"]],
        body: '<title>Fake school sign-in</title><h1>Fake school sign-in</h1><p>Signing you in…</p><script>setTimeout(function(){location.href="/webapps/login/do"},1200)</script>',
      };
    }
    if (p === "/webapps/login/do") {
      state.sessionValid = true;
      return { status: 302, headers: [["location", "/ultra"], ["set-cookie", "BbRouter=ok-0; Path=/; HttpOnly"]], body: "" };
    }
    if (p.startsWith("/bbcswebdav/")) {
      if (!signedIn) return { status: 302, headers: [["location", "/webapps/login/"]], body: "" };
      const which = /xid-(\d+)_1$/.exec(p)?.[1];
      const name = which === "1" ? "CHEM101_Syllabus.pdf" : which === "3" ? "Lab 1 handout.pdf" : "week1.pptx";
      return {
        status: 200,
        headers: [
          ["content-type", which === "2" ? "application/octet-stream" : "application/pdf"],
          ["content-disposition", `attachment; filename="${name}"`],
        ],
        body: which === "1" ? new Uint8Array(readFileSync(SYLLABUS_PDF)) : which === "3" ? new TextEncoder().encode("%PDF-1.4\n% pretend handout\n") : new Uint8Array([80, 75, 3, 4]),
      };
    }

    // ---- REST ----
    if (!p.startsWith("/learn/api/public/")) return status(404);
    if (method !== "GET") return status(405);
    if (!signedIn) return status(401);
    for (const f of state.forbidden) if (p.includes(`/${f}`)) return status(403);
    for (const f of state.unauthorized) if (p.includes(`/${f}`)) return status(401);

    let m: RegExpExecArray | null;
    if (p === "/learn/api/public/v1/users/me") return json({ id: "_77_1", userName: "tstudent", name: { given: "Test", family: "Student" } }, slide());
    if (/\/v1\/users\/[^/]+\/courses$/.test(p)) {
      // Two pages, to exercise paging.
      return url.searchParams.get("offset") === "3"
        ? page(memberships.slice(3))
        : page(memberships.slice(0, 3), `${p}?expand=course&limit=100&offset=3`);
    }
    if ((m = /\/v1\/terms\/([^/]+)$/.exec(p))) return terms[m[1]!] ? json(terms[m[1]!], slide()) : status(404);
    if ((m = /\/v[12]\/courses\/([^/]+)\/gradebook\/columns$/.exec(p))) {
      const cols = (columns[m[1]!] ?? []).filter((c) => !state.removedColumns.has((c as { id: string }).id)).map((c) => {
        const col = c as { id: string; name: string; grading?: { due?: string } };
        const due = state.moved.get(col.id);
        const moved = due ? { ...col, grading: { ...col.grading, due } } : col;
        return state.renames.has(col.id) ? { ...moved, name: state.renames.get(col.id) } : moved;
      });
      return page(cols);
    }
    if ((m = /\/v[12]\/courses\/([^/]+)\/gradebook\/users\/[^/]+$/.exec(p))) return page(grades(m[1]!));
    if (/\/gradebook\/categories$/.test(p)) return page(categories);
    if (/\/gradebook\/schemas$/.test(p)) return page(schemas);
    if ((m = /\/v1\/courses\/([^/]+)\/announcements$/.exec(p))) return m[1] === "_172_1" ? status(403) : page(announcements[m[1]!] ?? []);
    if ((m = /\/v1\/courses\/([^/]+)\/users$/.exec(p))) return page(people[m[1]!] ?? []);
    if ((m = /\/v1\/courses\/([^/]+)\/contents$/.exec(p))) return page(contents[m[1]!] ?? []);
    if ((m = /\/v1\/courses\/([^/]+)\/contents\/([^/]+)$/.exec(p))) {
      const item = (contents[m[1]!] ?? []).find((c) => (c as { id: string }).id === m![2]);
      return item ? json(item, slide()) : status(404);
    }
    if ((m = /\/contents\/([^/]+)\/attachments$/.exec(p))) return attachments[m[1]!] ? page(attachments[m[1]!]!) : status(400);
    if ((m = /\/attachments\/([^/]+)\/download$/.exec(p))) {
      return { status: 302, headers: [["location", m[1] === "_att3_1" ? "/bbcswebdav/xid-3_1" : "/bbcswebdav/xid-2_1"]], body: "" };
    }
    return status(404);
  }

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== base) throw new TypeError(`fake Blackboard: unexpected host ${url.host}`);
    const headers = new Headers(init?.headers);
    const r = respond(init?.method ?? "GET", url, headers.get("cookie") ?? "");
    const h = new Headers();
    for (const [k, v] of r.headers) h.append(k, v);
    const body = r.status === 302 || r.status === 304 ? null : (r.body as BodyInit);
    return new Response(body, { status: r.status, headers: h });
  };

  return {
    base,
    state,
    respond,
    fetch: fetchImpl,
    sessionCookie: { name: "BbRouter", value: "ok-0", domain: host, path: "/", secure: true, hostOnly: true },
  };
}
