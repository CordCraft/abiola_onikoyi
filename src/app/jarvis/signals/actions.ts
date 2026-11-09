"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { decideSignal } from "@/lib/jarvis/v2/signals";

export type SignalResult = { message?: string; error?: string } | undefined;

export async function decide(_prev: SignalResult, f: FormData): Promise<SignalResult> {
  await verifySession();
  const id = String(f.get("id") ?? "");
  const action = String(f.get("action") ?? "");
  try {
    let message: string;
    if (action === "approve" || action === "draft") {
      const text = String(f.get("text") ?? "").trim() || undefined;
      message = await decideSignal(id, { action: "approve", text, mode: action === "draft" ? "draft" : "send" });
    } else if (action === "snooze") {
      message = await decideSignal(id, { action: "snooze", hours: Number(f.get("hours") ?? 3) });
    } else if (action === "dismiss" || action === "undo") {
      message = await decideSignal(id, { action });
    } else {
      return { error: "Unknown action" };
    }
    revalidatePath("/jarvis");
    revalidatePath(`/jarvis/signals/${id}`);
    revalidatePath("/jarvis/signals");
    return { message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}
