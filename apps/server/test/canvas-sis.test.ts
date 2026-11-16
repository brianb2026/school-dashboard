import { afterEach, describe, expect, it } from "vitest";
import { CANVAS_COOKIES, SIS_COOKIES } from "@sd/connectors";
import type { LinkStatus, SessionInfo, SignInResult } from "@sd/core";
import { rig, waitFor, type Rig } from "./helpers.js";

let r: Rig;
afterEach(async () => {
  await r?.app.close();
});

const status = async () => (await r.app.inject({ url: "/api/link/status" })).json() as LinkStatus;

describe("A UVA student: Canvas, then the SIS", () => {
  it("repairs a profile saved with UVA's Canvas information site instead of Canvas", async () => {
    const { openDb, setSetting, getSetting } = await import("../src/db/client.js");
    const db = openDb(":memory:");
    setSetting(db, "CANVAS_BASE_URL", "https://canvas.virginia.edu");
    setSetting(db, "SCHOOL_PRESET", "uva");
    r = rig({ db });
    expect(getSetting(db, "CANVAS_BASE_URL")).toBe("https://canvas.its.virginia.edu");
    expect(getSetting(db, "SIS_START_URL")).toBe("https://sisuva.admin.virginia.edu/ihprd/signon.html");
  });

  it("one button links Canvas, then the SIS on its own, and the dashboard fills in from both", async () => {
    r = rig();
    expect((await r.app.inject({ url: "/api/schools" })).json()).toEqual([{ id: "uva", name: "University of Virginia", lms: "canvas" }]);

    const res = await r.app.inject({ method: "POST", url: "/api/link/auto", payload: { school: "uva" } });
    expect(res.statusCode).toBe(200);
    // The first window is Canvas's own sign-in page (NetBadge happens there).
    expect(r.windows[0]!.url).toBe("https://canvas.its.virginia.edu/login");

    // Canvas links and syncs; then the SIS window opens by itself and learns where the PeopleSoft pages are.
    await waitFor(async () => (r.windows.length >= 2 && (await status()).phase === "done" && (await r.dashboard()).sis ? true : undefined), 15_000);
    // The SIS window starts at UVA's SIS front door (its bare address says "access interrupted").
    expect(r.windows[1]!.url).toBe("https://sisuva.admin.virginia.edu/ihprd/signon.html");
    expect(r.secrets.data.get(CANVAS_COOKIES)).toContain("canvas_session");
    expect(r.secrets.data.get(SIS_COOKIES)).toContain("PS_TOKEN");

    const d = await r.dashboard();
    expect(d.links.canvas).toMatchObject({ linked: true, host: "canvas.its.virginia.edu", via: "session" });
    expect(d.links.sis).toMatchObject({ linked: true, host: "sisuva.admin.virginia.edu" });
    expect(d.studentName).toBe("Test");

    const cs = d.courses.find((c) => c.code === "CS 2100")!;
    // Canvas's own total wins, labeled as Canvas's.
    expect(cs.grade).toMatchObject({ basis: "blackboard", percent: 88.5, label: "Canvas “Total”" });
    // The SIS says when and where it meets (lecture and lab), and how many units it is.
    expect(cs.meetings).toEqual([
      { weekday: 1, start: "14:00", end: "15:15", location: "Rice Hall 130" },
      { weekday: 3, start: "14:00", end: "15:15", location: "Rice Hall 130" },
      { weekday: 5, start: "10:00", end: "11:50", location: "Olsson Hall 001" },
    ]);
    expect(cs.credits).toBe(4);

    // The official record: past terms with a GPA worked out from them, holds as warnings.
    expect(d.sis!.gpa).toBeCloseTo(3.63, 2);
    expect(d.sis!.terms.map((t) => t.term)).toEqual(["2026 Spring", "2026 Fall"]);
    expect(d.notices.find((n) => n.id.startsWith("hold:"))).toMatchObject({ level: "warn", action: "open-sis" });

    // Canvas pieces: announcements, the course page (modules), files for the Files tab.
    expect(d.announcements.map((a) => a.title)).toContain("Office hours moved");
    expect(d.files.map((f) => f.name)).toContain("Lab 1 handout.pdf");
    const page = (await r.app.inject({ url: `/api/courses/${encodeURIComponent(cs.id)}/contents` })).json() as { items: { title: string }[] };
    expect(page.items.map((x) => x.title)).toContain("Week 1");

    // Nothing but GETs went to Canvas or the SIS.
    expect(r.cv.state.log.every((l) => l.startsWith("GET "))).toBe(true);
    expect(r.sis.state.log.every((l) => l.startsWith("GET "))).toBe(true);
  });

  it("the sign-in screen knows it's Canvas, and Continue is one click while the saved sign-in works", async () => {
    r = rig();
    await r.app.inject({ method: "POST", url: "/api/link/auto", payload: { school: "uva" } });
    await waitFor(async () => ((await r.dashboard()).sis ? true : undefined), 15_000);
    const s = (await r.app.inject({ url: "/api/session" })).json() as SessionInfo;
    expect(s).toMatchObject({ linked: true, lms: "canvas", host: "canvas.its.virginia.edu", sis: true, name: "Test" });
    const before = r.windows.length;
    expect((await r.app.inject({ method: "POST", url: "/api/signin" })).json()).toEqual({ state: "in", name: "Test" } satisfies SignInResult);
    expect(r.windows).toHaveLength(before);
  });

  it("finds the real Canvas from an address someone types, and links with a token where a school allows it", async () => {
    r = rig();
    // Canvas answers at this address: found out by asking it.
    const res = await r.app.inject({ method: "POST", url: "/api/link/auto", payload: { baseUrl: "canvas.its.virginia.edu/courses/4101" } });
    expect(res.statusCode).toBe(200);
    expect(r.windows.at(-1)!.url).toBe("https://canvas.its.virginia.edu/login");
    await r.app.inject({ method: "POST", url: "/api/link/cancel" });
    // UVA's page *about* Canvas leads to the Canvas it means.
    await r.app.inject({ method: "POST", url: "/api/link/auto", payload: { baseUrl: "canvas.virginia.edu" } });
    expect(r.windows.at(-1)!.url).toBe("https://canvas.its.virginia.edu/login");
    await r.app.inject({ method: "POST", url: "/api/link/cancel" });
    // Somewhere no Canvas or Blackboard answers: said plainly, nothing opens.
    const before = r.windows.length;
    const nowhere = await r.app.inject({ method: "POST", url: "/api/link/auto", payload: { baseUrl: "example.org" } });
    expect(nowhere.statusCode).toBe(400);
    expect(r.windows).toHaveLength(before);

    const bad = await r.app.inject({ method: "PUT", url: "/api/link/canvas-token", payload: { baseUrl: "canvas.its.virginia.edu", token: "not-a-real-token-xxxxxxxxxx" } });
    expect(bad.statusCode).toBe(400);
    const ok = await r.app.inject({ method: "PUT", url: "/api/link/canvas-token", payload: { baseUrl: "canvas.its.virginia.edu", token: r.cv.state.token } });
    expect(ok.json()).toEqual({ ok: true });
    await waitFor(async () => ((await r.dashboard()).courses.length ? true : undefined));
    expect((await r.dashboard()).links.canvas).toMatchObject({ linked: true, via: "token" });
  });

  it("unlinking the SIS forgets its record and doesn't link it again by itself", async () => {
    r = rig();
    await r.app.inject({ method: "POST", url: "/api/link/auto", payload: { school: "uva" } });
    await waitFor(async () => ((await r.dashboard()).sis ? true : undefined), 15_000);
    expect((await r.app.inject({ method: "DELETE", url: "/api/link/sis" })).statusCode).toBe(200);
    const d = await r.dashboard();
    expect(d.sis).toBeUndefined();
    expect(d.links.sis.linked).toBe(false);
    expect(r.secrets.data.has(SIS_COOKIES)).toBe(false);
  });
});
