"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import { programWeek } from "@/lib/mentorship/constants";

export type PortalFormResult = { error?: string; ok?: boolean } | undefined;

function clampMonth(value: FormDataEntryValue | null): number | null {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

export async function addGoal(
  _prev: PortalFormResult,
  formData: FormData,
): Promise<PortalFormResult> {
  const mentee = await verifyMentee();

  const title = String(formData.get("title") ?? "").trim();
  const detail = String(formData.get("detail") ?? "").trim() || null;
  const targetMonth = clampMonth(formData.get("targetMonth"));

  if (!title) return { error: "Give the goal a title." };

  await prisma.mentorshipGoal.create({
    data: { menteeId: mentee.id, title, detail, targetMonth },
  });

  revalidatePath("/mentorship/portal/goals");
  revalidatePath("/mentorship/portal");
  return { ok: true };
}

export async function setGoalStatus(formData: FormData): Promise<void> {
  const mentee = await verifyMentee();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["active", "completed"].includes(status)) return;

  // updateMany scoped to the mentee so nobody can touch another mentee's goal.
  await prisma.mentorshipGoal.updateMany({
    where: { id, menteeId: mentee.id },
    data: {
      status,
      completedAt: status === "completed" ? new Date() : null,
    },
  });

  revalidatePath("/mentorship/portal/goals");
  revalidatePath("/mentorship/portal");
}

export async function addTask(
  _prev: PortalFormResult,
  formData: FormData,
): Promise<PortalFormResult> {
  const mentee = await verifyMentee();

  const title = String(formData.get("title") ?? "").trim();
  const goalId = String(formData.get("goalId") ?? "").trim() || null;
  if (!title) return { error: "Give the task a title." };

  if (goalId) {
    const goal = await prisma.mentorshipGoal.findFirst({
      where: { id: goalId, menteeId: mentee.id },
      select: { id: true },
    });
    if (!goal) return { error: "That goal was not found." };
  }

  await prisma.mentorshipTask.create({
    data: { menteeId: mentee.id, goalId, title, createdBy: "mentee" },
  });

  revalidatePath("/mentorship/portal/goals");
  revalidatePath("/mentorship/portal");
  return { ok: true };
}

export async function toggleTask(formData: FormData): Promise<void> {
  const mentee = await verifyMentee();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const task = await prisma.mentorshipTask.findFirst({
    where: { id, menteeId: mentee.id },
  });
  if (!task) return;

  const done = task.status !== "done";
  await prisma.mentorshipTask.update({
    where: { id: task.id },
    data: { status: done ? "done" : "todo", completedAt: done ? new Date() : null },
  });

  revalidatePath("/mentorship/portal/goals");
  revalidatePath("/mentorship/portal");
}

export async function submitCheckin(
  _prev: PortalFormResult,
  formData: FormData,
): Promise<PortalFormResult> {
  const mentee = await verifyMentee();

  const wins = String(formData.get("wins") ?? "").trim();
  const blockers = String(formData.get("blockers") ?? "").trim() || null;
  const nextFocus = String(formData.get("nextFocus") ?? "").trim() || null;
  const confidenceRaw = Number(formData.get("confidence"));
  const confidence =
    confidenceRaw >= 1 && confidenceRaw <= 5 ? confidenceRaw : null;

  if (!wins) {
    return { error: "Share at least one win or piece of progress, however small." };
  }

  const week = Math.max(1, programWeek());

  const existing = await prisma.mentorshipCheckin.findFirst({
    where: { menteeId: mentee.id, week },
    select: { id: true },
  });
  if (existing) {
    return { error: `You have already checked in for week ${week}. See it below.` };
  }

  await prisma.mentorshipCheckin.create({
    data: { menteeId: mentee.id, week, wins, blockers, nextFocus, confidence },
  });

  revalidatePath("/mentorship/portal/checkins");
  revalidatePath("/mentorship/portal");
  return { ok: true };
}

export async function sendMessage(
  _prev: PortalFormResult,
  formData: FormData,
): Promise<PortalFormResult> {
  const mentee = await verifyMentee();

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Write a message first." };
  if (body.length > 5000) return { error: "Keep messages under 5000 characters." };

  await prisma.mentorshipMessage.create({
    data: { menteeId: mentee.id, sender: "mentee", body },
  });

  revalidatePath("/mentorship/portal/messages");
  return { ok: true };
}
