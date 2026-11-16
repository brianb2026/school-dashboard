import { inflateRawSync } from "node:zlib";
import { decodeEntities } from "@sd/core";
import { extractText } from "./extract-text.js";

const MAX_ENTRY = 20 * 1024 * 1024;
const MAX_ENTRIES = 3000;

/**
 * Just enough of a .zip reader to pull text out of a PowerPoint file:
 * the central directory, then stored or deflated entries. Sizes are capped,
 * so a hostile file can't blow up memory.
 */
export function unzip(bytes: Uint8Array, want: (name: string) => boolean): Map<string, Uint8Array> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < Math.min(count, MAX_ENTRIES) && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    if (!want(name) || local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, Math.min(buf.length, start + size));
    if (method === 0) out.set(name, new Uint8Array(data));
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_ENTRY })));
  }
  return out;
}

/** A PowerPoint deck's words, one string per slide, in slide order. */
export function pptxSlides(bytes: Uint8Array): string[] {
  const files = unzip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return [...files.entries()]
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a[0])![1]) - Number(/(\d+)\.xml$/.exec(b[0])![1]))
    .map(([, xml]) => {
      const text = new TextDecoder().decode(xml);
      // Each paragraph on its own line; the words live in <a:t> runs.
      return text
        .split(/<\/a:p>/)
        .map((para) => [...para.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeEntities(m[1]!)).join(""))
        .filter((l) => l.trim())
        .join("\n");
    });
}

/**
 * A file's words for searching: PDFs page by page, PowerPoint slide by
 * slide, Word and text files as one page. Undefined for kinds with no text
 * to read here (images, spreadsheets, video).
 */
export async function extractPages(bytes: Uint8Array, filename: string): Promise<string[] | undefined> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") {
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(bytes.slice());
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 600); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push((content.items as { str?: string; hasEOL?: boolean }[]).map((i) => `${i.str ?? ""}${i.hasEOL ? "\n" : " "}`).join("").replace(/[ \t]+/g, " ").trim());
    }
    return pages;
  }
  if (ext === "pptx") return pptxSlides(bytes);
  if (ext === "docx" || ext === "txt" || ext === "md") return [(await extractText(bytes, filename)).replace(/ \| /g, "  ").replace(/ ¶ /g, "\n")];
  return undefined;
}
