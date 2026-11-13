import type { LetterCutoff, Meeting } from "@sd/core";

const ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];
const NUM = String.raw`(\d{2,3}(?:\.\d+)?)`;
const LET = String.raw`([A-D][+\-−–]?|F)`;
const SEP = String.raw`[ \t]*%?[ \t]*(?:[-–—]|to|through)[ \t]*`;

function norm(letter: string): string {
  return letter.toUpperCase().replace(/[−–]/, "-");
}

/**
 * The letter-grade scale, e.g. "A 93-100, A- 90-92.9, …" or "90-100% = A" or
 * a table with one "A  93%" per line. Returned only when it looks like a real
 * scale: four or more letters including A, strictly descending.
 */
export function extractLetterScale(text: string): LetterCutoff[] | undefined {
  const found = new Map<string, number>();
  const put = (letter: string, a: number, b?: number) => {
    const min = b === undefined ? a : Math.min(a, b);
    const l = norm(letter);
    if (min < 0 || min > 100 || (b !== undefined && Math.max(a, b) > 110)) return;
    if (!found.has(l)) found.set(l, min);
  };
  // "A 93-100", "A: 93 – 100%", "A (93-100)". Letter and numbers must share a line.
  const forward = [...text.matchAll(new RegExp(String.raw`(?<![A-Za-z])${LET}[ \t]*[:=]?[ \t]*\(?${NUM}${SEP}${NUM}[ \t]*%?\)?`, "g"))];
  // "93-100 A", "93–100% = A"
  const reverse = [...text.matchAll(new RegExp(String.raw`${NUM}${SEP}${NUM}[ \t]*%?[ \t]*[:=]?[ \t]*${LET}(?![A-Za-z])`, "g"))];
  // Both shapes can match the same text shifted by one; the real one starts first.
  const useForward = forward.length > 0 && (reverse.length === 0 || forward[0]!.index! <= reverse[0]!.index!);
  if (useForward) for (const m of forward) put(m[1]!, Number(m[2]), Number(m[3]));
  else for (const m of reverse) put(m[3]!, Number(m[1]), Number(m[2]));
  // One per line: "A  93%", "A- >= 90", "B+ 87 and above", "≥ 93: A"
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m = new RegExp(String.raw`^${LET}\s*[:=]?\s*(?:≥|>=|at least|above)?\s*${NUM}\s*%?\s*(?:\+|and (?:above|up|higher)|or (?:above|higher|more))?$`, "i").exec(line);
    if (m) put(m[1]!, Number(m[2]));
    m = new RegExp(String.raw`^(?:≥|>=|at least)?\s*${NUM}\s*%?\s*(?:\+|and (?:above|up|higher)|or (?:above|higher|more))?\s*[:=]\s*${LET}$`, "i").exec(line);
    if (m) put(m[2]!, Number(m[1]));
  }
  const scale = ORDER.filter((l) => found.has(l)).map((letter) => ({ letter, min: found.get(letter)! }));
  if (scale.length < 4 || !found.has("A")) return undefined;
  for (let i = 1; i < scale.length; i++) if (scale[i]!.min >= scale[i - 1]!.min) return undefined;
  if (!found.has("F")) scale.push({ letter: "F", min: 0 });
  else scale[scale.length - 1] = { letter: "F", min: 0 };
  return scale;
}

/** Credit hours, e.g. "4 credit hours", "Credits: 3", "3 units". */
export function extractCredits(text: string): number | undefined {
  const m =
    /\b(\d(?:\.\d)?)\s*[- ]?\s*(?:credit hours?|credits?|semester hours?|units?)\b/i.exec(text) ??
    /\bcredits?(?: hours?)?\s*[:=]\s*(\d(?:\.\d)?)\b/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n >= 0.5 && n <= 6 ? n : undefined;
}

const DAY_WORDS: [RegExp, number][] = [
  [/\bsun(day)?s?\b/i, 0],
  [/\bmon(day)?s?\b/i, 1],
  [/\btue(s|sday)?s?\b/i, 2],
  [/\bwed(nesday)?s?\b/i, 3],
  [/\bthu(r|rs|rsday)?s?\b/i, 4],
  [/\bfri(day)?s?\b/i, 5],
  [/\bsat(urday)?s?\b/i, 6],
];

/** "MWF", "TR", "TTh", "MW", "Tu/Th", "Mon & Wed", "Tuesdays and Thursdays" → weekday numbers. */
export function parseDays(s: string): number[] {
  const days = new Set<number>();
  for (const [re, d] of DAY_WORDS) if (re.test(s)) days.add(d);
  if (days.size) return [...days].sort();
  // Compact letter codes, read left to right.
  const compact = /\b((?:Th|Tu|Su|Sa|[MTWRFS]){1,7})\b/.exec(s.replace(/[\/,&+]|\band\b/gi, ""));
  if (!compact) return [];
  const code = compact[1]!;
  for (let i = 0; i < code.length; ) {
    const two = code.slice(i, i + 2);
    if (two === "Th") (days.add(4), (i += 2));
    else if (two === "Tu") (days.add(2), (i += 2));
    else if (two === "Su") (days.add(0), (i += 2));
    else if (two === "Sa") (days.add(6), (i += 2));
    else {
      const d = { M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 }[code[i]!];
      if (d === undefined) return [];
      days.add(d);
      i++;
    }
  }
  return [...days].sort();
}

const TIME_RANGE = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:[-–—]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i;

function to24(h: number, ampm: string | undefined): number {
  if (!ampm) return h;
  const pm = /^p/i.test(ampm);
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Class meeting times from lines like "Lecture: MWF 10:25–11:15 am, Hutchison 141"
 * or "Class meets Tu/Th 2:00-3:15pm". Office-hours lines are skipped.
 */
export function extractMeetings(text: string): Meeting[] {
  const out: Meeting[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/).slice(0, 80)) {
    const line = raw.trim();
    if (!line || /office hours?|due|exam|quiz|review session/i.test(line)) continue;
    if (!/\b(lecture|class|meets?|meeting|time|when|section|lab|recitation|workshop)\b/i.test(line)) continue;
    const t = TIME_RANGE.exec(line);
    if (!t) continue;
    const days = parseDays(line.slice(0, t.index));
    if (!days.length) continue;
    let sh = Number(t[1]);
    let eh = Number(t[4]);
    const sm = Number(t[2] ?? 0);
    const em = Number(t[5] ?? 0);
    if (sh > 23 || eh > 23 || sm > 59 || em > 59) continue;
    const endAp = t[6];
    const startAp = t[3] ?? endAp;
    eh = to24(eh, endAp);
    sh = to24(sh, startAp);
    // "11-12:15pm": the start is still morning.
    if (!t[3] && endAp && sh > eh) sh -= 12;
    // No am/pm at all: classes before 8 are afternoon.
    if (!t[3] && !endAp) {
      if (sh < 8) sh += 12;
      if (eh < sh) eh += 12;
    }
    if (sh < 0 || eh <= sh - 0 && em <= sm) continue;
    const after = line.slice(t.index + t[0].length);
    const loc = /^\s*(?:,|in|at|@|;|\||—|–|-)?\s*(?:room\s+)?([A-Za-z][\w .&'-]{2,40}?\d[\w-]*|[A-Za-z][\w .&'-]{2,40})\s*$/i.exec(after)?.[1]?.trim();
    for (const weekday of days) {
      const m: Meeting = { weekday, start: `${pad(sh)}:${pad(sm)}`, end: `${pad(eh)}:${pad(em)}`, location: loc || undefined };
      const key = `${m.weekday}-${m.start}-${m.end}`;
      if (!seen.has(key)) (seen.add(key), out.push(m));
    }
  }
  return out;
}
