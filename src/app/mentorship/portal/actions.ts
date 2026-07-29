"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifyMentee } from "@/lib/mentorship/dal";
import {
  PROGRAM_WEEKS,
  planDayIndex,
  programWeek,
  weekOfPlanDay,
} from "@/lib/mentorship/constants";
import {
  canCloseDay,
  canWorkDay,
  computeUnlockedWeek,
} from "@/lib/mentorship/plan";
import { ensureWeekGenerated } from "@/lib/mentorship/program-gen";
import { after } from "next/server";

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

  // For auto-generated programmes, have the newly unlocked week's tasks
  // ready (informed by this very check-in) by the time they open the page.
  // Hand-seeded plans already have every week; ensureWeekGenerated no-ops.
  if (week < PROGRAM_WEEKS) {
    const menteeId = mentee.id;
    after(() => ensureWeekGenerated(menteeId, week + 1).catch(() => {}));
  }

  revalidatePath("/mentorship/portal/checkins");
  revalidatePath("/mentorship/portal/program");
  revalidatePath("/mentorship/portal");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Daily programme actions
// ---------------------------------------------------------------------------

async function unlockedWeekFor(menteeId: string): Promise<number> {
  const todayIndex = planDayIndex();
  if (todayIndex < 1) return 0;
  const currentWeek = Math.min(
    Math.max(1, weekOfPlanDay(Math.max(1, todayIndex))),
    PROGRAM_WEEKS,
  );
  const checkins = await prisma.mentorshipCheckin.findMany({
    where: { menteeId },
    select: { week: true },
  });
  return computeUnlockedWeek(currentWeek, new Set(checkins.map((c) => c.week)));
}

function revalidateProgram() {
  revalidatePath("/mentorship/portal/program");
  revalidatePath("/mentorship/portal");
}

export async function togglePlanTask(
  _prev: PortalFormResult,
  formData: FormData,
): Promise<PortalFormResult> {
  const mentee = await verifyMentee();
  const id = String(formData.get("id") ?? "");
  const evidence = String(formData.get("evidence") ?? "").trim();
  if (!id) return { error: "Missing task." };

  const task = await prisma.mentorshipPlanTask.findFirst({
    where: { id, menteeId: mentee.id },
    include: { day: true },
  });
  if (!task) return { error: "That task was not found." };

  const unlocked = await unlockedWeekFor(mentee.id);
  if (!canWorkDay(task.day, unlocked)) {
    return { error: "This week is still locked. Submit last week's check-in first." };
  }

  if (task.status === "done") {
    await prisma.mentorshipPlanTask.update({
      where: { id: task.id },
      data: { status: "todo", completedAt: null },
    });
    revalidateProgram();
    return { ok: true };
  }

  if (task.evidenceHint && !evidence && !task.evidence) {
    return { error: "This task asks for evidence before it counts. Add it below." };
  }
  if (evidence.length > 8000) {
    return { error: "Keep evidence under 8000 characters (a link plus a summary is perfect)." };
  }

  await prisma.mentorshipPlanTask.update({
    where: { id: task.id },
    data: {
      status: "done",
      completedAt: new Date(),
      ...(evidence ? { evidence } : {}),
    },
  });
  revalidateProgram();
  return { ok: true };
}

export async function closePlanDay(
  _prev: PortalFormResult,
  formData: FormData,
): Promise<PortalFormResult> {
  const mentee = await verifyMentee();
  const id = String(formData.get("id") ?? "");
  const reflection = String(formData.get("reflection") ?? "").trim();
  const confidenceRaw = Number(formData.get("confidence"));
  const confidence =
    confidenceRaw >= 1 && confidenceRaw <= 5 ? confidenceRaw : null;

  if (!id) return { error: "Missing day." };
  if (!reflection) {
    return { error: "One honest line about the day. That is the whole ask." };
  }

  const day = await prisma.mentorshipPlanDay.findFirst({
    where: { id, menteeId: mentee.id },
    include: { tasks: { select: { status: true } } },
  });
  if (!day) return { error: "That day was not found." };
  if (day.completedAt) return { error: "This day is already closed out. Well done." };

  const unlocked = await unlockedWeekFor(mentee.id);
  if (!canCloseDay(day, unlocked)) {
    return { error: "You can close out a day once its date arrives." };
  }
  if (!day.tasks.some((t) => t.status === "done")) {
    return { error: "Complete at least one task before closing out the day." };
  }

  await prisma.mentorshipPlanDay.update({
    where: { id: day.id },
    data: { completedAt: new Date(), reflection, confidence },
  });
  revalidateProgram();
  return { ok: true };
}

// Generates the plan days for one week of the mentee's own programme, called
// automatically by the programme page when a needed week has no days yet
// (new signups get their weeks AI-generated on demand). Only weeks the
// mentee is allowed to see (unlocked + one preview) can be generated.
export async function prepareProgramWeek(
  week: number,
): Promise<{ ok: boolean }> {
  const mentee = await verifyMentee();
  const w = Math.floor(week);
  if (w < 1 || w > PROGRAM_WEEKS) return { ok: false };

  const unlocked = await unlockedWeekFor(mentee.id);
  const visible = Math.min(Math.max(unlocked, 1) + 1, PROGRAM_WEEKS);
  if (w > visible) return { ok: false };

  const result = await ensureWeekGenerated(mentee.id, w);
  if (result !== "failed") revalidateProgram();
  return { ok: result !== "failed" };
}

export async function requestAiTool(
  _prev: PortalFormResult,
  formData: FormData,
): Promise<PortalFormResult> {
  const mentee = await verifyMentee();
  const tool = String(formData.get("tool") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!["anthropic", "openai", "fal"].includes(tool)) {
    return { error: "Unknown tool." };
  }

  const existing = await prisma.mentorshipAiTool.findUnique({
    where: { menteeId_tool: { menteeId: mentee.id, tool } },
  });
  if (existing?.status === "granted") {
    return { error: "You already have access to this tool." };
  }

  await prisma.mentorshipAiTool.upsert({
    where: { menteeId_tool: { menteeId: mentee.id, tool } },
    create: { menteeId: mentee.id, tool, status: "requested", note },
    update: { status: "requested", ...(note ? { note } : {}) },
  });

  revalidatePath("/mentorship/portal/toolkit");
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
