import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SecretStore } from "@sd/connectors";

/**
 * Where sign-in tokens and session cookies live.
 *
 * They are kept in one file, encrypted with AES-256-GCM. The 32-byte key is
 * stored in the macOS login Keychain (service "school-dashboard"), so the file
 * alone is useless to anything that copies it, and nothing secret is ever in
 * .env, the database, or git. Passwords are never stored at all: you type
 * them on the real sign-in page.
 */
export interface KeyProvider {
  getKey(): Promise<Buffer>;
  /** Forget the key (used by "wipe my data"). */
  destroy(): Promise<void>;
}

function security(args: string[], stdin?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.on("error", () => resolve({ code: 1, stdout: "" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.stdin.end(stdin ?? "");
  });
}

/** Key in the macOS login Keychain. The key is handed to `security` on stdin, never on the command line. */
export function keychainKey(service = "school-dashboard", account = "vault-key"): KeyProvider {
  let cached: Buffer | undefined;
  const read = async (): Promise<Buffer | undefined> => {
    const r = await security(["find-generic-password", "-s", service, "-a", account, "-w"]);
    const key = r.code === 0 ? Buffer.from(r.stdout.trim(), "base64") : undefined;
    return key?.length === 32 ? key : undefined;
  };
  return {
    async getKey() {
      if (cached) return cached;
      cached = await read();
      if (cached) return cached;
      const fresh = randomBytes(32);
      // Interactive mode reads the command from stdin, so the key never shows up in `ps`.
      await security(["-i"], `add-generic-password -U -s "${service}" -a "${account}" -w "${fresh.toString("base64")}"\n`);
      cached = await read();
      if (!cached || !cached.equals(fresh)) throw new Error("Could not save the encryption key to the macOS Keychain.");
      return cached;
    },
    async destroy() {
      cached = undefined;
      await security(["delete-generic-password", "-s", service, "-a", account]);
    },
  };
}

/** Fallback for systems without a keychain: a key file only you can read. Weaker, and said so in docs/privacy.md. */
export function fileKey(path: string): KeyProvider {
  return {
    async getKey() {
      if (existsSync(path)) {
        const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
        if (key.length === 32) return key;
      }
      const fresh = randomBytes(32);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, fresh.toString("base64"), { mode: 0o600 });
      return fresh;
    },
    async destroy() {
      rmSync(path, { force: true });
    },
  };
}

/** For tests. */
export function memoryKey(): KeyProvider {
  let key = randomBytes(32);
  return {
    getKey: async () => key,
    destroy: async () => {
      key = randomBytes(32);
    },
  };
}

interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export class Vault implements SecretStore {
  private cache?: Record<string, string>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly keys: KeyProvider,
  ) {}

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    if (!existsSync(this.file)) return (this.cache = {});
    try {
      const sealed = JSON.parse(readFileSync(this.file, "utf8")) as Sealed;
      const d = createDecipheriv("aes-256-gcm", await this.keys.getKey(), Buffer.from(sealed.iv, "base64"));
      d.setAuthTag(Buffer.from(sealed.tag, "base64"));
      const plain = Buffer.concat([d.update(Buffer.from(sealed.data, "base64")), d.final()]).toString("utf8");
      this.cache = JSON.parse(plain) as Record<string, string>;
    } catch {
      // Wrong key or damaged file: set it aside and start empty (you just sign in again).
      renameSync(this.file, `${this.file}.unreadable`);
      this.cache = {};
    }
    return this.cache;
  }

  private async save(): Promise<void> {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", await this.keys.getKey(), iv);
    const data = Buffer.concat([c.update(JSON.stringify(this.cache ?? {}), "utf8"), c.final()]);
    const sealed: Sealed = { v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(sealed), { mode: 0o600 });
    renameSync(tmp, this.file);
    chmodSync(this.file, 0o600);
  }

  /** One change at a time, so two saves can't interleave. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  get(key: string): Promise<string | undefined> {
    return this.locked(async () => (await this.load())[key]);
  }

  set(key: string, value: string): Promise<void> {
    return this.locked(async () => {
      const all = await this.load();
      if (all[key] === value) return;
      all[key] = value;
      await this.save();
    });
  }

  delete(key: string): Promise<void> {
    return this.locked(async () => {
      const all = await this.load();
      if (!(key in all)) return;
      delete all[key];
      await this.save();
    });
  }

  /** Remove every secret and the key itself. */
  wipe(): Promise<void> {
    return this.locked(async () => {
      this.cache = {};
      rmSync(this.file, { force: true });
      rmSync(`${this.file}.unreadable`, { force: true });
      await this.keys.destroy();
    });
  }
}
