import { addDays, localDay, zonedInstant, localMinutes } from "./time";

// Sleep estimate from phone use: you fall asleep after your last tap of the
// evening and wake at your first tap of the morning. For the night that ends
// on local date `wakeDay`, look at phone use between 18:00 the evening before
// and 14:00 on wakeDay and take the longest break of 3h+. A quick phone check
// in the small hours (a short burst with an hour or more of quiet either
// side) is treated as a brief wake-up inside the night, not the end of it.

export type SleepNight = {
  day: string; // the local date you woke up on
  bedtime: Date | null;
  wake: Date | null;
  hours: number | null; // asleep time, brief wake-ups taken out
  confidence: "high" | "medium" | "low";
  note?: string;
  interruptions?: number;
  healthKitHours?: number | null; // from Apple Health if the Shortcut sends it
};

const MIN_GAP_MS = 3 * 3600_000;
const CLUSTER_MS = 10 * 60_000; // taps this close together are one use
const CHECK_MAX_MS = 15 * 60_000; // a night check lasts at most this long
const CHECK_QUIET_MS = 60 * 60_000; // with this much quiet on both sides

type Cluster = { start: Date; end: Date; count: number };

function clusters(sorted: Date[]): Cluster[] {
  const out: Cluster[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && e.getTime() - last.end.getTime() <= CLUSTER_MS) {
      last.end = e;
      last.count++;
    } else out.push({ start: e, end: e, count: 1 });
  }
  return out;
}

const nightTime = (d: Date, tz: string) => {
  const m = localMinutes(d, tz);
  return m >= 18 * 60 || m <= 5 * 60;
};
const smallHours = (d: Date, tz: string) => localMinutes(d, tz) <= 5 * 60 + 30;

export function inferNight(events: Date[], wakeDay: string, tz: string, now = new Date()): SleepNight {
  const winStart = zonedInstant(addDays(wakeDay, -1), 18 * 60, tz);
  const winEnd = zonedInstant(wakeDay, 14 * 60, tz);
  const inWin = events
    .filter((e) => e >= winStart && e <= winEnd && e <= now)
    .sort((a, b) => a.getTime() - b.getTime());

  if (inWin.length === 0) {
    return { day: wakeDay, bedtime: null, wake: null, hours: null, confidence: "low", note: "No phone use recorded around this night." };
  }

  const cs = clusters(inWin);

  // Longest plausible break between clusters.
  let best = -1;
  let bestMs = 0;
  for (let i = 0; i < cs.length - 1; i++) {
    const ms = cs[i + 1].start.getTime() - cs[i].end.getTime();
    if (ms >= MIN_GAP_MS && nightTime(cs[i].end, tz) && ms > bestMs) {
      best = i;
      bestMs = ms;
    }
  }

  if (best < 0) {
    const last = cs[cs.length - 1].end;
    if (now < winEnd && nightTime(last, tz) && now.getTime() - last.getTime() >= MIN_GAP_MS) {
      return { day: wakeDay, bedtime: last, wake: null, hours: null, confidence: "medium", note: "Asleep (or phone down) since the last tap." };
    }
    return { day: wakeDay, bedtime: null, wake: null, hours: null, confidence: "low", note: "No 3-hour break in phone use found." };
  }

  // Grow the night over brief small-hours checks on either side.
  const isCheck = (c: Cluster, quietBefore: number, quietAfter: number) =>
    c.end.getTime() - c.start.getTime() <= CHECK_MAX_MS && c.count <= 4 && smallHours(c.start, tz) && quietBefore >= CHECK_QUIET_MS && quietAfter >= CHECK_QUIET_MS;
  let lo = best; // cs[lo] is the cluster you went to sleep after
  let hi = best + 1; // cs[hi] is the cluster you woke up with
  let checkMs = 0;
  let interruptions = 0;
  while (lo > 0) {
    const c = cs[lo];
    const before = c.start.getTime() - cs[lo - 1].end.getTime();
    const after = cs[lo + 1].start.getTime() - c.end.getTime();
    if (!isCheck(c, before, after) || !nightTime(cs[lo - 1].end, tz)) break;
    checkMs += c.end.getTime() - c.start.getTime() + 5 * 60_000;
    interruptions++;
    lo--;
  }
  while (hi < cs.length - 1) {
    const c = cs[hi];
    const before = c.start.getTime() - cs[hi - 1].end.getTime();
    const after = cs[hi + 1].start.getTime() - c.end.getTime();
    if (!isCheck(c, before, after)) break;
    checkMs += c.end.getTime() - c.start.getTime() + 5 * 60_000;
    interruptions++;
    hi++;
  }

  const bedtime = cs[lo].end;
  const wake = cs[hi].start;
  const spanMs = wake.getTime() - bedtime.getTime();
  const hours = Math.round(((spanMs - checkMs) / 3600_000) * 10) / 10;

  // Several uses shortly before and after the night make a sharper estimate.
  const near = (from: Date, sign: 1 | -1) =>
    inWin.filter((e) => {
      const d = (e.getTime() - from.getTime()) * sign;
      return d > 0 && d < 2 * 3600_000;
    }).length;
  const before = near(bedtime, -1) + 1;
  const after = near(wake, 1) + 1;
  const confidence: SleepNight["confidence"] = before >= 2 && after >= 2 ? "high" : before + after >= 3 ? "medium" : "low";

  return {
    day: wakeDay,
    bedtime,
    wake,
    hours,
    confidence,
    interruptions,
    note:
      hours > 11
        ? "Unusually long: the phone may just have been left alone."
        : interruptions
          ? `Woke briefly ${interruptions === 1 ? "once" : `${interruptions} times`} to check the phone.`
          : undefined,
  };
}

export function inferNights(events: Date[], days: number, tz: string, now = new Date()): SleepNight[] {
  const today = localDay(now, tz);
  const out: SleepNight[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(inferNight(events, addDays(today, -i), tz, now));
  return out;
}
