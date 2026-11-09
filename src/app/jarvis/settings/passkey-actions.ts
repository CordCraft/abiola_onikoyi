"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";

export type PasskeyRow = {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function listPasskeys(): Promise<PasskeyRow[]> {
  await verifySession();
  await ensureV2Tables();
  const rows = await prisma.jarvisPasskey.findMany({
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    deviceName: r.deviceName ?? "Unnamed device",
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

export async function removePasskey(id: string): Promise<{ ok: boolean }> {
  await verifySession();
  await ensureV2Tables();
  await prisma.jarvisPasskey.deleteMany({ where: { id: String(id) } });
  revalidatePath("/jarvis/settings");
  return { ok: true };
}
