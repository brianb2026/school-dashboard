import type { AssignmentKind } from "@sd/core";
import { CELL, PARA } from "./extract-text.js";

export interface ParsedDate {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24 h), when the syllabus gives one. */
  time?: string;
  title: string;
  kind: AssignmentKind;
  line: string;
  /** A link written next to the item (a video to watch, an article). */
  url?: string;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH = String.raw`\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`;
const NUMERIC = String.raw`(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])`;
const DAY_MS = 86_400_000;

interface Found {
  date: string;
  index: number;
  text: string;
}

interface Ctx {
  startYear: number;
  startMonth: number;
  from: number;
  to: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Every date written in a piece of text, in order. Fractions ("1/3 of a grade") and dates outside the term are ignored. */
function findDates(s: string, ctx: Ctx): Found[] {
  const out: Found[] = [];
  for (const m of s.matchAll(new RegExp(`${MONTH}|${NUMERIC}`, "gi"))) {
    let month: number;
    let day: number;
    let year: number | undefined;
    if (m[1]) {
      month = MONTHS[m[1].toLowerCase().slice(0, 3)]!;
      day = Number(m[2]);
      year = m[3] ? Number(m[3]) : undefined;
    } else {
      month = Number(m[4]);
      day = Number(m[5]);
      year = m[6] ? Number(m[6].length === 2 ? `20${m[6]}` : m[6]) : undefined;
      // "1/3 of the grade", "a 1/3-letter-grade reduction": a fraction, not a day.
      if (/^[\s-]*(of|points?|letter|grade|credit)/i.test(s.slice(m.index + m[0].length))) continue;
    }
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) continue;
    // A fall term that runs into January: months before the start month belong to the next year.
    year ??= month < ctx.startMonth ? ctx.startYear + 1 : ctx.startYear;
    const t = Date.UTC(year, month - 1, day);
    if (t < ctx.from || t > ctx.to) continue;
    out.push({ date: `${year}-${pad(month)}-${pad(day)}`, index: m.index, text: m[0] });
  }
  return out;
}

const READING = /\b(read|reading|readings|chapters?|watch|listen)\b|\bch\.?\s*\d|\bpp?\.\s*\d|\bpg\.?\s*\d|\bpages?\s+\d/i;

/** What kind of work a sentence describes, or nothing if it isn't work at all. */
function classify(s: string): AssignmentKind | undefined {
  if (/\bproject\b/i.test(s)) return "project";
  if (/\blab\s*(report|#?\d)|\blab\b.*\bdue\b/i.test(s)) return "lab";
  if (/\bquiz/i.test(s)) return "quiz";
  if (/\b(exams?|midterms?|test)\b/i.test(s) || (/\bfinal\b/i.test(s) && /\b(held|on|at)\b/i.test(s))) return "exam";
  if (/\b(paper|essay|draft|report)\b/i.test(s)) return "paper";
  if (READING.test(s)) return "reading";
  if (/\bdue\b|\bsubmit\b|\bjournal\b|\bhomework\b|\bhw\s*#?\d|\bwebwork\b|\bproblem set\b|\bworksheet\b/i.test(s)) return "homework";
  return undefined;
}

function timeIn(s: string): string | undefined {
  // "at 8", "from 8:30 am" … or a bare clock time that says am/pm ("December 17, 12:30 pm").
  const m =
    /\b(?:at|begins at|starts at|from)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(s) ??
    /(?:^|[\s,(])(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i.exec(s);
  if (!m || (!m[2] && !m[3])) return undefined;
  let h = Number(m[1]);
  const later = /\b(a\.?m\.?|p\.?m\.?)/i.exec(s.slice(m.index));
  const ap = m[3] ?? later?.[1];
  if (ap && /^p/i.test(ap) && h < 12) h += 12;
  if (ap && /^a/i.test(ap) && h === 12) h = 0;
  if (!ap && h < 8) h += 12;
  const min = Number(m[2] ?? 0);
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : undefined;
}

const REFS = /\b(?:ch(?:apter)?s?\.?|pp?\.|pg\.?|pages?)\s*\d[\d.]*(?:\s*(?:[-–]|to|and|,|&)\s*(?:ch(?:apter)?s?\.?\s*)?\d[\d.]*)*/gi;

function tidy(s: string): string {
  return s
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/^[\s:;,.\-–—|)]+|[\s:;,(\-–—|]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function titleFor(sentence: string, kind: AssignmentKind, dates: Found[]): string {
  let t = sentence;
  for (const d of dates) t = t.replace(d.text, " ");
  t = t.replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?\b\.?,?/gi, " ");
  if (kind === "reading") {
    const refs = [...sentence.matchAll(REFS)].map((m) => m[0].trim().replace(/[.,]$/, ""));
    // Textbook chapters: "Read Ch. 1.1-1.3 · Introduction". A named article ("Bunn, “How to Read…” (pg. 71-85)") keeps its own title.
    if (refs.some((r) => /^ch/i.test(r)) && !/[“”"]/.test(sentence) && !/\bp[pg]\.?\s*\d/i.test(sentence)) {
      const topic = tidy(
        (t.split(/\s{2,}/)[0] ?? "")
          .replace(REFS, " ")
          .replace(/\b(please|we will cover|we cover|read(ing)?s?|these chapters|in the textbook|before class|if possible)\b/gi, " "),
      );
      return `Read ${refs.join(", ")}${/[a-z]{3}/i.test(topic) && topic.length <= 60 ? ` · ${topic}` : ""}`;
    }
    return tidy(t.replace(/^\s*(?:please\s+)?read(?:ing)?s?\s*[:\-]?\s*/i, "")).slice(0, 160) || "Reading";
  }
  // "Midterm 1 is on Thursday…" → "Midterm 1"
  const m = /^(.{3,60}?)\s+(?:is|are|will be|takes place|held)\b/i.exec(t.trim());
  if (m && !/\b(there|it|this|that|we|you|i)\b/i.test(m[1]!)) return tidy(m[1]!);
  const seg = t
    .split(/\s{2,}|\s+[–—|]\s+/)
    .map(tidy)
    .filter((x) => /[a-z]{2}/i.test(x));
  return (seg[0] ?? kind).replace(/\s+\bdue\b.*$/i, "").slice(0, 110);
}

const LEAD = /^\s*(?:(?:week|wk|class|session|lecture|day|unit)\.?\s*(?:of\s+)?(?:#?\d+\s*)?)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*)?[([]?\s*$/i;

function fromLine(line: string, ctx: Ctx): ParsedDate[] {
  const all = findDates(line, ctx);
  let base: Found | undefined;
  let rest = line;
  if (all[0] && LEAD.test(line.slice(0, all[0].index))) {
    base = all[0];
    let cut = base.index + base.text.length;
    // "(8/31 - 9/2)": the row is for the week starting on the first date.
    const range = /^\s*(?:[-–—]|to|through)\s*/.exec(line.slice(cut));
    if (range && all[1] && all[1].index === cut + range[0].length) cut = all[1].index + all[1].text.length;
    rest = line.slice(cut).replace(/^\s*[)\]]?\s*[:\-–—]?\s*/, "");
  }
  const sentences = rest.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter((s) => s.trim());
  const out: ParsedDate[] = [];
  sentences.forEach((s, i) => {
    const kind = classify(s);
    if (!kind) return;
    const own = findDates(s, ctx);
    const words = s.trim().split(/\s+/).length;
    const time = timeIn(s) ?? (/^it\b/i.test(sentences[i + 1] ?? "") ? timeIn(sentences[i + 1]!) : undefined);
    if (own.length && !(kind === "reading" && base)) {
      // Free prose is only trusted for short, clearly dated statements.
      if (!base && words > 32) return;
      const many = (kind === "exam" || kind === "quiz") && new Set(own.map((d) => d.date)).size > 1;
      const title = titleFor(s, kind, own);
      (many ? own : own.slice(0, 1)).forEach((d, n) => {
        const t = many && /s$/i.test(title) ? `${title.replace(/s$/i, "")} ${n + 1}` : title;
        out.push({ date: d.date, time, title: t, kind, line: line.trim().slice(0, 240) });
      });
    } else if (base && (kind === "reading" || /\bdue\b/i.test(s) || sentences.length === 1)) {
      out.push({ date: base.date, time, title: titleFor(s, kind, own), kind, line: line.trim().slice(0, 240) });
    }
  });
  // "We will cover Ch. 1.1-1.3. Please read these chapters…": one reading, the specific one.
  const specific = out.filter((o) => o.kind === "reading" && /\d/.test(o.title));
  return specific.length ? out.filter((o) => o.kind !== "reading" || specific.includes(o)) : out;
}

const SKIP_CELL = /^(no class|none|n\/a|tba|tbd|[-–—]+|break|holiday)\b/i;

/** A Word schedule table: a date column and a "homework / due / reading" column. */
function fromTables(lines: string[], ctx: Ctx): ParsedDate[] {
  const out: ParsedDate[] = [];
  let cols: { date: number; due: number[] } | undefined;
  for (const line of lines) {
    if (!line.includes(CELL)) {
      continue;
    }
    const cells = line.split(CELL);
    const lower = cells.map((c) => c.toLowerCase().trim());
    const di = lower.findIndex((c) => /^(date|day|class date|when|week|class)\b/.test(c));
    const due = lower.flatMap((c, i) => (i !== di && /homework|\bdue\b|reading|assignment|prepare|before class/.test(c) ? [i] : []));
    if (di >= 0 && due.length && !findDates(cells[di]!, ctx).length) {
      cols = { date: di, due };
      continue;
    }
    if (!cols) continue;
    const d = findDates(cells[cols.date] ?? "", ctx)[0];
    if (!d) continue;
    for (const i of cols.due) {
      for (const para of (cells[i] ?? "").split(PARA)) {
        const text = para.trim();
        if (text.length < 3 || SKIP_CELL.test(text)) continue;
        const url = /https?:\/\/[^\s)]+/.exec(text)?.[0];
        const title = tidy(text.replace(/https?:\/\/[^\s)]+/g, " ")).slice(0, 180);
        if (!title) continue;
        const kind = classify(text) ?? (/\bdue\b/i.test(text) ? "homework" : "reading");
        out.push({ date: d.date, title, kind, line: `${d.text}: ${text}`.slice(0, 240), url });
      }
    }
  }
  return out;
}

/**
 * Dated work in a syllabus or schedule page: exams, quizzes, things due, and
 * readings ("Week of Sept 7: read Ch. 1.4-1.5", a "Homework" column in a
 * schedule table). Dates without a year take the term's year.
 */
export function extractDates(text: string, termStart: string): ParsedDate[] {
  const start = Date.parse(`${termStart.slice(0, 10)}T00:00:00Z`);
  const ctx: Ctx = {
    startYear: Number(termStart.slice(0, 4)),
    startMonth: Number(termStart.slice(5, 7)),
    from: start - 21 * DAY_MS,
    to: start + 170 * DAY_MS,
  };
  const lines = text.split(/\r?\n/);
  const found = [...fromTables(lines, ctx), ...lines.filter((l) => l.trim() && !l.includes(CELL)).flatMap((l) => fromLine(l, ctx))];

  // The same exam is often mentioned twice (schedule row and prose): keep the first, fill in its time.
  const out: ParsedDate[] = [];
  for (const f of found) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const twin = out.find(
      (o) => o.date === f.date && ((o.kind === f.kind && (f.kind === "exam" || f.kind === "quiz")) || norm(o.title) === norm(f.title)),
    );
    if (twin) {
      twin.time ??= f.time;
      continue;
    }
    out.push(f);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  // One thing repeated on back-to-back class days ("conference due between 11/3-11/10" on each row of that week)
  // is one deadline: keep the last day it is listed. A weekly repeat (7+ days apart) stays as it is.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return out.filter((o, i) => {
    if (o.kind === "reading") return true;
    const next = out.slice(i + 1).find((x) => x.kind === o.kind && norm(x.title) === norm(o.title));
    return !next || Date.parse(next.date) - Date.parse(o.date) >= 7 * DAY_MS;
  });
}
