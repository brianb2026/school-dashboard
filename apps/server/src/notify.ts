import { execFile } from "node:child_process";
import type { DashboardData } from "@sd/core";
import { getSetting, markNotified, setSetting, wasNotified, type Db } from "./db/client.js";

export interface Notifier {
  notify(title: string, body: string): Promise<void>;
}

/**
 * macOS notification. Title and body are passed as arguments to a fixed
 * script (never pasted into it), so text from Blackboard can't run anything.
 */
export const macNotifier: Notifier = {
  notify(title, body) {
    if (process.platform !== "darwin") return Promise.resolve();
    return new Promise((resolve) => {
      execFile(
        "/usr/bin/osascript",
        ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", "--", title.slice(0, 120), body.slice(0, 240)],
        { timeout: 5000 },
        () => resolve(),
      );
    });
  },
};

export const silentNotifier: Notifier = { notify: async () => undefined };

interface Event {
  key: string;
  /** Also mark these as told, without a ping (e.g. the 72 h warning once the 24 h one fires). */
  also?: string[];
  title: string;
  body: string;
}

function hoursLabel(h: number): string {
  return h >= 48 ? `in ${Math.round(h / 24)} days` : h >= 20 ? "tomorrow" : `in ${Math.max(1, Math.round(h))} h`;
}

/** Everything worth a ping right now: posted grades, new announcements, deadlines coming up. */
export function events(d: DashboardData, dueSoonHours: number[], now: Date): Event[] {
  const code = new Map(d.courses.map((c) => [c.id, c.code]));
  const out: Event[] = [];
  for (const a of d.assignments) {
    const c = code.get(a.courseId);
    if (!c) continue;
    // A score you typed in yourself is not news.
    if (a.score !== undefined && a.possible !== undefined && !a.scoreIsYours) {
      out.push({ key: `grade:${a.id}:${a.score}/${a.possible}`, title: `Grade posted · ${c}`, body: `${a.title}: ${a.score} / ${a.possible}` });
    }
    if (!a.done && a.dueAt) {
      const hours = (Date.parse(a.dueAt) - now.getTime()) / 3_600_000;
      const steps = [...dueSoonHours].sort((x, y) => x - y);
      const hit = steps.find((h) => hours > 0 && hours <= h);
      if (hit !== undefined) {
        out.push({
          key: `due:${a.id}:${hit}`,
          also: steps.filter((h) => h > hit).map((h) => `due:${a.id}:${h}`),
          title: `Due ${hoursLabel(hours)} · ${c}`,
          body: a.title,
        });
      }
    }
  }
  for (const n of d.announcements) {
    out.push({ key: `ann:${n.id}`, title: `Announcement · ${code.get(n.courseId ?? "") ?? "Blackboard"}`, body: n.title });
  }
  return out;
}

/**
 * Ping for what is new since last time. The first run after linking only
 * takes note of what already exists, so you aren't buried in old news.
 */
export async function notifyChanges(db: Db, d: DashboardData, dueSoonHours: number[], notifier: Notifier, enabled: boolean, now = new Date()): Promise<number> {
  const all = events(d, dueSoonHours, now);
  const fresh = all.filter((e) => !wasNotified(db, e.key));
  const keys = fresh.flatMap((e) => [e.key, ...(e.also ?? [])]);
  if (getSetting(db, "NOTIFY_BASELINE") !== "done") {
    if (d.hasData) {
      markNotified(db, keys);
      setSetting(db, "NOTIFY_BASELINE", "done");
    }
    return 0;
  }
  markNotified(db, keys);
  if (!enabled || fresh.length === 0) return 0;
  const shown = fresh.slice(0, 5);
  for (const e of shown) await notifier.notify(e.title, e.body);
  if (fresh.length > shown.length) await notifier.notify("School dashboard", `…and ${fresh.length - shown.length} more updates`);
  return fresh.length;
}
