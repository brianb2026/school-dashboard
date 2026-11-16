import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo, SignInResult } from "@sd/core";
import { rig, waitFor, type Rig } from "./helpers.js";

let r: Rig;
afterEach(async () => {
  await r?.app.close();
});

const signin = async () => (await r.app.inject({ method: "POST", url: "/api/signin" })).json() as SignInResult;
const session = async () => (await r.app.inject({ url: "/api/session" })).json() as SessionInfo;

describe("Sign-in screen with a saved sign-in", () => {
  it("asks to link first when nothing is saved", async () => {
    r = rig();
    expect(await session()).toMatchObject({ linked: false, hasData: false });
    expect(await signin()).toEqual({ state: "link" });
    expect(r.windows).toHaveLength(0);
  });

  it("Continue is one click while the saved sign-in works: no window, greets you by first name, syncs", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    const before = r.windows.length;
    expect(await signin()).toEqual({ state: "in", name: "Test" });
    expect(r.windows).toHaveLength(before);
    expect(await session()).toMatchObject({ name: "Test", linked: true, host: "learn.fake-school.test", hasData: true });
    expect((await r.dashboard()).studentName).toBe("Test");
  });

  it("opens the school's sign-in window only when the saved sign-in ran out and can't be renewed", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    r.bb.state.sessionValid = false;
    const before = r.windows.length;
    const res = await signin();
    expect(res.state).toBe("window");
    expect(r.windows).toHaveLength(before + 1);
    expect(r.windows.at(-1)!.url).toBe("https://learn.fake-school.test/");
    // The pretend user signs in; the window closes by itself and the session is saved again.
    await waitFor(async () => {
      const s = (await r.app.inject({ url: "/api/link/status" })).json() as { phase: string };
      return s.phase === "done" ? s : undefined;
    });
    expect(await signin()).toMatchObject({ state: "in" });
  });
});

describe("Dismissing announcements", () => {
  it("hides one for good, survives a re-sync, and can be undone", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    const first = (await r.dashboard()).announcements;
    expect(first.length).toBeGreaterThan(0);
    const id = first[0]!.id;

    expect((await r.app.inject({ method: "POST", url: `/api/announcements/${encodeURIComponent(id)}/dismiss`, payload: {} })).statusCode).toBe(200);
    expect((await r.dashboard()).announcements.map((a) => a.id)).not.toContain(id);

    await r.app.inject({ method: "POST", url: "/api/sync", payload: {} });
    expect((await r.dashboard()).announcements.map((a) => a.id)).not.toContain(id);

    await r.app.inject({ method: "POST", url: `/api/announcements/${encodeURIComponent(id)}/dismiss`, payload: { dismissed: false } });
    const back = (await r.dashboard()).announcements.find((a) => a.id === id);
    expect(back).toMatchObject({ read: true });

    expect((await r.app.inject({ method: "POST", url: "/api/announcements/nope/dismiss", payload: {} })).statusCode).toBe(404);
  });
});

describe("Course page", () => {
  it("serves each course's content tree from the last sync", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    const chem = (await r.dashboard()).courses.find((c) => c.code === "CHEM 101")!;
    const res = (await r.app.inject({ url: `/api/courses/${encodeURIComponent(chem.id)}/contents` })).json() as { items: { title: string; kind: string }[]; fetchedAt?: string };
    expect(res.fetchedAt).toBeTruthy();
    expect(res.items.map((x) => x.title)).toContain("Qwickly Attendance");
    expect((await r.app.inject({ url: "/api/courses/nope/contents" })).json()).toEqual({ items: [] });
  });
});

describe("Server version", () => {
  it("tells the page which API version it speaks, so a stale server behind a new page is noticed", async () => {
    r = rig();
    const { API_VERSION } = await import("@sd/core");
    expect((await r.app.inject({ url: "/api/health" })).json()).toEqual({ ok: true, api: API_VERSION });
  });
});
