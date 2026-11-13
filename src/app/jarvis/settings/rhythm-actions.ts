"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { RHYTHM_DEFAULTS as DEFAULTS, type Rhythm } from "@/lib/jarvis/v2/rhythm";


export async function loadRhythm(): Promise<{ rhythm: Rhythm; learned: Record<string, unknown> | null }> {
  await verifySession();
  const [saved, learned] = await Promise.all([
    prisma.jarvisSetting.findUnique({ where: { key: "rhythm" } }),
    prisma.jarvisSetting.findUnique({ where: { key: "rhythm_learned" } }),
  ]);
  const parse = (v?: string | null) => {
    try {
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  return { rhythm: { ...DEFAULTS, ...(parse(saved?.value) ?? {}) }, learned: parse(learned?.value) };
}

const hm = (v: FormDataEntryValue | null, fallback: string) => (/^\d{2}:\d{2}$/.test(String(v ?? "")) ? String(v) : fallback);

// Only the three offered levels are accepted: urgent 80, important 70, most things 50.
const threshold = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(v);
  return [80, 70, 50].includes(n) ? n : fallback;
};

export async function saveRhythm(_prev: { ok?: boolean } | undefined, f: FormData): Promise<{ ok?: boolean }> {
  await verifySession();
  const r: Rhythm = {
    tz: String(f.get("tz") || DEFAULTS.tz),
    workdays: f.getAll("workdays").map(String),
    workStart: hm(f.get("workStart"), DEFAULTS.workStart),
    workEnd: hm(f.get("workEnd"), DEFAULTS.workEnd),
    familyStart: hm(f.get("familyStart"), DEFAULTS.familyStart),
    familyEnd: hm(f.get("familyEnd"), DEFAULTS.familyEnd),
    quietStart: hm(f.get("quietStart"), DEFAULTS.quietStart),
    quietEnd: hm(f.get("quietEnd"), DEFAULTS.quietEnd),
    maxPushesPerDay: Math.min(Math.max(Number(f.get("maxPushesPerDay")) || DEFAULTS.maxPushesPerDay, 1), 60),
    maxPushesPerHour: Math.min(Math.max(Number(f.get("maxPushesPerHour")) || DEFAULTS.maxPushesPerHour, 1), 20),
    alwaysOn: f.get("alwaysOn") === "on",
    familyThreshold: threshold(f.get("familyThreshold"), DEFAULTS.familyThreshold),
    quietThreshold: threshold(f.get("quietThreshold"), DEFAULTS.quietThreshold),
    stopWorkPush: f.get("stopWorkPush") === "on",
  };
  const value = JSON.stringify(r);
  await prisma.jarvisSetting.upsert({ where: { key: "rhythm" }, create: { key: "rhythm", value }, update: { value } });
  revalidatePath("/jarvis/settings");
  return { ok: true };
}
