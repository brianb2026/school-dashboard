import { decodeEntities } from "@sd/core";

/**
 * Turn an uploaded syllabus into plain text, one visual line per line.
 * Runs fully locally:
 *   PDF  → pdf.js (via unpdf), lines rebuilt from text positions
 *   DOCX → mammoth; tables keep their shape (see CELL / PARA below)
 *   TXT/MD → as is
 * Scanned (image-only) PDFs return almost no text; the UI then says so and
 * lets you type the weights and dates in.
 */
export async function extractText(bytes: Uint8Array, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();
  // pdf.js takes over the buffer it is given, so hand it a copy.
  if (ext === "pdf") return pdfText(bytes.slice());
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    return docxHtmlToText(value);
  }
  if (ext === "txt" || ext === "md") return new TextDecoder().decode(bytes);
  throw new Error(`Unsupported syllabus format: .${ext} (use PDF, DOCX, TXT or MD)`);
}

/** Separates table cells on one row. */
export const CELL = " | ";
/** Separates paragraphs inside one table cell. */
export const PARA = " ¶ ";

/** A web link keeps its address after its words, so a "watch this video" row can be opened later. */
function keepLinks(html: string): string {
  return html.replace(/<a\b[^>]*\bhref="(https?:\/\/[^"\s]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) =>
    inner.includes("://") ? inner : `${inner} (${href})`,
  );
}

function plain(html: string): string {
  html = keepLinks(html);
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/[ \t ]+/g, " ").trim();
}
/**
 * Word → text. Paragraphs become lines. A table row becomes ONE line, cells
 * joined by " | " and paragraphs within a cell by " ¶ ", so a schedule table
 * still reads "9/3 | topic | … | Journal #1 due ¶ Johnson, “…” (pg. 157-172)".
 */
export function docxHtmlToText(html: string): string {
  const out: string[] = [];
  const blocks = (s: string): string[] =>
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .split(/<\/(?:p|h[1-6]|li)>/i)
      .flatMap((b) => plain(b.replace(/\n/g, " ")).split("\n"))
      .map((x) => x.trim())
      .filter(Boolean);
  let rest = html;
  for (;;) {
    const start = rest.search(/<table\b/i);
    if (start < 0) break;
    out.push(...blocks(rest.slice(0, start)));
    const end = rest.indexOf("</table>", start);
    const table = rest.slice(start, end < 0 ? undefined : end);
    for (const row of table.split(/<\/tr>/i)) {
      const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => blocks(m[1]!).join(PARA));
      if (cells.some(Boolean)) out.push(cells.join(CELL));
    }
    rest = end < 0 ? "" : rest.slice(end + "</table>".length);
  }
  out.push(...blocks(rest));
  return out.join("\n");
}

interface PdfItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** A text run placed on the page. */
export interface PlacedText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Group text runs into lines by their baseline, left to right. pdf.js's own
 * text join drops line breaks, which breaks every line-based rule.
 * A wide horizontal gap becomes two spaces so "Labs      20%" stays apart.
 */
export function linesFromPlacedText(items: PlacedText[]): string[] {
  const runs = items.filter((i) => i.str.trim() !== "");
  const lines: { y: number; h: number; parts: PlacedText[] }[] = [];
  for (const it of [...runs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tol = Math.max(2, (it.height || 10) * 0.4);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.parts.push(it);
    else lines.push({ y: it.y, h: it.height, parts: [it] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const parts = l.parts.sort((a, b) => a.x - b.x);
      let out = "";
      let end = -Infinity;
      for (const p of parts) {
        if (out) {
          const gap = p.x - end;
          const charW = (p.height || 10) * 0.5;
          out += gap > charW * 2 ? "  " : gap > charW * 0.15 && !out.endsWith(" ") && !p.str.startsWith(" ") ? " " : "";
        }
        out += p.str;
        end = p.x + p.width;
      }
      return out.replace(/\s+$/, "");
    });
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const placed = (content.items as unknown as PdfItem[])
      .filter((i) => typeof i.str === "string")
      .map((i) => ({ str: i.str, x: i.transform[4] ?? 0, y: i.transform[5] ?? 0, width: i.width, height: i.height || Math.abs(i.transform[3] ?? 10) }));
    pages.push(linesFromPlacedText(placed).join("\n"));
  }
  return pages.join("\n\n");
}
