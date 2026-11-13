import { matchCourse, type Assignment, type AssignmentKind } from "@sd/core";
import type { Connector, ConnectorContext, SyncResult } from "../types.js";

/**
 * Blackboard calendar feed: the no-admin, no-gray-area starting point.
 * In Learn Ultra: Calendar → settings (gear) → "Share calendar" → copy link.
 * The feed carries due dates for every course; titles look like
 * "Lab 3 Report: CHEM-101-002" or include the course name in a separate field
 * depending on the school's Learn version, so course matching is fuzzy.
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  start?: string; // ISO
  url?: string;
}

/** Minimal RFC 5545 reader: unfolds lines, reads VEVENTs, handles UTC, local and all-day times. */
export function parseIcs(ics: string): IcsEvent[] {
  const lines = ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | undefined;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur?.uid && cur.summary) events.push(cur as IcsEvent);
      cur = undefined;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const [name] = line.slice(0, idx).split(";");
      const value = line.slice(idx + 1).replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
      if (name === "UID") cur.uid = value;
      else if (name === "SUMMARY") cur.summary = value;
      else if (name === "DESCRIPTION") cur.description = value;
      else if (name === "URL") cur.url = value;
      else if (name === "DTSTART") cur.start = icsDate(value);
    }
  }
  return events;
}

function icsDate(v: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return undefined;
  const [, y, mo, d, h = "23", mi = "59", s = "00", z] = m;
  // Floating/local times are treated as local to this machine; all-day events as 23:59 local.
  return z ? `${y}-${mo}-${d}T${h}:${mi}:${s}Z` : new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).toISOString();
}

function guessKind(title: string): AssignmentKind {
  if (/\b(exam|midterm|final|test)\b/i.test(title)) return "exam";
  if (/\bquiz/i.test(title)) return "quiz";
  if (/\bproject\b/i.test(title)) return "project";
  if (/\b(paper|essay)\b/i.test(title)) return "paper";
  if (/\blab\b/i.test(title)) return "lab";
  if (/\bdiscussion\b/i.test(title)) return "discussion";
  return "homework";
}

export function eventsToAssignments(events: IcsEvent[], ctx: Pick<ConnectorContext, "knownCourses" | "now">): Assignment[] {
  const fetchedAt = ctx.now.toISOString();
  return events.map((e) => {
    const courseHint = [e.summary, e.description].filter(Boolean).join(" \n ");
    return {
      id: `bb-ical:${e.uid}`,
      courseId: matchCourse(courseHint, ctx.knownCourses) ?? "unassigned",
      courseHint,
      title: e.summary,
      kind: guessKind(e.summary),
      dueAt: e.start,
      status: "upcoming",
      submittable: false,
      attachments: [],
      sources: [{ source: "blackboard-ical", externalId: e.uid, url: e.url, fetchedAt }],
    } satisfies Assignment;
  });
}

/** Keychain key for the calendar link. It's a bearer link, so it's treated like a secret. */
export const ICAL_SECRET = "blackboard.ical_url";

async function icalUrl(ctx: ConnectorContext): Promise<string | undefined> {
  return (await ctx.secrets.get(ICAL_SECRET)) || ctx.env.BLACKBOARD_ICAL_URL || undefined;
}

export const blackboardIcal: Connector = {
  id: "blackboard-ical",
  label: "Blackboard calendar feed",
  capabilities: ["assignments"],
  async status(ctx) {
    return (await icalUrl(ctx)) ? { state: "ready" } : { state: "not-configured", detail: "Paste your calendar link in Settings" };
  },
  async sync(ctx): Promise<SyncResult> {
    const url = await icalUrl(ctx);
    if (!url) return {};
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Calendar feed returned ${res.status}`);
    return { assignments: eventsToAssignments(parseIcs(await res.text()), ctx) };
  },
};
