import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ProfileInfo } from "@sd/core";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

/**
 * Profiles: separate people (or schools) on one Mac. Each has its own data
 * folder (database, cached files, sign-in browser) and its own encrypted
 * sign-ins with its own key, so nothing is shared between them.
 *
 * The first profile, "main", is the original data folder itself, so
 * existing data keeps working untouched. Others live in <data>/profiles/<id>.
 */
export const MAIN = "main";
const ID = /^p-[a-z0-9]{6,12}$/;

export function profileDir(root: string, id: string): string {
  return id === MAIN ? root : join(root, "profiles", id);
}

export function profileIds(root: string): string[] {
  const dir = join(root, "profiles");
  let others: string[] = [];
  try {
    others = readdirSync(dir)
      .filter((n) => ID.test(n) && statSync(join(dir, n)).isDirectory())
      .sort((a, b) => statSync(join(dir, a)).birthtimeMs - statSync(join(dir, b)).birthtimeMs);
  } catch {
    /* no other profiles yet */
  }
  return [MAIN, ...others];
}

export function isProfile(root: string, id: string): boolean {
  return profileIds(root).includes(id);
}

export function newProfile(root: string): string {
  let id: string;
  do id = `p-${randomBytes(6).toString("hex").slice(0, 8)}`;
  while (existsSync(profileDir(root, id)));
  mkdirSync(profileDir(root, id), { recursive: true, mode: 0o700 });
  return id;
}

/** Each profile's Keychain entry is its own, so deleting one profile's data never locks another's. */
export function vaultAccount(id: string): string {
  return id === MAIN ? "vault-key" : `vault-key:${id}`;
}

/** Which profile the server opens on start (the last one used). */
export function readActive(root: string): string {
  try {
    const id = readFileSync(join(root, "active-profile"), "utf8").trim();
    return isProfile(root, id) ? id : MAIN;
  } catch {
    return MAIN;
  }
}

export function writeActive(root: string, id: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "active-profile"), id, { mode: 0o600 });
}

/**
 * What the sign-in screen shows for a profile: whose it is and which school,
 * read straight from that profile's own settings (read-only, no secrets).
 */
export function profileMeta(root: string, id: string): Omit<ProfileInfo, "active"> {
  const file = join(profileDir(root, id), "school.sqlite");
  if (!existsSync(file)) return { id };
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('STUDENT_NAME', 'CANVAS_BASE_URL', 'BLACKBOARD_BASE_URL', 'SCHOOL_PRESET')").all();
    const s = Object.fromEntries(rows.map((r) => [String(r.key), String(r.value)]));
    const base = s.CANVAS_BASE_URL || s.BLACKBOARD_BASE_URL;
    let host: string | undefined;
    try {
      host = base ? new URL(base).host : undefined;
    } catch {
      host = undefined;
    }
    return { id, ...(s.STUDENT_NAME ? { name: s.STUDENT_NAME } : {}), ...(host ? { host } : {}), ...(s.CANVAS_BASE_URL ? { lms: "canvas" as const } : s.BLACKBOARD_BASE_URL ? { lms: "blackboard" as const } : {}) };
  } catch {
    return { id };
  } finally {
    db?.close();
  }
}

/** What the server running one profile can ask of whatever runs the profiles (index.ts). */
export interface ProfileHost {
  active(): string;
  list(): ProfileInfo[];
  create(): string;
  /** Close this profile and open another a moment after the answer has gone out. */
  switchTo(id: string): void;
}

export function listProfiles(root: string, active: string): ProfileInfo[] {
  return profileIds(root).map((id) => ({ ...profileMeta(root, id), active: id === active }));
}
