import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Vault, fileKey, memoryKey } from "../src/secrets/vault.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sd-vault-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("secret vault", () => {
  it("keeps secrets encrypted on disk, readable only with the key", async () => {
    const file = join(dir, "secrets.enc");
    const keys = memoryKey();
    const v = new Vault(file, keys);
    expect(await v.get("a")).toBeUndefined();
    await v.set("blackboard.session.cookies", '[{"name":"BbRouter","value":"super-secret-session"}]');
    await v.set("gmail.refresh_token", "1//refresh-token-value");
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("super-secret-session");
    expect(raw).not.toContain("refresh-token-value");
    expect(raw).not.toContain("BbRouter");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o077).toBe(0);

    // A second instance with the same key reads it back; saves don't reuse the IV.
    const again = new Vault(file, keys);
    expect(await again.get("gmail.refresh_token")).toBe("1//refresh-token-value");
    const iv1 = (JSON.parse(raw) as { iv: string }).iv;
    await again.set("x", "y");
    expect((JSON.parse(readFileSync(file, "utf8")) as { iv: string }).iv).not.toBe(iv1);
    await again.delete("x");
    expect(await again.get("x")).toBeUndefined();
  });

  it("starts empty (and sets the old file aside) when the key is wrong or the file was tampered with", async () => {
    const file = join(dir, "secrets.enc");
    await new Vault(file, memoryKey()).set("k", "v");
    const other = new Vault(file, memoryKey());
    expect(await other.get("k")).toBeUndefined();
    await other.set("k2", "v2");
    expect(await new Vault(file, memoryKey()).get("k2")).toBeUndefined();

    const keys = memoryKey();
    await new Vault(file, keys).set("k", "v");
    const sealed = JSON.parse(readFileSync(file, "utf8")) as { data: string };
    const flipped = Buffer.from(sealed.data, "base64");
    flipped[0] = flipped[0]! ^ 1;
    writeFileSync(file, JSON.stringify({ ...sealed, data: flipped.toString("base64") }));
    expect(await new Vault(file, keys).get("k")).toBeUndefined(); // GCM tag catches the change
  });

  it("serializes concurrent writes and wipes cleanly", async () => {
    const file = join(dir, "secrets.enc");
    const keyPath = join(dir, ".vault-key");
    const v = new Vault(file, fileKey(keyPath));
    await Promise.all(Array.from({ length: 20 }, (_, i) => v.set(`k${i}`, `v${i}`)));
    const back = new Vault(file, fileKey(keyPath));
    expect(await back.get("k0")).toBe("v0");
    expect(await back.get("k19")).toBe("v19");
    if (process.platform !== "win32") expect(statSync(keyPath).mode & 0o077).toBe(0);
    await back.wipe();
    expect(() => statSync(file)).toThrow();
    expect(() => statSync(keyPath)).toThrow();
    expect(await back.get("k0")).toBeUndefined();
  });
});
