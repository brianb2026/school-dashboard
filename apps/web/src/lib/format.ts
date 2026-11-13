const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function relativeDue(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return `Today ${timeFmt.format(d)}`;
  if (days === 1) return `Tomorrow ${timeFmt.format(d)}`;
  if (days === -1) return "Yesterday";
  return dayFmt.format(d);
}

export function shortDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(d);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
