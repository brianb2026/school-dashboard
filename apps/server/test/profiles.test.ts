import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProfileInfo } from "@sd/core";
import { openDb, setSetting } from "../src/db/client.js";
import { MAIN, listProfiles, newProfile, profileDir, profileIds, profileMeta, readActive, vaultAccount, writeActive, type ProfileHost } from "../src/profiles.js";
import { rig, type Rig } from "./helpers.js";

let dirs: string[] = [];
let r: Rig | undefined;
afterEach(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  await r?.app.close();
  r = undefined;
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "sd-profiles-"));
  dirs.push(d);
  return d;
};

describe("Profiles on one Mac", () => {
  it("keeps the original data folder as the first profile and puts new ones beside it", () => {
    const root = temp();
    expect(profileIds(root)).toEqual([MAIN]);
    expect(profileDir(root, MAIN)).toBe(root);
    const id = newProfile(root);
    expect(id).toMatch(/^p-[a-z0-9]{8}$/);
    expect(existsSync(join(root, "profiles", id))).toBe(true);
    expect(profileIds(root)).toEqual([MAIN, id]);
    // Each profile's encrypted sign-ins use their own key; the first keeps the one it always had.
    expect(vaultAccount(MAIN)).toBe("vault-key");
    expect(vaultAccount(id)).toBe(`vault-key:${id}`);
  });

  it("remembers which profile was open last, and falls back to the first for anything unknown", () => {
    const root = temp();
    expect(readActive(root)).toBe(MAIN);
    const id = newProfile(root);
    writeActive(root, id);
    expect(readActive(root)).toBe(id);
    writeActive(root, "p-gone0000");
    expect(readActive(root)).toBe(MAIN);
  });

  it("shows whose each profile is and which school, read from that profile's own settings", () => {
    const root = temp();
    const db = openDb(root);
    setSetting(db, "STUDENT_NAME", "Sam");
    setSetting(db, "BLACKBOARD_BASE_URL", "https://learn.fake-school.test");
    const other = newProfile(root);
    const db2 = openDb(profileDir(root, other));
    setSetting(db2, "STUDENT_NAME", "Ava");
    setSetting(db2, "CANVAS_BASE_URL", "https://canvas.virginia.edu");
    db.close();
    db2.close();
    const fresh = newProfile(root);
    expect(listProfiles(root, other)).toEqual([
      { id: MAIN, name: "Sam", host: "learn.fake-school.test", lms: "blackboard", active: false },
      { id: other, name: "Ava", host: "canvas.virginia.edu", lms: "canvas", active: true },
      { id: fresh, active: false },
    ]);
    expect(profileMeta(root, "p-nothere")).toEqual({ id: "p-nothere" });
  });

  it("lets the sign-in screen list, add and switch profiles", async () => {
    const calls: string[] = [];
    let active = "main";
    const list = (): ProfileInfo[] => [
      { id: "main", name: "Sam", active: active === "main" },
      { id: "p-abc12345", name: "Ava", active: active === "p-abc12345" },
    ];
    const host: ProfileHost = {
      active: () => active,
      list,
      create: () => {
        calls.push("create");
        return "p-new00000";
      },
      switchTo: (id) => {
        calls.push(`switch ${id}`);
        active = id;
      },
    };
    r = rig({ profiles: host });
    expect((await r.app.inject({ url: "/api/profiles" })).json()).toEqual({ active: "main", profiles: list() });
    expect((await r.app.inject({ method: "POST", url: "/api/profiles/p-abc12345/switch", payload: {} })).json()).toEqual({ id: "p-abc12345" });
    expect((await r.app.inject({ method: "POST", url: "/api/profiles/p-nope/switch", payload: {} })).statusCode).toBe(404);
    expect((await r.app.inject({ method: "POST", url: "/api/profiles", payload: {} })).json()).toEqual({ id: "p-new00000" });
    expect(calls).toEqual(["switch p-abc12345", "create", "switch p-new00000"]);
  });
});
