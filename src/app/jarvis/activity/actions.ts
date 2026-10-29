"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { runSync } from "@/lib/jarvis/sync";

export async function syncNow(): Promise<void> {
  await verifySession();
  await runSync();
  revalidatePath("/jarvis/activity");
  revalidatePath("/jarvis");
}
