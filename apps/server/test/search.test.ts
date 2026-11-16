import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { CourseFile } from "@sd/core";
import { pptxSlides } from "@sd/syllabus-parser";
import { saveSync } from "../src/db/client.js";
import { indexSome, indexStatus, searchFiles } from "../src/search/index.js";
import { rig, type Rig } from "./helpers.js";

let r: Rig;
afterEach(async () => {
  await r?.app.close();
});

/** A minimal .pptx: a zip (stored, no compression) with one XML file per slide. */
function pptx(slides: string[]): Uint8Array {
  const enc = new TextEncoder();
  const entries = slides.map((text, i) => ({
    name: enc.encode(`ppt/slides/slide${i + 1}.xml`),
    data: enc.encode(`<p:sld><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sld>`),
  }));
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(e.name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(e.name.length, 28);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, e.name, e.data);
    central.push(cd, e.name);
    offset += 30 + e.name.length + e.data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

const file = (id: string, courseId: string, name: string, modified = "1"): CourseFile => ({ id, courseId, name, folder: [], url: "", isSyllabus: false, modified, source: { source: "manual", fetchedAt: "" } });

describe("Search inside files", () => {
  it("reads PowerPoint slides in order", () => {
    expect(pptxSlides(pptx(["Intro &amp; goals", "Amortized analysis"]))).toEqual(["Intro & goals", "Amortized analysis"]);
  });

  it("indexes PDFs by page, slides by slide, and text files; finds words by their start; respects hidden classes and changes", async () => {
    r = rig();
    await r.link({ baseUrl: "learn.fake-school.test" });
    const db = r.app.ctx.db;
    const [chem, csc] = (await r.dashboard()).courses;
    const bytes: Record<string, Uint8Array> = {
      deck: pptx(["Arrays and lists", "Amortized analysis of dynamic arrays"]),
      notes: new TextEncoder().encode("Heap sort notes: build a max heap, then pop."),
      syl: new Uint8Array(readFileSync(new URL("../../../packages/syllabus-parser/test/fixtures/chem101.pdf", import.meta.url))),
      pic: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    };
    saveSync(db, {
      files: [file("deck", csc!.id, "Lecture 7.pptx"), file("notes", csc!.id, "notes.txt"), file("syl", chem!.id, "CHEM101 Syllabus.pdf"), file("pic", csc!.id, "diagram.png")],
      authoritative: { files: ["bbfile:"] },
    });
    const load = async (_c: unknown, f: CourseFile) => bytes[f.id]!;
    expect(await indexSome(r.app.ctx, 25, 0, load)).toBe(3); // the image isn't read
    const all = new Set([chem!.id, csc!.id]);

    const amort = searchFiles(db, "amortiz", all);
    expect(amort).toEqual([{ fileId: "deck", name: "Lecture 7.pptx", courseId: csc!.id, page: 2, snippet: expect.stringContaining("[[Amortized]]") }]);
    expect(searchFiles(db, "heap", all).map((h) => h.fileId)).toEqual(["notes"]);
    // A PDF hit says which page.
    const midterm = searchFiles(db, "midterm exam", all);
    expect(midterm[0]).toMatchObject({ fileId: "syl", page: 1 });
    // Every word must match; a class you hid is left out.
    expect(searchFiles(db, "heap amortized", all)).toEqual([]);
    expect(searchFiles(db, "amortized", new Set([chem!.id]))).toEqual([]);
    expect(indexStatus(db)).toEqual({ indexed: 3, readable: 3, on: true });

    // Nothing to do until a file changes; a changed file is read again; a removed one is forgotten.
    expect(await indexSome(r.app.ctx, 25, 0, load)).toBe(0);
    bytes.notes = new TextEncoder().encode("Trie insertion and lookup.");
    saveSync(db, { files: [file("deck", csc!.id, "Lecture 7.pptx"), file("notes", csc!.id, "notes.txt", "2"), file("syl", chem!.id, "CHEM101 Syllabus.pdf")], authoritative: { files: [""] } });
    expect(await indexSome(r.app.ctx, 25, 0, load)).toBe(1);
    expect(searchFiles(db, "heap", all)).toEqual([]);
    expect(searchFiles(db, "trie", all).map((h) => h.fileId)).toEqual(["notes"]);

    // Turned off: the index is emptied.
    await r.app.inject({ method: "PUT", url: "/api/search", payload: { on: false } });
    expect(searchFiles(db, "trie", all)).toEqual([]);
    expect(await indexSome(r.app.ctx, 25, 0, load)).toBe(0);
  });
});
