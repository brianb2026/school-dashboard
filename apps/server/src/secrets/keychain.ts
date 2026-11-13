import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretStore } from "@sd/connectors";

const run = promisify(execFile);
const SERVICE = "school-dashboard";

/**
 * OAuth refresh tokens and session cookies live in the macOS login Keychain
 * (service "school-dashboard"), never in .env, the database, or git.
 * Uses the built-in `security` tool, so there is no native dependency.
 * Passwords are never stored at all: you type them on the real sign-in page.
 */
export const keychain: SecretStore = {
  async get(key) {
    try {
      const { stdout } = await run("security", ["find-generic-password", "-s", SERVICE, "-a", key, "-w"]);
      return stdout.replace(/\n$/, "");
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    // -U updates if it already exists. Note: the value is passed as an argument,
    // which is briefly visible to local processes; acceptable for a single-user Mac.
    await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", key, "-w", value]);
  },
  async delete(key) {
    await run("security", ["delete-generic-password", "-s", SERVICE, "-a", key]).catch(() => undefined);
  },
};
