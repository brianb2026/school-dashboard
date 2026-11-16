const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Whole days from today to `iso` (0 = today, -1 = yesterday). */
export function daysFromNow(iso: string, now = new Date()): number {
  return Math.round((startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime()) / 86_400_000);
}

export function relativeDue(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = daysFromNow(iso, now);
  if (days === 0) return `Today ${timeFmt.format(d)}`;
  if (days === 1) return `Tomorrow ${timeFmt.format(d)}`;
  if (days === -1) return "Yesterday";
  return dayFmt.format(d);
}

export function clock(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** "14:00" → "2:00 PM" */
export function hhmm(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return timeFmt.format(d);
}

export function ago(iso?: string): string {
  if (!iso) return "never";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

export function pct(n: number | undefined, digits = 1): string {
  return n === undefined ? "–" : `${n.toFixed(digits)}%`;
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
