import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthExpiredError, connectorById } from "@sd/connectors";
import type { CourseFile } from "@sd/core";
import { extractText } from "@sd/syllabus-parser";
import type { AppContext } from "../app.js";
import { getFile, listCourses, setSetting } from "../db/client.js";
import { indexStatus, searchFiles } from "../search/index.js";
import { EXPIRED_FLAG } from "../sync/scheduler.js";

export class FileProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A course file's bytes: from the offline cache if it was opened before,
 * otherwise through the linked sign-in (and then cached).
 */
export async function loadFile(ctx: AppContext, file: CourseFile): Promise<Uint8Array> {
  const dir = ctx.dataDir ? join(ctx.dataDir, "files") : undefined;
  // The cache name is a hash, so nothing in a file's name or id can point outside the folder.
  const cached = dir ? join(dir, createHash("sha256").update(`${file.id}@${file.modified ?? ""}`).digest("hex")) : undefined;
  if (cached && existsSync(cached)) return readFileSync(cached);
  const connector = connectorById(file.source.source);
  if (!connector?.download) throw new FileProblem(400, "This file can't be opened from here.");
  let bytes: Uint8Array;
  try {
    ({ bytes } = await connector.download(ctx.sync.context(), file));
  } catch (e) {
    if (e instanceof AuthExpiredError) {
      const flag = EXPIRED_FLAG[connector.id];
      if (flag) setSetting(ctx.db, flag, "true");
      throw new FileProblem(409, "Blackboard sign-in expired. Reconnect, then try again.");
    }
    throw new FileProblem(502, "Blackboard did not hand over that file.");
  }
  if (cached && dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(cached, bytes, { mode: 0o600 });
    chmodSync(cached, 0o600);
  }
  return bytes;
}

const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
/** What the bytes really are (never trust the name or the source's label for anything shown in the page). */
function sniff(b: Uint8Array): "application/pdf" | "image/png" | "image/jpeg" | "image/gif" | undefined {
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  return undefined;
}

function safeName(file: CourseFile): string {
  return file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 150) || "file";
}

function disposition(kind: "attachment" | "inline", name: string): string {
  return `${kind}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function fileRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Search inside course files (⌘K). Only classes you can see. */
  app.get<{ Querystring: { q?: string } }>("/api/search/files", async (req) => {
    const visible = new Set(listCourses(ctx.db).filter((c) => !c.hidden).map((c) => c.id));
    return { hits: searchFiles(ctx.db, String(req.query.q ?? "").slice(0, 200), visible), ...indexStatus(ctx.db) };
  });
  app.get("/api/search/status", async () => indexStatus(ctx.db));
  /** Turn reading files for search on or off ("off" also forgets what was read). */
  app.put<{ Body: { on?: boolean } }>("/api/search", async (req) => {
    const on = req.body?.on !== false;
    setSetting(ctx.db, "FILE_SEARCH", on ? "on" : "off");
    if (!on) {
      ctx.db.exec("DELETE FROM file_search; DELETE FROM file_text;");
    } else void ctx.sync.afterRun?.().catch(() => undefined);
    return indexStatus(ctx.db);
  });

  const withFile = async (id: string, reply: FastifyReply, fn: (file: CourseFile, bytes: Uint8Array) => unknown) => {
    const file = getFile(ctx.db, id);
    if (!file) return reply.code(404).send({ error: "No such file." });
    try {
      return await fn(file, await loadFile(ctx, file));
    } catch (e) {
      if (e instanceof FileProblem) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  };

  /** Save a course file. Always sent as a download. */
  app.get<{ Params: { id: string } }>("/api/files/:id/download", (req, reply) =>
    withFile(req.params.id, reply, (file, bytes) => {
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType ?? "") && !/html|javascript|svg|xml/i.test(file.mimeType!) ? file.mimeType! : "application/octet-stream";
      return reply.header("content-type", type).header("content-disposition", disposition("attachment", safeName(file))).send(Buffer.from(bytes));
    }),
  );

  /**
   * Show a file inside the dashboard. Only real PDFs and images (checked by
   * their first bytes) are ever shown in place; everything else must be read
   * as text or downloaded. Nothing that could carry script (HTML, SVG) is.
   */
  app.get<{ Params: { id: string } }>("/api/files/:id/view", (req, reply) =>
    withFile(req.params.id, reply, (file, bytes) => {
      const type = sniff(bytes);
      if (!type) return reply.code(415).send({ error: "This kind of file can't be shown here. Download it instead." });
      return reply
        .header("content-type", type)
        .header("content-disposition", disposition("inline", safeName(file)))
        .header("x-frame-options", "SAMEORIGIN")
        .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'self'; frame-ancestors 'self'")
        .send(Buffer.from(bytes));
    }),
  );

  /** The words of a document (Word, text, PDF), for reading in place. Returned as plain text. */
  app.get<{ Params: { id: string } }>("/api/files/:id/text", (req, reply) =>
    withFile(req.params.id, reply, async (file, bytes) => {
      if (!/\.(docx|txt|md|pdf)$/i.test(file.name)) return reply.code(415).send({ error: "This kind of file can't be shown as text. Download it instead." });
      try {
        const text = await extractText(new Uint8Array(bytes), file.name);
        return { name: file.name, text: text.replace(/ \| /g, "   ").replace(/ ¶ /g, "\n").slice(0, 400_000) };
      } catch {
        return reply.code(422).send({ error: "Couldn't read that file. Download it instead." });
      }
    }),
  );
}
