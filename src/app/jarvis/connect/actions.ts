"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { enqueueJob } from "@/lib/jarvis/v2/signals";

export async function setPurpose(f: FormData) {
  await verifySession();
  await ensureV2Tables();
  const id = String(f.get("id") ?? "");
  const purpose = f.get("purpose") === "work" ? "work" : "personal";
  await prisma.jarvisConnection.update({ where: { id }, data: { purpose } });
  revalidatePath("/jarvis/connect");
}

export async function togglePaused(f: FormData) {
  await verifySession();
  await ensureV2Tables();
  const id = String(f.get("id") ?? "");
  const c = await prisma.jarvisConnection.findUnique({ where: { id } });
  if (!c) return;
  await prisma.jarvisConnection.update({ where: { id }, data: { status: c.status === "paused" ? "active" : "paused" } });
  revalidatePath("/jarvis/connect");
}

export async function removeConnection(f: FormData) {
  await verifySession();
  await ensureV2Tables();
  const id = String(f.get("id") ?? "");
  await prisma.jarvisConnection.delete({ where: { id } }).catch(() => {});
  revalidatePath("/jarvis/connect");
}

// Which account receives work events and which personal ones.
export async function setRouting(f: FormData) {
  await verifySession();
  const value = JSON.stringify({ work: String(f.get("work") ?? ""), personal: String(f.get("personal") ?? "") });
  await prisma.jarvisSetting.upsert({
    where: { key: "calendar_routing" },
    create: { key: "calendar_routing", value },
    update: { value },
  });
  revalidatePath("/jarvis/connect");
}

export async function unlinkWhatsApp() {
  await verifySession();
  await enqueueJob("whatsapp_logout", {});
  revalidatePath("/jarvis/connect");
}

export async function planToday() {
  await verifySession();
  const url = process.env.LISTENER_URL?.replace(/\/$/, "");
  const key = process.env.LISTENER_ADMIN_KEY;
  if (!url || !key) return;
  await fetch(`${url}/admin/plan-now`, { method: "POST", headers: { "x-admin-key": key } }).catch(() => {});
  revalidatePath("/jarvis");
}
