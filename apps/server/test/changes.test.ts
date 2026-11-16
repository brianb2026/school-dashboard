import { afterEach, describe, expect, it } from "vitest";
import { rig, type Rig } from "./helpers.js";

let r: Rig;
afterEach(async () => {
  await r?.app.close();
});

const sync = () => r.app.inject({ method: "POST", url: "/api/sync", payload: {} });

describe("What changed", () => {
  it("says nothing about what already existed when you link, then notes new grades, moved deadlines and announcements", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    await sync();
    expect((await r.dashboard()).changes).toEqual([]);

    // The instructor grades Homework 2 and moves Homework 2's due date out two days.
    r.bb.state.lateGrade = true;
    const hw2 = (await r.dashboard()).assignments.find((a) => a.title === "Homework 2")!;
    const newDue = new Date(Date.parse(hw2.dueAt!) + 2 * 86_400_000).toISOString();
    r.bb.state.moved.set("_c2_1", newDue);
    r.pings.length = 0;
    await sync();

    const d = await r.dashboard();
    const kinds = d.changes.map((c) => [c.kind, c.title]);
    expect(kinds).toContainEqual(["grade", "Homework 2"]);
    expect(kinds).toContainEqual(["due-moved", "Homework 2"]);
    const moved = d.changes.find((c) => c.kind === "due-moved")!;
    expect(Date.parse(moved.to!)).toBe(Date.parse(newDue));
    expect(Date.parse(moved.from!)).toBe(Date.parse(hw2.dueAt!));
    expect(moved.seen).toBe(false);
    // The assignment itself carries where its deadline was.
    expect(Date.parse(d.assignments.find((a) => a.title === "Homework 2")!.movedFrom!)).toBe(Date.parse(hw2.dueAt!));
    // A moved deadline gets its own ping, once.
    expect(r.pings.filter((p) => p.title.startsWith("Deadline moved"))).toHaveLength(1);
    await sync();
    expect(r.pings.filter((p) => p.title.startsWith("Deadline moved"))).toHaveLength(1);

    // "Got it" marks them seen.
    const top = Math.max(...d.changes.map((c) => c.id));
    expect((await r.app.inject({ method: "POST", url: "/api/changes/seen", payload: { upTo: top } })).statusCode).toBe(200);
    expect((await r.dashboard()).changes.every((c) => c.seen)).toBe(true);
  });
});

describe("Morning brief", () => {
  it("comes once a day at the chosen time, with today's classes and what's due, and can be moved or turned off", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    const sync = r.app.ctx.sync;
    // 7:00 in the school's time zone (New York): too early.
    expect(await sync.maybeBrief(new Date("2027-03-01T12:00:00Z"))).toBe(false);
    r.pings.length = 0;
    // 8:05: sent, once.
    expect(await sync.maybeBrief(new Date("2027-03-01T13:05:00Z"))).toBe(true);
    expect(await sync.maybeBrief(new Date("2027-03-01T13:30:00Z"))).toBe(false);
    const brief = r.pings.find((p) => p.title.startsWith("Good morning"))!;
    expect(brief.title).toBe("Good morning · Monday, Mar 1");
    expect(brief.body).toMatch(/Classes|No classes today/);
    expect(brief.body).toMatch(/Due today|Nothing due today/);

    // Later the next day, after a wake from sleep: still sent (before 6 PM).
    expect(await sync.maybeBrief(new Date("2027-03-02T19:00:00Z"))).toBe(true);
    // Moved to 9:30, then off.
    await r.app.inject({ method: "PUT", url: "/api/brief", payload: { time: "09:30" } });
    expect(await sync.maybeBrief(new Date("2027-03-03T14:00:00Z"))).toBe(false);
    expect(await sync.maybeBrief(new Date("2027-03-03T14:45:00Z"))).toBe(true);
    await r.app.inject({ method: "PUT", url: "/api/brief", payload: { time: "off" } });
    expect(await sync.maybeBrief(new Date("2027-03-04T15:00:00Z"))).toBe(false);
    expect((await r.app.inject({ method: "PUT", url: "/api/brief", payload: { time: "25:00" } })).statusCode).toBe(400);
    expect(((await r.app.inject({ url: "/api/brief" })).json() as { time: string }).time).toBe("off");
  });
});

describe("Menu bar summary", () => {
  it("gives the menu bar item its next deadline, the ones after it, today's classes and what's new", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    const res = await r.app.inject({ url: "/api/menubar" });
    expect(res.statusCode).toBe(200);
    const m = res.json() as { title: string; upcoming: { title: string; course: string; when: string; left: string }[]; classes: unknown[]; changes: number; holds: number };
    expect(m.upcoming.length).toBeGreaterThan(0);
    const first = m.upcoming[0]!;
    expect(m.title).toBe(`${first.title.length > 18 ? `${first.title.slice(0, 17)}…` : first.title} · ${first.left}`);
    expect(first.left).toMatch(/^\d+[mhd]$/);
    expect(first.course).toMatch(/^[A-Z]+ \d+/);
    expect(Array.isArray(m.classes)).toBe(true);
    expect(m.changes).toBe(0);
  });
});
