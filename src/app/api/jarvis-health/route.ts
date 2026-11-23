import { NextResponse } from "next/server";
import { checkHealthToken, getHealthSnapshot, loadRhythmSetting, recordDaily, recordPhoneUse, snapshotText } from "@/lib/jarvis/health/data";
import { addDays, localDay } from "@/lib/jarvis/health/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// iPhone -> Jarvis. Apple Shortcuts post here (see docs/JARVIS-HEALTH.md).
// Auth: "Authorization: Bearer <token>" or "x-health-key: <token>", where the
// token comes from /jarvis/health (only its hash is stored).
//
// POST bodies (any of these, all optional together):
//   { "event": "phone_use", "app": "WhatsApp" }        a tap / app open (now)
//   { "day": "today" | "yesterday" | "2026-11-23",
//     "metrics": { "steps": 8123, "resting_hr": 58, "hrv": "41\n47", ... } }
//   { "samples": [{ "metric": "steps", "value": 120, "day": "2026-11-23" }] }
// Values may be numbers or Shortcut text with several numbers (one per line);
// additive metrics are summed, the rest averaged.
//
// GET returns today's plan and status as plain text (for a "Jarvis plan" Siri shortcut).

const ALIASES: Record<string, string> = {
  step: "steps", step_count: "steps", steps: "steps",
  resting_heart_rate: "resting_hr", resting_hr: "resting_hr", rhr: "resting_hr",
  heart_rate: "heart_rate", hr: "heart_rate",
  heart_rate_variability: "hrv", hrv: "hrv",
  active_energy: "active_energy", active_calories: "active_energy", active_kcal: "active_energy",
  distance: "walking_running_km", walking_running_distance: "walking_running_km", walking_running_km: "walking_running_km",
  exercise_minutes: "exercise_min", exercise_min: "exercise_min",
  flights: "flights", flights_climbed: "flights",
  weight: "weight_kg", weight_kg: "weight_kg", body_mass: "weight_kg",
  sleep: "sleep_hours", sleep_hours: "sleep_hours", sleep_minutes: "sleep_minutes",
  vo2max: "vo2max", vo2_max: "vo2max",
  blood_oxygen: "spo2", spo2: "spo2", respiratory_rate: "respiratory_rate",
  mindful_minutes: "mindful_min", water: "water_ml", water_ml: "water_ml",
};
const ADDITIVE = new Set(["steps", "active_energy", "walking_running_km", "exercise_min", "flights", "sleep_minutes", "mindful_min", "water_ml"]);

function numbers(v: unknown): number[] {
  if (typeof v === "number") return Number.isFinite(v) ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(numbers);
  if (typeof v === "string") {
    // Shortcuts may use comma decimals; only treat a comma as decimal between digits with no spaces.
    return (v.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  }
  return [];
}

function key(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  return ALIASES[k] ?? (/^[a-z][a-z0-9_]{1,40}$/.test(k) ? k : null);
}

async function authorised(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : (req.headers.get("x-health-key") ?? "").trim();
  return checkHealthToken(given);
}

export async function POST(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON body required" }, { status: 400 });

  const { tz } = await loadRhythmSetting();
  const now = new Date();
  const today = localDay(now, tz);
  const resolveDay = (d: unknown): string => {
    const s = String(d ?? "today").trim().toLowerCase();
    if (s === "yesterday") return addDays(today, -1);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return today;
  };
  const source = `shortcut${body.app ? `:${String(body.app).slice(0, 40)}` : ""}`;
  const saved: string[] = [];

  if (body.event === "phone_use" || body.event === "tap" || body.event === "unlock") {
    await recordPhoneUse(now, source);
    saved.push("phone_use");
  }

  const day = resolveDay(body.day ?? body.date);
  const metrics = (body.metrics && typeof body.metrics === "object" ? body.metrics : {}) as Record<string, unknown>;
  for (const [raw, v] of Object.entries(metrics)) {
    const k = key(raw);
    const xs = numbers(v);
    if (!k || !xs.length) continue;
    let value = ADDITIVE.has(k) ? xs.reduce((a, b) => a + b, 0) : xs.reduce((a, b) => a + b, 0) / xs.length;
    let metric = k;
    if (k === "sleep_minutes") {
      metric = "sleep_hours";
      value = value / 60;
    }
    await recordDaily(day, metric, Math.round(value * 100) / 100, null, source, tz);
    saved.push(metric);
  }

  for (const s of Array.isArray(body.samples) ? (body.samples as Record<string, unknown>[]).slice(0, 200) : []) {
    const k = key(String(s.metric ?? ""));
    const xs = numbers(s.value);
    if (!k || !xs.length) continue;
    await recordDaily(resolveDay(s.day), k, Math.round(xs.reduce((a, b) => a + b, 0) / (ADDITIVE.has(k) ? 1 : xs.length) * 100) / 100, typeof s.unit === "string" ? s.unit : null, source, tz);
    saved.push(k);
  }

  return NextResponse.json({ ok: true, day, saved });
}

export async function GET(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const s = await getHealthSnapshot();
  const text = [
    `Readiness ${s.readiness.score}/100. ${s.plan.focus}.`,
    ...s.plan.items.map((i) => `${i.at} ${i.title}`),
  ].join("\n");
  const full = new URL(req.url).searchParams.get("full") === "1";
  return new Response(full ? snapshotText(s) : text, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
