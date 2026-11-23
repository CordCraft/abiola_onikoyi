import type { Rhythm } from "@/lib/jarvis/v2/rhythm";
import { hmToMinutes, minutesToHm, weekdayOf } from "./time";

// Bodyweight-first training: push-ups, squats and planks three times a week,
// running twice (plus a long easy run once the base is built), everything
// else is daily movement and sleep. Pure functions so the page, the coach
// cron and the chat tools all agree on the same plan.

export type FitnessProfile = {
  pushupMax: number; // best set of clean push-ups
  squatMax: number; // best set of bodyweight squats
  plankSec: number; // best plank hold
  runEasyMin: number; // comfortable continuous easy run today
  stepsTarget: number;
  sleepTargetH: number;
  workoutTime: "morning" | "evening";
  strengthDays: string[];
  runDays: string[];
  longRunDay: string | null; // used once the easy run reaches 25 minutes
  startedAt: string; // YYYY-MM-DD
};

export const PROFILE_DEFAULTS: FitnessProfile = {
  pushupMax: 20,
  squatMax: 30,
  plankSec: 45,
  runEasyMin: 20,
  stepsTarget: 8000,
  sleepTargetH: 7.5,
  workoutTime: "morning",
  strengthDays: ["Sunday", "Tuesday", "Thursday"],
  runDays: ["Monday", "Wednesday"],
  longRunDay: "Saturday",
  startedAt: "2026-11-23",
};

export type Readiness = {
  score: number; // 0-100
  level: "green" | "amber" | "red";
  reasons: string[];
};

export function computeReadiness(input: {
  sleepHours: number | null;
  sleepTargetH: number;
  restingHr: number | null;
  restingHrBaseline: number | null;
  hrv: number | null;
  hrvBaseline: number | null;
  hardYesterday: boolean;
}): Readiness {
  let score = 75;
  const reasons: string[] = [];
  const s = input.sleepHours;
  if (s != null) {
    if (s < 5) {
      score -= 25;
      reasons.push(`only ${s}h sleep`);
    } else if (s < 6) {
      score -= 15;
      reasons.push(`${s}h sleep, short`);
    } else if (s < input.sleepTargetH - 0.5) {
      score -= 5;
      reasons.push(`${s}h sleep, a bit under target`);
    } else {
      score += 10;
      reasons.push(`${s}h sleep`);
    }
  } else reasons.push("no sleep estimate yet");
  if (input.restingHr != null && input.restingHrBaseline != null) {
    const d = input.restingHr - input.restingHrBaseline;
    if (d >= 5) {
      score -= 15;
      reasons.push(`resting HR ${Math.round(d)} bpm above normal`);
    } else if (d >= 3) {
      score -= 7;
      reasons.push("resting HR slightly up");
    } else if (d <= -2) {
      score += 5;
      reasons.push("resting HR low (good)");
    }
  }
  if (input.hrv != null && input.hrvBaseline != null && input.hrvBaseline > 0) {
    const r = input.hrv / input.hrvBaseline;
    if (r < 0.8) {
      score -= 15;
      reasons.push(`HRV ${Math.round((1 - r) * 100)}% below normal`);
    } else if (r > 1.1) {
      score += 5;
      reasons.push("HRV above normal");
    }
  }
  if (input.hardYesterday) {
    score -= 5;
    reasons.push("hard session yesterday");
  }
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 70 ? "green" : score >= 50 ? "amber" : "red", reasons };
}

export type PlanItem = {
  id: string; // stable per day, used to avoid duplicate pushes
  at: string; // HH:MM local
  title: string;
  detail: string;
  kind: "wake" | "strength" | "run" | "move" | "steps" | "winddown" | "rest";
  notify: boolean;
};

export type DayPlan = {
  day: string;
  weekday: string;
  focus: string;
  items: PlanItem[];
};

const r5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

// Rotating sessions keep it interesting and cover the whole body.
function strengthSession(p: FitnessProfile, variant: number, easy: boolean): { title: string; detail: string } {
  const rounds = easy ? 2 : 3;
  const push = Math.max(5, Math.round(p.pushupMax * 0.6));
  const squat = Math.max(10, Math.round(p.squatMax * 0.6));
  const plank = r5(p.plankSec * 0.7);
  const warm = "Warm-up 5 min: 30 jumping jacks, arm circles, leg swings, 10 slow squats.";
  const cool = "Cool-down 3 min: chest, hip flexor and hamstring stretch.";
  const sessions = [
    {
      title: "Strength A: push-ups, squats, plank",
      lines: [`Push-ups ${push}`, `Squats ${squat}`, `Plank ${plank}s`, "Glute bridges 15"],
    },
    {
      title: "Strength B: push variety + lunges",
      lines: [
        `${p.pushupMax >= 25 ? "Diamond" : "Wide"} push-ups ${Math.max(5, Math.round(push * 0.8))}`,
        "Reverse lunges 10 each leg",
        `Side plank ${r5(plank * 0.6)}s each side`,
        `Pike push-ups ${Math.max(5, Math.round(push * 0.4))}`,
        "Superman hold 20s",
      ],
    },
    {
      title: "Strength C: ladders + test",
      lines: [
        "Push-up ladder 1-2-3-4-5-4-3-2-1 (rest as needed)",
        `${p.squatMax >= 45 ? `Jump squats ${Math.round(squat * 0.4)}` : `Squats ${squat}`}`,
        `Plank ${plank}s`,
        "Last round only: one max set of push-ups and one max plank, then reply with the numbers",
      ],
    },
  ];
  const s = sessions[variant % sessions.length];
  return {
    title: s.title,
    detail: `${warm} Then ${rounds} rounds, 60-90s rest between rounds: ${s.lines.join(", ")}. ${cool}${easy ? " Low readiness today, so 2 rounds only." : ""}`,
  };
}

function runSession(p: FitnessProfile, kind: "easy" | "intervals" | "long", backOff: boolean, hot: boolean): { title: string; detail: string } {
  const heat = hot ? " It is hot: run before 07:00 or after sunset and carry water." : "";
  const base = p.runEasyMin;
  const walkRun = base < 20;
  if (backOff || kind === "easy") {
    const mins = backOff && kind !== "easy" ? Math.round(base * 0.75) : base;
    return {
      title: `${walkRun ? "Walk-run" : "Easy run"} ${mins} min`,
      detail: walkRun
        ? `Alternate 2 min jog / 1 min brisk walk for ${mins} min. Conversational pace: you should be able to talk.${heat}`
        : `${mins} min at conversational pace (you can speak in full sentences). Finish with 4 x 15s relaxed strides.${heat}${backOff && kind !== "easy" ? " Swapped from a harder session because readiness is low." : ""}`,
    };
  }
  if (kind === "intervals") {
    const reps = Math.max(5, Math.min(10, 5 + Math.floor((base - 20) / 4)));
    return {
      title: `Intervals: ${reps} x 1 min fast`,
      detail: `5 min easy jog, then ${reps} x (1 min fast but controlled / 2 min easy), then 5 min easy. Fast means hard breathing, not a sprint.${heat}`,
    };
  }
  const long = Math.min(60, Math.round(base * 1.5));
  return { title: `Long easy run ${long} min`, detail: `${long} min slow and steady. Walk breaks are fine. This builds your engine.${heat}` };
}

export function buildDayPlan(args: {
  day: string;
  profile: FitnessProfile;
  rhythm: Rhythm;
  readiness: Readiness;
  wakeMinutes: number | null; // inferred wake time today, local minutes
  strengthDoneThisWeek: number;
  month: number; // 1-12, for heat advice
}): DayPlan {
  const { day, profile: p, rhythm, readiness } = args;
  const weekday = weekdayOf(day);
  const workday = rhythm.workdays.includes(weekday);
  const wake = args.wakeMinutes ?? hmToMinutes(rhythm.quietEnd);
  const workStart = hmToMinutes(rhythm.workStart);
  const workEnd = hmToMinutes(rhythm.workEnd);
  const quietStart = hmToMinutes(rhythm.quietStart);
  const red = readiness.level === "red";
  const hot = args.month >= 5 && args.month <= 9;
  const items: PlanItem[] = [];

  items.push({
    id: "wake",
    at: minutesToHm(wake + 10),
    title: "Water + 5-min mobility",
    detail: "Big glass of water. Cat-cow, hip circles, 10 slow squats, shoulder rolls. A few minutes of daylight.",
    kind: "wake",
    notify: false, // the morning brief covers this
  });

  // Today's workout goes before work if there is a 50-minute window,
  // otherwise straight after work.
  const morningSlot = wake + 20;
  const fitsMorning = !workday || workStart - morningSlot >= 50;
  const workoutAt = p.workoutTime === "morning" && fitsMorning ? morningSlot : workday ? workEnd + 10 : wake + 60;

  const strengthIdx = p.strengthDays.indexOf(weekday);
  const runIdx = p.runDays.indexOf(weekday);
  const longRun = p.longRunDay === weekday && p.runEasyMin >= 25;
  let focus = "Rest and move";

  if (strengthIdx >= 0) {
    const s = strengthSession(p, strengthIdx, red);
    focus = s.title;
    items.push({ id: "strength", at: minutesToHm(workoutAt), title: s.title, detail: s.detail, kind: "strength", notify: true });
  }
  if (runIdx >= 0 || longRun) {
    const kind = longRun && runIdx < 0 ? "long" : runIdx === 1 ? "intervals" : "easy";
    const r = runSession(p, kind, red || (readiness.level === "amber" && kind === "intervals"), hot);
    focus = strengthIdx >= 0 ? `${focus} + ${r.title}` : r.title;
    items.push({
      id: "run",
      at: minutesToHm(strengthIdx >= 0 ? (workday ? workEnd + 10 : wake + 240) : workoutAt),
      title: r.title,
      detail: r.detail,
      kind: "run",
      notify: true,
    });
  }
  if (strengthIdx < 0 && runIdx < 0 && !longRun) {
    // Rest day; offer a bonus mini session if strength is behind this week.
    const behind = args.strengthDoneThisWeek < Math.min(2, p.strengthDays.length);
    items.push({
      id: "rest",
      at: minutesToHm(workday ? workEnd + 10 : wake + 90),
      title: behind ? "Catch-up: 10-minute bodyweight set" : "Active rest: 30-min walk",
      detail: behind
        ? `You are behind on strength this week. 2 rounds: push-ups ${Math.max(5, Math.round(p.pushupMax * 0.5))}, squats ${Math.max(10, Math.round(p.squatMax * 0.5))}, plank ${r5(p.plankSec * 0.6)}s.`
        : "Easy walk, ideally outside with family. No training needed today.",
      kind: "rest",
      notify: behind,
    });
  }

  if (workday) {
    items.push(
      { id: "move1", at: minutesToHm(workStart + 150), title: "Move break", detail: "Stand up: 15 squats, 10 desk push-ups, 1 min of walking. Refill water.", kind: "move", notify: true },
      { id: "move2", at: minutesToHm(workStart + 270), title: "Lunch walk", detail: "10 minutes walking after lunch steadies blood sugar and adds 1,000+ steps.", kind: "move", notify: true },
      { id: "move3", at: minutesToHm(workStart + 420), title: "Afternoon reset", detail: "Plank 30s, 15 squats, stretch hips and chest. Water.", kind: "move", notify: true },
    );
  }

  items.push({
    id: "steps",
    at: minutesToHm(Math.min(workEnd, 17 * 60)),
    title: `Steps check (target ${p.stepsTarget.toLocaleString("en-US")})`,
    detail: "If you are short, add a 15-20 minute walk this evening.",
    kind: "steps",
    notify: false, // the coach sends this only when you are actually behind
  });

  items.push({
    id: "winddown",
    at: minutesToHm(quietStart - 45),
    title: "Wind down",
    detail: `Phone down by ${minutesToHm(quietStart)} so you get ${p.sleepTargetH}h. Your last tap is when Jarvis starts counting sleep. Dim lights, no caffeine after 15:00.`,
    kind: "winddown",
    notify: true,
  });

  items.sort((a, b) => hmToMinutes(a.at) - hmToMinutes(b.at));
  return { day, weekday, focus, items };
}

// Adjust the profile from a logged session: max tests set the numbers, and
// completed easy runs nudge the base up, so the plan progresses on its own.
export function progressProfile(
  p: FitnessProfile,
  w: { kind: string; status: string; pushups?: number | null; squats?: number | null; plankSec?: number | null; durationMin?: number | null; isTest?: boolean },
): FitnessProfile {
  const next = { ...p };
  if (w.status !== "done") return next;
  if (w.pushups && (w.isTest || w.pushups > p.pushupMax)) next.pushupMax = Math.max(1, w.pushups);
  if (w.squats && (w.isTest || w.squats > p.squatMax)) next.squatMax = Math.max(1, w.squats);
  if (w.plankSec && (w.isTest || w.plankSec > p.plankSec)) next.plankSec = Math.max(10, w.plankSec);
  if (w.kind === "run" && w.durationMin && w.durationMin >= p.runEasyMin) next.runEasyMin = Math.min(45, p.runEasyMin + 1);
  return next;
}
