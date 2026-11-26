"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { applyTidy, closeItem, morningIn, parseRef, proposeTidy, snoozeItem, type TidyProposal } from "@/lib/jarvis/items";

export type ItemResult = { message?: string; error?: string } | undefined;

function refresh(ref?: string) {
  revalidatePath("/jarvis");
  revalidatePath("/jarvis/items");
  if (ref) revalidatePath(`/jarvis/items/${ref}`);
}

export async function itemQuick(_prev: ItemResult, f: FormData): Promise<ItemResult> {
  await verifySession();
  const ref = String(f.get("ref") ?? "");
  const action = String(f.get("action") ?? "");
  if (!parseRef(ref)) return { error: "Unknown item" };
  try {
    let message: string;
    if (action === "done") message = await closeItem(ref, String(f.get("reason") ?? "") || "You marked it done.");
    else if (action === "drop") message = await closeItem(ref, "Not needed any more.", ref.startsWith("task") ? "archived" : "done");
    else if (action === "tomorrow") message = await snoozeItem(ref, morningIn(1));
    else if (action === "nextweek") message = await snoozeItem(ref, morningIn(7));
    else return { error: "Unknown action" };
    refresh(ref);
    return { message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}

export type TidyState = { proposal?: TidyProposal; message?: string; error?: string } | undefined;

export async function tidyAction(_prev: TidyState, f: FormData): Promise<TidyState> {
  await verifySession();
  const step = String(f.get("step") ?? "propose");
  try {
    if (step === "propose") {
      if (!process.env.ANTHROPIC_API_KEY) return { error: "ANTHROPIC_API_KEY is not set on the server." };
      return { proposal: await proposeTidy() };
    }
    const close = f.getAll("close").map(String);
    const reasons = new Map(f.getAll("reason").map(String).map((r) => r.split("::") as [string, string]));
    const merge = f
      .getAll("merge")
      .map(String)
      .map((m) => {
        const [keep, dups] = m.split("::");
        return { keep, duplicates: (dups ?? "").split(",").filter(Boolean) };
      });
    const message = await applyTidy({ close: close.map((ref) => ({ ref, reason: reasons.get(ref) ?? "tidy up" })), merge });
    refresh();
    return { message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}

export async function saveDelegation(_prev: ItemResult, f: FormData): Promise<ItemResult> {
  await verifySession();
  await ensureV2Tables();
  const id = String(f.get("projectId") ?? "");
  const name = String(f.get("delegateName") ?? "").trim();
  const contact = String(f.get("delegateContact") ?? "").trim();
  const mins = Number(f.get("escalateMins") ?? 30);
  const kinds = f.getAll("delegateKinds").map(String).filter(Boolean);
  try {
    await prisma.jarvisProject.update({
      where: { id },
      data: {
        delegateName: name || null,
        delegateContact: contact || null,
        escalateMins: name ? Math.min(Math.max(Number.isFinite(mins) ? mins : 30, 5), 24 * 60) : null,
        delegateKinds: name ? (kinds.length ? kinds.join(",") : "reply,followup") : null,
      },
    });
    revalidatePath(`/jarvis/projects/${id}`);
    return { message: name ? `${name} now handles this project first.` : "Delegation removed." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed" };
  }
}
