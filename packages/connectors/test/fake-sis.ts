import type { StoredCookie } from "../src/net.js";

/**
 * A pretend PeopleSoft Campus Solutions SIS. The markup follows the shape of
 * the delivered student pages (classic grids with <th> headers, values in
 * nested spans, sidebar sections), not any one school's exact page.
 */
export function fakeSis(opts: { base?: string; site?: string } = {}) {
  const base = opts.base ?? "https://sis.fake-school.test";
  const site = opts.site ?? "csprd";
  const state = { sessionValid: true, holds: ["Immunization Hold"], log: [] as string[] };
  const sessionCookie: StoredCookie = { name: "PS_TOKEN", value: "ps-ok", domain: new URL(base).hostname, path: "/", secure: true, hostOnly: true };
  const home = `${base}/psp/${site}/EMPLOYEE/SA/h/?tab=DEFAULT`;
  const pageShell = (inner: string) =>
    `<!DOCTYPE html><html><head><title>Student Center</title></head><body><form name="win0" method="post"><div id="win0divPAGECONTAINER"><table class="PSPAGECONTAINER"><tr><td>${inner}</td></tr></table></div></form></body></html>`;

  const studentCenter = () =>
    pageShell(`
      <table><tr><td>
        <table class="PSLEVEL1GRIDWBO" id="STDNT_WEEK_SCHD$scroll$0">
          <tr><th class="PSLEVEL1GRIDCOLUMNHDR" scope="col"><a>Class</a></th><th class="PSLEVEL1GRIDCOLUMNHDR" scope="col">Schedule</th></tr>
          <tr><td class="PSLEVEL1GRIDODDROW"><div><span id="CLASS_NAME$span$0"><a>CS 2100-001<br>LEC (12345)</a></span></div></td>
              <td class="PSLEVEL1GRIDODDROW"><div><span id="DERIVED_SSS_SCL_SSR_MTG_SCHED_LONG$0">MoWe 2:00PM - 3:15PM<br>Rice Hall 130</span></div></td></tr>
          <tr><td class="PSLEVEL1GRIDEVENROW"><div><span><a>CS 2100-101<br>LAB (12346)</a></span></div></td>
              <td class="PSLEVEL1GRIDEVENROW"><div><span>Fr 10:00AM - 11:50AM<br>Olsson Hall 001</span></div></td></tr>
          <tr><td><div><span><a>ENWR 1510-012<br>SEM (22001)</a></span></div></td>
              <td><div><span>TuTh 9:30AM - 10:45AM<br>Bryan Hall 203</span></div></td></tr>
          <tr><td><div><span><a>STS 1500-001<br>IND (30001)</a></span></div></td><td><div><span>TBA</span></div></td></tr>
        </table>
      </td><td>
        <div class="PSGROUPBOXLABEL">Holds</div>
        ${state.holds.length ? `<ul>${state.holds.map((h) => `<li><a href="#">${h}</a></li>`).join("")}</ul><a>details</a>` : "<div>No Holds.</div>"}
        <div class="PSGROUPBOXLABEL">To Do List</div>
        <div>No To Do's.</div>
        <div class="PSGROUPBOXLABEL">Enrollment Dates</div>
        <div>Enrollment Appointment</div>
        <span>You may begin enrolling for the 2027 Spring Regular Academic Session session on April 5, 2027.</span>
      </td></tr></table>`);

  const history = () =>
    pageShell(`
      <table class="PSLEVEL1GRID">
        <tr><th>Course</th><th>Description</th><th>Term</th><th>Grade</th><th>Units</th><th>Status</th></tr>
        ${[
          ["CS 1110", "Introduction to Programming", "2026 Spring", "A", "3.00", "Taken"],
          ["MATH 1310", "Calculus I", "2026 Spring", "B+", "4.00", "Taken"],
          ["ENWR 1505", "Writing and Critical Inquiry", "2026 Spring", "A-", "3.00", "Taken"],
          ["APMA 1090", "Single Variable Calculus", "2026 Spring", "CR", "1.00", "Taken"],
          ["PHYS 1425", "Physics I", "2026 Spring", "W", "3.00", "Withdrawn"],
          ["CS 2100", "Data Structures and Algorithms 1", "2026 Fall", "&nbsp;", "4.00", "Enrolled"],
          ["ENWR 1510", "Writing and Critical Inquiry", "2026 Fall", "&nbsp;", "3.00", "Enrolled"],
        ]
          .map((r) => `<tr>${r.map((v) => `<td class="PSLEVEL1GRIDODDROW"><div><span>${v}</span></div></td>`).join("")}</tr>`)
          .join("")}
      </table>`);

  function respond(method: string, url: URL, cookie: string): { status: number; headers: [string, string][]; body: string } {
    state.log.push(`${method} ${url.pathname}`);
    if (method !== "GET") return { status: 405, headers: [], body: "" };
    const signed = state.sessionValid && /PS_TOKEN=ps-ok/.test(cookie);
    const html = (body: string) => ({ status: 200, headers: [["content-type", "text/html; charset=UTF-8"]] as [string, string][], body });
    if (url.pathname === "/" || url.pathname === "") return { status: 302, headers: [["location", home]], body: "" };
    if (!signed) return { status: 302, headers: [["location", `${base}/psp/${site}/?cmd=login&languageCd=ENG`]], body: "" };
    const p = url.pathname;
    if (p.startsWith(`/psp/${site}/`) && p.endsWith("/h/")) return html(pageShell("Homepage"));
    if (p === `/psc/${site}/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSS_STUDENT_CENTER.GBL`) return html(studentCenter());
    if (p === `/psc/${site}/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSS_MY_CRSEHIST.GBL`) return html(history());
    return { status: 404, headers: [], body: "Not found" };
  }

  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const r = respond(init?.method ?? "GET", url, new Headers(init?.headers).get("cookie") ?? "");
    const headers = new Headers();
    for (const [k, v] of r.headers) headers.append(k, v);
    return new Response(r.status === 302 ? null : r.body, { status: r.status, headers });
  };
  return { base, site, home, state, sessionCookie, fetch };
}

export type FakeSis = ReturnType<typeof fakeSis>;
