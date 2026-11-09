"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { createPairingCode } from "@/app/api/jarvis-bridge/lib";
import { queueMachineTask } from "@/lib/jarvis/tools-machines";

export type ActionResult = { ok: boolean; error?: string; id?: string };

export async function sendTask(input: {
  machineId: string;
  folder: string;
  prompt: string;
  mode: "plan" | "acceptEdits";
}): Promise<ActionResult> {
  await verifySession();
  try {
    const { job } = await queueMachineTask({
      machineId: String(input.machineId || ""),
      folder: String(input.folder || ""),
      prompt: String(input.prompt || ""),
      permissionMode: input.mode === "acceptEdits" ? "acceptEdits" : "plan",
    });
    revalidatePath("/jarvis/machines");
    return { ok: true, id: job.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not queue the task" };
  }
}

export async function cancelTask(jobId: string): Promise<ActionResult> {
  await verifySession();
  await ensureV2Tables();
  // Queued tasks never start; running ones are told to stop on the next progress ping.
  await prisma.jarvisJob.updateMany({
    where: { id: String(jobId), kind: "machine_task", status: { in: ["queued", "running"] } },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  revalidatePath("/jarvis/machines");
  return { ok: true };
}

export async function newPairingCode(): Promise<{ ok: boolean; code?: string; expiresAt?: number; error?: string }> {
  await verifySession();
  try {
    const { code, expiresAt } = await createPairingCode();
    return { ok: true, code, expiresAt };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create a code" };
  }
}

export async function removeMachine(machineId: string): Promise<ActionResult> {
  await verifySession();
  await ensureV2Tables();
  await prisma.jarvisMachine.deleteMany({ where: { id: String(machineId) } });
  revalidatePath("/jarvis/machines");
  return { ok: true };
}
