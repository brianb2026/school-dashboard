import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { zoned } from "../notify.js";

function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h ?? 0) % 12) || 12}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`;
}

/** "45m", "5h", "2d": what's left, short enough for the menu bar. */
function left(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  return h < 36 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/**
 * A small summary for the Mac menu bar item: the next deadline, the next few
 * after it, today's classes, and how much is new. Already worded, so the
 * menu bar app only has to show it. Readable only from this Mac.
 */
export function menubarRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/menubar", async () => {
    const d = await ctx.sync.dashboard();
    const tz = ctx.cfg.timezone;
    const now = new Date();
    const code = new Map(d.courses.map((c) => [c.id, c.code]));
    const when = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });
    const upcoming = d.assignments
      .filter((a) => !a.done && a.dueAt && a.kind !== "reading" && Date.parse(a.dueAt) > now.getTime() && a.courseId !== "unassigned")
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
      .slice(0, 8)
      .map((a) => ({ title: a.title, course: code.get(a.courseId) ?? "", when: when.format(new Date(a.dueAt!)), left: left(Date.parse(a.dueAt!) - now.getTime()), exam: a.kind === "exam" }));
    const today = zoned(now, tz);
    const classes = d.courses
      .flatMap((c) => c.meetings.filter((m) => m.weekday === today.weekday).map((m) => ({ course: c.code, start: m.start, time: `${clock12(m.start)}–${clock12(m.end)}`, room: m.location ?? "" })))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map(({ start: _s, ...c }) => c);
    const next = upcoming[0];
    const short = next ? `${next.title.length > 18 ? `${next.title.slice(0, 17)}…` : next.title} · ${next.left}` : "All clear";
    return {
      title: short,
      upcoming,
      classes,
      changes: d.changes.filter((c) => !c.seen).length,
      holds: d.sis?.holds.length ?? 0,
      name: d.studentName,
    };
  });
}
