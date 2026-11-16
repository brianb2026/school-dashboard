import type { StoredCookie } from "../src/net.js";

/**
 * A pretend Canvas, shaped like the real API (canvas.instructure.com/doc/api):
 * paginated with Link headers, `while(1);` in front of JSON for a browser
 * session, 401 JSON when signed out. One current class and one from last year.
 */
export function fakeCanvas(opts: { base?: string; now?: Date } = {}) {
  const base = opts.base ?? "https://canvas.fake-school.test";
  const now = opts.now ?? new Date();
  const iso = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const state = { sessionValid: true, token: "canvas-test-token-0123456789abcdef", log: [] as string[] };
  const sessionCookie: StoredCookie = { name: "canvas_session", value: "cv-ok", domain: new URL(base).hostname, path: "/", secure: true, hostOnly: true };

  const courses = [
    {
      id: "4101",
      name: "CS 2100: Data Structures and Algorithms 1",
      course_code: "CS 2100",
      apply_assignment_group_weights: true,
      term: { name: "2026 Fall", start_at: iso(-80), end_at: iso(30) },
      enrollments: [{ type: "student", computed_current_score: 88.5, computed_current_grade: "B+" }],
      teachers: [{ display_name: "Ray Pettit" }],
      syllabus_body: `<p>${"Course policies and weekly topics. ".repeat(12)}</p>`,
    },
    {
      id: "3001",
      name: "CS 1110: Intro to Programming",
      course_code: "CS 1110",
      term: { name: "2025 Fall", start_at: iso(-450), end_at: iso(-330) },
      enrollments: [{ type: "student", computed_current_score: 95 }],
    },
  ];
  const groups = {
    "4101": [
      {
        id: "g1",
        name: "Homework",
        group_weight: 40,
        rules: { drop_lowest: 1 },
        assignments: [
          { id: "a1", name: "HW1 Linked lists", due_at: iso(-20), points_possible: 10, html_url: `${base}/courses/4101/assignments/a1`, submission_types: ["online_upload"], submission: { score: 9, workflow_state: "graded", graded_at: iso(-15), submitted_at: iso(-21) } },
          { id: "a2", name: "HW2 Trees", due_at: iso(4), points_possible: 10, html_url: `${base}/courses/4101/assignments/a2`, submission_types: ["online_upload"], submission: { workflow_state: "unsubmitted" } },
          { id: "a5", name: "HW0 Draft", published: false, points_possible: 5 },
        ],
      },
      {
        id: "g2",
        name: "Exams",
        group_weight: 60,
        assignments: [
          { id: "a3", name: "Midterm", due_at: iso(-10), points_possible: 100, html_url: `${base}/courses/4101/assignments/a3`, submission: { score: 85, workflow_state: "graded" } },
          { id: "a4", name: "Quiz 3", due_at: iso(2), points_possible: 20, quiz_id: "q9", submission_types: ["online_quiz"], html_url: `${base}/courses/4101/assignments/a4` },
        ],
      },
    ],
  } as Record<string, unknown[]>;
  const modules = {
    "4101": [
      {
        id: "m1",
        name: "Week 1",
        items: [
          { id: "i1", title: "Lab 1 handout", type: "File", content_id: "f2", html_url: `${base}/courses/4101/modules/items/i1` },
          { id: "i2", title: "Read me first", type: "Page", html_url: `${base}/courses/4101/pages/read-me` },
          { id: "i3", title: "HW1 Linked lists", type: "Assignment", content_id: "a1", html_url: `${base}/courses/4101/modules/items/i3` },
          { id: "i4", title: "Gradescope", type: "ExternalTool", external_url: "https://www.gradescope.com/auth/lti", html_url: `${base}/courses/4101/modules/items/i4` },
          { id: "i5", title: "Textbook", type: "ExternalUrl", external_url: "https://book.example/ds", html_url: `${base}/courses/4101/modules/items/i5` },
        ],
      },
      { id: "m2", name: "Exams", items: [{ id: "i6", title: "Quiz 3", type: "Quiz", content_id: "q9", html_url: `${base}/courses/4101/quizzes/q9` }] },
    ],
  } as Record<string, unknown[]>;
  const files = {
    "4101": [
      { id: "f1", display_name: "CS2100 Syllabus.pdf", folder_id: "d1", "content-type": "application/pdf", updated_at: iso(-90), url: `${base}/files/f1/download?verifier=x` },
      { id: "f2", display_name: "Lab 1 handout.pdf", folder_id: "d2", "content-type": "application/pdf", updated_at: iso(-60), url: `${base}/files/f2/download?verifier=y` },
    ],
  } as Record<string, unknown[]>;
  const folders = { "4101": [{ id: "d1", full_name: "course files/Syllabus" }, { id: "d2", full_name: "course files/Labs" }] } as Record<string, unknown[]>;
  const announcements = [
    { id: "n1", title: "Office hours moved", message: "<p>This week only: <b>Thursday</b>.</p>", posted_at: iso(-1), context_code: "course_4101", read_state: "unread", author: { display_name: "Ray Pettit" } },
  ];

  function respond(method: string, url: URL, cookie: string, auth: string): { status: number; headers: [string, string][]; body: string } {
    state.log.push(`${method} ${url.pathname}${url.search}`);
    const p = url.pathname;
    const bearer = auth === `Bearer ${state.token}`;
    const session = state.sessionValid && /canvas_session=cv-ok/.test(cookie);
    const json = (data: unknown, extra: [string, string][] = []) => ({
      status: 200,
      headers: [["content-type", "application/json; charset=utf-8"], ...extra] as [string, string][],
      body: `${bearer ? "" : "while(1);"}${JSON.stringify(data)}`,
    });
    if (method !== "GET") return { status: 405, headers: [], body: "" };
    if (p === "/login") return { status: 200, headers: [["content-type", "text/html"]], body: "<form id=login_form>NetBadge</form>" };
    if (p.startsWith("/files/") && p.endsWith("/download")) {
      if (!session && !bearer) return { status: 302, headers: [["location", `${base}/login`]], body: "" };
      return { status: 302, headers: [["location", `https://files.storage.example/${p.split("/")[2]}.pdf`]], body: "" };
    }
    if (!p.startsWith("/api/v1/")) return { status: 404, headers: [], body: "" };
    if (!session && !bearer) return { status: 401, headers: [["content-type", "application/json"]], body: JSON.stringify({ status: "unauthenticated", errors: [{ message: "user authorization required" }] }) };
    let m: RegExpExecArray | null;
    if (p === "/api/v1/users/self") return json({ id: "777", name: "Test Student", short_name: "Test" });
    if (p === "/api/v1/courses") {
      // Two pages, to exercise the Link header.
      return url.searchParams.get("page") === "2" ? json(courses.slice(1)) : json(courses.slice(0, 1), [["link", `<${base}/api/v1/courses?page=2&per_page=100>; rel="next"`]]);
    }
    if ((m = /^\/api\/v1\/courses\/(\w+)$/.exec(p))) return json(courses.find((c) => c.id === m![1]) ?? {});
    if ((m = /^\/api\/v1\/courses\/(\w+)\/assignment_groups$/.exec(p))) return json(groups[m[1]!] ?? []);
    if ((m = /^\/api\/v1\/courses\/(\w+)\/modules$/.exec(p))) return json(modules[m[1]!] ?? []);
    if ((m = /^\/api\/v1\/courses\/(\w+)\/files$/.exec(p))) return files[m[1]!] ? json(files[m[1]!]) : { status: 403, headers: [["content-type", "application/json"]], body: '{"status":"unauthorized"}' };
    if ((m = /^\/api\/v1\/courses\/(\w+)\/folders$/.exec(p))) return json(folders[m[1]!] ?? []);
    if ((m = /^\/api\/v1\/courses\/(\w+)\/files\/(\w+)$/.exec(p))) return json((files[m[1]!] ?? []).find((f) => (f as { id: string }).id === m![2]) ?? {});
    if (p === "/api/v1/announcements") return json(announcements);
    return { status: 404, headers: [["content-type", "application/json"]], body: "{}" };
  }

  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.hostname === "files.storage.example") return new Response(new TextEncoder().encode("%PDF-1.4 fake"), { status: 200, headers: { "content-type": "application/pdf" } });
    const h = new Headers(init?.headers);
    const r = respond(init?.method ?? "GET", url, h.get("cookie") ?? "", h.get("authorization") ?? "");
    const headers = new Headers();
    for (const [k, v] of r.headers) headers.append(k, v);
    return new Response(r.status === 302 || r.status === 204 ? null : r.body, { status: r.status, headers });
  };
  return { base, state, sessionCookie, fetch };
}

export type FakeCanvas = ReturnType<typeof fakeCanvas>;
