/**
 * Turn an uploaded syllabus into plain text. Runs fully locally:
 *   PDF  → unpdf (pdf.js)       DOCX → mammoth       TXT/MD → as is
 * Scanned (image-only) PDFs return almost no text; the UI should then offer
 * OCR (planned, see roadmap) or the optional AI provider.
 */
export async function extractText(bytes: Uint8Array, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(bytes);
    const { text } = await pdfText(doc, { mergePages: true });
    return text;
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  }
  if (ext === "txt" || ext === "md") return new TextDecoder().decode(bytes);
  throw new Error(`Unsupported syllabus format: .${ext} (use PDF, DOCX, TXT or MD)`);
}
