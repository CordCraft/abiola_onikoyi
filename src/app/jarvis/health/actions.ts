"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { rotateHealthToken } from "@/lib/jarvis/health/data";

// Makes a new iPhone Shortcut key. Only its hash is stored, so the key is
// shown once; making a new one disables the old Shortcuts until updated.
export async function newHealthToken(): Promise<{ token?: string }> {
  await verifySession();
  const token = await rotateHealthToken();
  revalidatePath("/jarvis/health");
  return { token };
}
