/**
 * Try the whole thing with no real account: a pretend Blackboard on this Mac
 * (made-up classes and grades) plus the dashboard pointed at a throwaway data
 * folder. Nothing here touches your real data, your Keychain, or any school.
 *
 *   npm run demo
 *   → in the dashboard, enter  http://127.0.0.1:5999  as the Blackboard address and press Link.
 */
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBlackboard } from "../packages/connectors/test/fake-blackboard.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const BB_PORT = 5999;
const bb = fakeBlackboard({ base: `http://127.0.0.1:${BB_PORT}` });
bb.state.sessionValid = false; // you "sign in" on the pretend sign-in page

createServer((req, res) => {
  const url = new URL(req.url ?? "/", bb.base);
  const r = bb.respond(req.method ?? "GET", url, String(req.headers.cookie ?? ""));
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of r.headers) headers[k] = k in headers ? [...[headers[k]!].flat(), v] : v;
  res.writeHead(r.status, headers);
  res.end(typeof r.body === "string" ? r.body : Buffer.from(r.body));
}).listen(BB_PORT, "127.0.0.1", () => console.log(`Pretend Blackboard is at ${bb.base}`));

const dataDir = resolve(root, ".demo-data");
if (!process.argv.includes("--keep")) rmSync(dataDir, { recursive: true, force: true });
process.env.DATA_DIR = dataDir;
process.env.PORT = process.env.PORT ?? "5180";
process.env.VAULT_KEY = "file"; // keep the demo out of your Keychain
process.env.OPEN_BROWSER = process.env.OPEN_BROWSER ?? "1";
console.log(`Demo data goes in ${dataDir} (deleted on the next demo run).`);
console.log(`In the dashboard, use  ${bb.base}  as the Blackboard address.`);
await import("../apps/server/src/index.js");
