// Small timezone helpers (no dependencies). Kuwait has no DST, but these work
// for any IANA zone because the offset is measured at the instant in question.

export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

export function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

// Minutes since local midnight.
export function localMinutes(at: Date, tz: string): number {
  const shifted = new Date(at.getTime() + tzOffsetMinutes(at, tz) * 60000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayOf(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToHm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// The instant for local `day` at `minutes` past midnight (minutes may exceed 1440).
export function zonedInstant(day: string, minutes: number, tz: string): Date {
  const guess = new Date(`${day}T00:00:00Z`).getTime() + minutes * 60000;
  const off = tzOffsetMinutes(new Date(guess), tz);
  const first = guess - off * 60000;
  // Re-measure once in case the guess straddled an offset change.
  const off2 = tzOffsetMinutes(new Date(first), tz);
  return new Date(guess - off2 * 60000);
}

export function formatClock(at: Date, tz: string): string {
  return minutesToHm(localMinutes(at, tz));
}
