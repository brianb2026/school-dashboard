import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { providerFromEnv } from "@sd/ai";
import { AuthExpiredError, buildMime, composeLink, connectorById, gmail, gmailBody } from "@sd/connectors";
import type { OutgoingMessage } from "@sd/core";
import type { AppContext } from "../app.js";
import { getFile, markAnnouncementRead, setSetting } from "../db/client.js";
import { EXPIRED_FLAG } from "../sync/scheduler.js";

function cleanMessage(b: Partial<OutgoingMessage> | undefined): OutgoingMessage {
  return {
    to: (Array.isArray(b?.to) ? b!.to : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 10),
    subject: String(b?.subject ?? "").slice(0, 300),
    body: String(b?.body ?? "").slice(0, 20_000),
    threadId: typeof b?.threadId === "string" ? b.threadId : undefined,
  };
}

export function inboxRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, sync } = ctx;

  app.post<{ Params: { id: string }; Body: { read?: boolean } }>("/api/announcements/:id/read", async (req, reply) => {
    if (!markAnnouncementRead(db, req.params.id, req.body?.read !== false)) return reply.code(404).send({ error: "No such announcement." });
    return { ok: true };
  });

  /** The text of one email, fetched from Gmail only when you open it. */
  app.get<{ Params: { id: string } }>("/api/messages/:id/body", async (req, reply) => {
    const id = req.params.id.replace(/^gmail:/, "");
    try {
      return { body: await gmailBody(sync.context(), id) };
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        setSetting(db, EXPIRED_FLAG.gmail!, "true");
        return reply.code(409).send({ error: "Gmail sign-in expired. Connect Gmail again in Settings." });
      }
      return reply.code(502).send({ error: "Could not load that message from Gmail." });
    }
  });

  /**
   * Write to a professor. With Gmail connected the message is sent from your
   * account when you press Send. Without it you get a filled-in Gmail compose
   * link, and you press Send in Gmail yourself.
   */
  app.post<{ Body: Partial<OutgoingMessage> }>("/api/messages/send", async (req, reply) => {
    const msg = cleanMessage(req.body);
    try {
      buildMime(msg); // validates address, subject, body
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const c = sync.context();
    if ((await gmail.status(c)).state !== "ready") return { sent: false, composeUrl: composeLink(msg) };
    try {
      await gmail.sendMessage!(c, msg);
      return { sent: true };
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        setSetting(db, EXPIRED_FLAG.gmail!, "true");
        return { sent: false, composeUrl: composeLink(msg) };
      }
      return reply.code(502).send({ error: "Gmail did not accept the message. Nothing was sent." });
    }
  });

  /** Optional AI summary of one piece of text you clicked on. Off unless AI_PROVIDER is set. */
  app.post<{ Body: { text?: string } }>("/api/ai/summarize", async (req, reply) => {
    const text = String(req.body?.text ?? "").trim().slice(0, 20_000);
    if (!text) return reply.code(400).send({ error: "Nothing to summarize." });
    const provider = providerFromEnv(sync.env());
    if (provider.name === "none") return reply.code(400).send({ error: "AI is off. Set AI_PROVIDER in .env to turn it on." });
    try {
      return { summary: await provider.summarize(text, { maxWords: 60 }) };
    } catch {
      return reply.code(502).send({ error: "The AI provider did not answer." });
    }
  });

  /**
   * Download a course file through the linked sign-in. Kept on disk afterwards
   * so it opens offline. Always sent as a download, never rendered in the page.
   */
  app.get<{ Params: { id: string } }>("/api/files/:id/download", async (req, reply) => {
    const file = getFile(db, req.params.id);
    if (!file) return reply.code(404).send({ error: "No such file." });
    const dir = ctx.dataDir ? join(ctx.dataDir, "files") : undefined;
    // The cache name is a hash, so nothing in a file's name or id can point outside the folder.
    const cached = dir ? join(dir, createHash("sha256").update(`${file.id}@${file.modified ?? ""}`).digest("hex")) : undefined;
    let bytes: Uint8Array;
    if (cached && existsSync(cached)) bytes = readFileSync(cached);
    else {
      const connector = connectorById(file.source.source);
      if (!connector?.download) return reply.code(400).send({ error: "This file can't be downloaded from here." });
      try {
        ({ bytes } = await connector.download(sync.context(), file));
      } catch (e) {
        if (e instanceof AuthExpiredError) {
          const flag = EXPIRED_FLAG[connector.id];
          if (flag) setSetting(db, flag, "true");
          return reply.code(409).send({ error: "Blackboard sign-in expired. Reconnect, then try again." });
        }
        return reply.code(502).send({ error: "Blackboard did not hand over that file." });
      }
      if (cached && dir) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(cached, bytes, { mode: 0o600 });
        chmodSync(cached, 0o600);
      }
    }
    const name = file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 150) || "file";
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType ?? "") && !/html|javascript|svg|xml/i.test(file.mimeType!) ? file.mimeType! : "application/octet-stream";
    return reply
      .header("content-type", type)
      .header("content-disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(Buffer.from(bytes));
  });
}
