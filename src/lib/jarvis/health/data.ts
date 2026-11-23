import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ensureCompanionTables } from "@/lib/jarvis/companion-setup";
import { RHYTHM_DEFAULTS, type Rhythm } from "@/lib/jarvis/v2/rhythm";
import { inferNights, type SleepNight } from "./sleep";
import { addDays, localDay, localMinutes, weekdayOf, formatClock } from "./time";
import {
  PROFILE_DEFAULTS,
  buildDayPlan,
  computeReadiness,
  progressProfile,
  type DayPlan,
  type FitnessProfile,
  type Readiness,
} from "./plan";

// Everything the health page, the coach cron and the chat tools need, loaded
// in one place so they always agree.

const parse = <T,>(v?: string | null): T | null => {
  try {
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};

export async function loadRhythmSetting(): Promise<Rhythm> {
  const row = await prisma.jarvisSetting.findUnique({ where: { key: "rhythm" } });
  return { ...RHYTHM_DEFAULTS, ...(parse<Partial<Rhythm>>(row?.value) ?? {}) };
}

export async function loadProfile(): Promise<FitnessProfile> {
  const row = await prisma.jarvisSetting.findUnique({ where: { key: "fitness_profile" } });
  return { ...PROFILE_DEFAULTS, ...(parse<Partial<FitnessProfile>>(row?.value) ?? {}) };
}

export async function saveProfile(p: FitnessProfile): Promise<void> {
  const value = JSON.stringify(p);
  await prisma.jarvisSetting.upsert({ where: { key: "fitness_profile" }, create: { key: "fitness_profile", value }, update: { value } });
}

// ── Ingest token (the iPhone Shortcut's key) ────────────────────────────────

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function rotateHealthToken(): Promise<string> {
  const token = `jh_${crypto.randomBytes(24).toString("base64url")}`;
  const value = sha(token);
  await prisma.jarvisSetting.upsert({ where: { key: "health_token_hash" }, create: { key: "health_token_hash", value }, update: { value } });
  return token;
}

export async function hasHealthToken(): Promise<boolean> {
  return Boolean(await prisma.jarvisSetting.findUnique({ where: { key: "health_token_hash" } }));
}

export async function checkHealthToken(given: string): Promise<boolean> {
  if (!given) return false;
  const row = await prisma.jarvisSetting.findUnique({ where: { key: "health_token_hash" } });
  if (!row) return false;
  const a = Buffer.from(sha(given));
  const b = Buffer.from(row.value);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Recording ───────────────────────────────────────────────────────────────

export async function recordPhoneUse(at: Date, source: string): Promise<void> {
  await ensureCompanionTables();
  // One row per minute is plenty for sleep detection.
  const minute = Math.floor(at.getTime() / 60000);
  await prisma.jarvisHealthSample.upsert({
    where: { externalId: `use:${minute}` },
    create: { metric: "phone_use", value: 1, startAt: new Date(minute * 60000), source: source.slice(0, 60), externalId: `use:${minute}` },
    update: {},
  });
}

export async function recordDaily(day: string, metric: string, value: number, unit: string | null, source: string, tz: string): Promise<void> {
  await ensureCompanionTables();
  const externalId = `daily:${metric}:${day}`;
  const startAt = new Date(`${day}T12:00:00Z`);
  void tz;
  await prisma.jarvisHealthSample.upsert({
    where: { externalId },
    create: { metric, value, unit, day, startAt, source: source.slice(0, 60), externalId },
    update: { value, unit, source: source.slice(0, 60) },
  });
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export type DailyMetrics = Record<string, Record<string, number>>; // day -> metric -> value

export type HealthSnapshot = {
  tz: string;
  today: string;
  nights: SleepNight[];
  lastNight: SleepNight | null;
  sleepAvg7: number | null;
  daily: DailyMetrics;
  readiness: Readiness;
  profile: FitnessProfile;
  plan: DayPlan;
  workouts: { day: string; kind: string; status: string; details: string | null; pushups: number | null; squats: number | null; plankSec: number | null; durationMin: number | null; distanceKm: number | null }[];
  weekStrength: number;
  weekRuns: number;
  lastPhoneUse: Date | null;
  hasData: boolean;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function getHealthSnapshot(now = new Date()): Promise<HealthSnapshot> {
  await ensureCompanionTables();
  const [rhythm, profile] = await Promise.all([loadRhythmSetting(), loadProfile()]);
  const tz = rhythm.tz;
  const today = localDay(now, tz);
  const since = new Date(now.getTime() - 16 * 864e5); // 14 nights of taps is all sleep needs

  const [uses, dailyRows, workouts] = await Promise.all([
    prisma.jarvisHealthSample.findMany({ where: { metric: "phone_use", startAt: { gte: since } }, select: { startAt: true }, orderBy: { startAt: "asc" } }),
    prisma.jarvisHealthSample.findMany({ where: { metric: { not: "phone_use" }, day: { gte: addDays(today, -30) } }, select: { day: true, metric: true, value: true } }),
    prisma.jarvisWorkout.findMany({ where: { day: { gte: addDays(today, -27) } }, orderBy: [{ day: "desc" }, { createdAt: "desc" }] }),
  ]);

  const events = uses.map((u) => u.startAt);
  const nights = inferNights(events, 14, tz, now);
  const daily: DailyMetrics = {};
  for (const r of dailyRows) {
    if (!r.day) continue;
    (daily[r.day] ??= {})[r.metric] = r.value;
  }
  // Apple Health sleep (Watch / Sleep schedule) wins when present.
  for (const n of nights) {
    const hk = daily[n.day]?.sleep_hours;
    if (hk != null) n.healthKitHours = Math.round(hk * 10) / 10;
  }
  const lastNight = nights[nights.length - 1] ?? null;
  const nightHours = (n: SleepNight) => n.healthKitHours ?? n.hours;
  const recent = nights.slice(-7).map(nightHours).filter((h): h is number => h != null);
  const sleepAvg7 = recent.length ? Math.round((avg(recent) ?? 0) * 10) / 10 : null;

  const series = (metric: string, from: number, to: number) => {
    const xs: number[] = [];
    for (let i = from; i <= to; i++) {
      const v = daily[addDays(today, -i)]?.[metric];
      if (v != null) xs.push(v);
    }
    return xs;
  };
  const latest = (metric: string) => series(metric, 0, 1)[0] ?? null;
  const rhrBase = avg(series("resting_hr", 2, 15));
  const hrvBase = avg(series("hrv", 2, 15));

  const yesterday = addDays(today, -1);
  const hardYesterday = workouts.some((w) => w.day === yesterday && w.status === "done" && ((w.rpe ?? 0) >= 8 || /interval|long/i.test(w.details ?? "")));

  const readiness = computeReadiness({
    sleepHours: lastNight ? nightHours(lastNight) : null,
    sleepTargetH: profile.sleepTargetH,
    restingHr: latest("resting_hr"),
    restingHrBaseline: rhrBase,
    hrv: latest("hrv"),
    hrvBaseline: hrvBase,
    hardYesterday,
  });

  // Week runs Sunday to Saturday locally.
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -dow);
  const thisWeek = workouts.filter((w) => w.day >= weekStart && w.status !== "skipped");
  const weekStrength = thisWeek.filter((w) => w.kind === "strength").length;
  const weekRuns = thisWeek.filter((w) => w.kind === "run").length;

  const wakeMinutes = lastNight?.wake && localDay(lastNight.wake, tz) === today ? localMinutes(lastNight.wake, tz) : null;
  const plan = buildDayPlan({
    day: today,
    profile,
    rhythm,
    readiness,
    wakeMinutes,
    strengthDoneThisWeek: weekStrength,
    month: Number(today.slice(5, 7)),
  });

  return {
    tz,
    today,
    nights,
    lastNight,
    sleepAvg7,
    daily,
    readiness,
    profile,
    plan,
    workouts: workouts.map((w) => ({ day: w.day, kind: w.kind, status: w.status, details: w.details, pushups: w.pushups, squats: w.squats, plankSec: w.plankSec, durationMin: w.durationMin, distanceKm: w.distanceKm })),
    weekStrength,
    weekRuns,
    lastPhoneUse: events.length ? events[events.length - 1] : null,
    hasData: events.length > 0 || dailyRows.length > 0 || workouts.length > 0,
  };
}

export function describeNight(n: SleepNight | null, tz: string): string {
  if (!n) return "No sleep estimate yet.";
  const hk = n.healthKitHours != null ? ` (Apple Health: ${n.healthKitHours}h)` : "";
  if (n.hours == null) return `${n.note ?? "No estimate."}${hk}`;
  return `${n.hours}h, ${n.bedtime ? formatClock(n.bedtime, tz) : "?"} to ${n.wake ? formatClock(n.wake, tz) : "?"} (${n.confidence} confidence)${hk}${n.note ? `. ${n.note}` : ""}`;
}

// Plain-text summary for the chat tool, the Shortcut's GET and the morning brief.
export function snapshotText(s: HealthSnapshot, opts: { days?: number } = {}): string {
  const days = Math.max(1, Math.min(14, opts.days ?? 7));
  const lines: string[] = [];
  lines.push(`Today ${s.today} (${weekdayOf(s.today)}), readiness ${s.readiness.score}/100 ${s.readiness.level}: ${s.readiness.reasons.join(", ")}.`);
  lines.push(`Last night: ${describeNight(s.lastNight, s.tz)}. 7-night average: ${s.sleepAvg7 ?? "n/a"}h (target ${s.profile.sleepTargetH}h).`);
  lines.push(`\nSleep by night (from phone use):`);
  for (const n of s.nights.slice(-days)) lines.push(`- ${n.day}: ${describeNight(n, s.tz)}`);
  lines.push(`\nDaily metrics from Apple Health:`);
  let any = false;
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(s.today, -i);
    const m = s.daily[d];
    if (!m) continue;
    any = true;
    lines.push(`- ${d}: ${Object.entries(m).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}`).join(", ")}`);
  }
  if (!any) lines.push("(none received yet; the iPhone Shortcut sends these)");
  lines.push(`\nThis week: ${s.weekStrength} strength, ${s.weekRuns} runs.`);
  lines.push(`Profile: push-ups max ${s.profile.pushupMax}, squats max ${s.profile.squatMax}, plank ${s.profile.plankSec}s, easy run ${s.profile.runEasyMin} min, steps target ${s.profile.stepsTarget}. Strength ${s.profile.strengthDays.join("/")}, runs ${s.profile.runDays.join("/")}${s.profile.longRunDay ? ` + long run ${s.profile.longRunDay} once easy run is 25+ min` : ""}.`);
  lines.push(`\nToday's plan (${s.plan.focus}):`);
  for (const it of s.plan.items) lines.push(`- ${it.at} ${it.title}: ${it.detail}`);
  lines.push(`\nRecent workouts:`);
  if (!s.workouts.length) lines.push("(none logged yet)");
  for (const w of s.workouts.slice(0, 10)) {
    const bits = [w.pushups ? `${w.pushups} push-ups` : "", w.squats ? `${w.squats} squats` : "", w.plankSec ? `plank ${w.plankSec}s` : "", w.durationMin ? `${w.durationMin} min` : "", w.distanceKm ? `${w.distanceKm} km` : ""].filter(Boolean).join(", ");
    lines.push(`- ${w.day} ${w.kind} ${w.status}${bits ? `: ${bits}` : ""}${w.details ? ` (${w.details.slice(0, 120)})` : ""}`);
  }
  return lines.join("\n");
}

export async function logWorkout(input: {
  day?: string;
  kind: string;
  status?: string;
  durationMin?: number | null;
  distanceKm?: number | null;
  pushups?: number | null;
  squats?: number | null;
  plankSec?: number | null;
  rpe?: number | null;
  details?: string | null;
  isTest?: boolean;
}): Promise<{ id: string; profileChanged: boolean; profile: FitnessProfile }> {
  await ensureCompanionTables();
  const rhythm = await loadRhythmSetting();
  const day = input.day && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : localDay(new Date(), rhythm.tz);
  const status = ["done", "skipped", "partial"].includes(input.status ?? "") ? input.status! : "done";
  const row = await prisma.jarvisWorkout.create({
    data: {
      day,
      kind: input.kind,
      status,
      durationMin: input.durationMin ?? null,
      distanceKm: input.distanceKm ?? null,
      pushups: input.pushups ?? null,
      squats: input.squats ?? null,
      plankSec: input.plankSec ?? null,
      rpe: input.rpe ?? null,
      details: input.details?.slice(0, 1000) ?? null,
    },
  });
  const before = await loadProfile();
  const after = progressProfile(before, { ...input, status });
  const profileChanged = JSON.stringify(before) !== JSON.stringify(after);
  if (profileChanged) await saveProfile(after);
  return { id: row.id, profileChanged, profile: after };
}
