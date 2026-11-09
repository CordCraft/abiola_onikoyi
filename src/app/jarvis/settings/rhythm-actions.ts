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
  };
  const value = JSON.stringify(r);
  await prisma.jarvisSetting.upsert({ where: { key: "rhythm" }, create: { key: "rhythm", value }, update: { value } });
  revalidatePath("/jarvis/settings");
  return { ok: true };
}
