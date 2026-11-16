/** Offset of `timeZone` from UTC at instant `utcMs`, in milliseconds. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Wall-clock date + time in a school's time zone → ISO instant.
 * zonedToIso("2027-03-18", "23:59", "America/New_York") → "2027-03-19T03:59:00.000Z"
 */
export function zonedToIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let utc = guess - zoneOffsetMs(guess, timeZone);
  // Second pass fixes the hour around daylight-saving switches.
  utc = guess - zoneOffsetMs(utc, timeZone);
  return new Date(utc).toISOString();
}
