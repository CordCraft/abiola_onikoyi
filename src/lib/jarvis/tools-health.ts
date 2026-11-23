import "server-only";
import { getHealthSnapshot, loadProfile, logWorkout, saveProfile, snapshotText } from "@/lib/jarvis/health/data";
import type { FitnessProfile } from "@/lib/jarvis/health/plan";
import { WEEKDAYS } from "@/lib/jarvis/health/time";

// Health coach tools: read the iPhone data + sleep estimate, log workouts
// (from chat or notification replies), and tune the training profile.

export const healthTools = [
  {
    name: "get_health",
    description:
      "The owner's health picture: sleep per night (estimated from the last phone tap at night to the first tap in the morning, plus Apple Health sleep if sent), steps, resting heart rate, HRV and other Apple Health metrics from the iPhone, readiness score, today's bodyweight + running plan with times, this week's workouts and the training profile. Use before giving any health, sleep or workout advice or planning the day.",
    input_schema: {
      type: "object" as const,
      properties: { days: { type: "number", description: "Nights/days to show, 1-14 (default 7)" } },
    },
  },
  {
    name: "log_workout",
    description:
      "Record a workout the owner did or skipped (strength = push-ups/squats/planks circuit, run, walk, mobility, gym). Call it whenever he says he did, finished, skipped or moved a session, including one-word replies like 'Done' to a workout notification (take the session from the notification). Max-test numbers (Strength C last round, or 'I did 32 push-ups in one go') go in with is_test=true and raise the plan automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["strength", "run", "walk", "mobility", "gym", "other"] },
        status: { type: "string", enum: ["done", "skipped", "partial"], description: "Default done" },
        day: { type: "string", description: "YYYY-MM-DD local; default today" },
        duration_min: { type: "number" },
        distance_km: { type: "number" },
        pushups: { type: "number", description: "Best single set (or total if he only gives a total; say so in details)" },
        squats: { type: "number" },
        plank_sec: { type: "number" },
        rpe: { type: "number", description: "Effort 1-10: easy about 4, hard about 8" },
        is_test: { type: "boolean", description: "True when the numbers are a max test" },
        details: { type: "string", description: "Session name and anything notable (pain, felt easy, moved to evening)" },
      },
      required: ["kind"],
    },
  },
  {
    name: "update_fitness_profile",
    description:
      "Change the training setup: current maxes, easy-run minutes, step and sleep targets, morning or evening workouts, and which weekdays are strength / run / long run. Use when he tells you his numbers or wants a different schedule.",
    input_schema: {
      type: "object" as const,
      properties: {
        pushup_max: { type: "number" },
        squat_max: { type: "number" },
        plank_sec: { type: "number" },
        run_easy_min: { type: "number" },
        steps_target: { type: "number" },
        sleep_target_h: { type: "number" },
        workout_time: { type: "string", enum: ["morning", "evening"] },
        strength_days: { type: "array", items: { type: "string" }, description: "Weekday names, e.g. Sunday" },
        run_days: { type: "array", items: { type: "string" }, description: "First is the easy run, second the interval day" },
        long_run_day: { type: "string", description: "Weekday name, or 'none'" },
      },
    },
  },
];

export const HEALTH_TOOL_NAMES = new Set(healthTools.map((t) => t.name));

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;

const weekdays = (v: unknown): string[] | null =>
  Array.isArray(v)
    ? v
        .map((d) => WEEKDAYS.find((w) => w.toLowerCase().startsWith(String(d).trim().toLowerCase().slice(0, 3))))
        .filter((d): d is string => Boolean(d))
    : null;

export async function executeHealthTool(name: string, raw: unknown): Promise<string> {
  const input = (raw ?? {}) as Record<string, unknown>;
  switch (name) {
    case "get_health": {
      const s = await getHealthSnapshot();
      const text = snapshotText(s, { days: num(input.days) ?? 7 });
      return s.hasData
        ? text
        : `No health data has arrived yet. The owner needs to set up the iPhone Shortcuts at /jarvis/health (token + automations). Until then this is the default plan.\n\n${text}`;
    }
    case "log_workout": {
      const r = await logWorkout({
        kind: String(input.kind ?? "other"),
        status: typeof input.status === "string" ? input.status : undefined,
        day: typeof input.day === "string" ? input.day : undefined,
        durationMin: num(input.duration_min),
        distanceKm: num(input.distance_km),
        pushups: num(input.pushups),
        squats: num(input.squats),
        plankSec: num(input.plank_sec),
        rpe: num(input.rpe),
        isTest: input.is_test === true,
        details: typeof input.details === "string" ? input.details : null,
      });
      const p = r.profile;
      return `SAVED: workout logged (${String(input.kind)}, ${typeof input.status === "string" ? input.status : "done"}).${
        r.profileChanged ? ` Plan progressed: push-ups max ${p.pushupMax}, squats max ${p.squatMax}, plank ${p.plankSec}s, easy run ${p.runEasyMin} min.` : ""
      }`;
    }
    case "update_fitness_profile": {
      const p = await loadProfile();
      const next: FitnessProfile = { ...p };
      const n = (k: string) => num(input[k]);
      const pm = n("pushup_max");
      if (pm != null) next.pushupMax = Math.max(1, Math.round(pm));
      const sm = n("squat_max");
      if (sm != null) next.squatMax = Math.max(1, Math.round(sm));
      const pl = n("plank_sec");
      if (pl != null) next.plankSec = Math.max(10, Math.round(pl));
      const re = n("run_easy_min");
      if (re != null) next.runEasyMin = Math.min(90, Math.max(5, Math.round(re)));
      const st = n("steps_target");
      if (st != null) next.stepsTarget = Math.max(1000, Math.round(st));
      const sl = n("sleep_target_h");
      if (sl != null) next.sleepTargetH = Math.min(10, Math.max(5, sl));
      if (input.workout_time === "morning" || input.workout_time === "evening") next.workoutTime = input.workout_time;
      const sd = weekdays(input.strength_days);
      if (sd) next.strengthDays = sd;
      const rd = weekdays(input.run_days);
      if (rd) next.runDays = rd;
      if (typeof input.long_run_day === "string") {
        next.longRunDay = input.long_run_day.toLowerCase() === "none" ? null : (weekdays([input.long_run_day])?.[0] ?? next.longRunDay);
      }
      await saveProfile(next);
      return `SAVED: training profile updated. ${JSON.stringify(next)}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
