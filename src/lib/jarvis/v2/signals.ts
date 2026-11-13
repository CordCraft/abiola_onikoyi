import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";

// Signals are what the listener noticed plus the one-tap action it proposes.
// Acting on one queues a job; the Railway listener runs it within seconds.

export const OPEN_STATUSES = ["new", "pushed", "snoozed", "approved"];
// Closed by Jarvis (a reply, the reconcile pass or expiry). Never shown as needing attention; Undo reopens them.
export const CLOSED_BY_JARVIS = ["resolved", "expired"];

export async function closedSignals(days = 7, limit = 80) {
  await ensureV2Tables();
  return prisma.jarvisSignal.findMany({
    where: { status: { in: CLOSED_BY_JARVIS }, resolvedAt: { gte: new Date(Date.now() - days * 864e5) } },
    orderBy: { resolvedAt: "desc" },
    take: limit,
  });
}

export async function closedTasks(days = 7, limit = 80) {
  await ensureV2Tables();
  return prisma.jarvisTask.findMany({
    where: { closedBy: { not: null }, completedAt: { gte: new Date(Date.now() - days * 864e5) } },
    orderBy: { completedAt: "desc" },
    take: limit,
    include: { project: { select: { name: true } } },
  });
}

export async function openSignals(limit = 20) {
  await ensureV2Tables();
  return prisma.jarvisSignal.findMany({
    where: { status: { in: ["new", "pushed"] }, kind: { not: "fyi" } },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
}

export async function recentSignals(limit = 50) {
  await ensureV2Tables();
  return prisma.jarvisSignal.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function getSignal(id: string) {
  await ensureV2Tables();
  return prisma.jarvisSignal.findUnique({ where: { id } });
}

export async function enqueueJob(kind: string, payload: Prisma.InputJsonValue, target = "listener") {
  await ensureV2Tables();
  return prisma.jarvisJob.create({ data: { kind, target, payload } });
}

export type SignalDecision =
  | { action: "approve"; text?: string; mode?: "send" | "draft" }
  | { action: "dismiss" }
  | { action: "snooze"; hours?: number }
  | { action: "undo" }
  | { action: "undo_task"; taskId: string };

export async function decideSignal(id: string, d: SignalDecision): Promise<string> {
  if (d.action === "undo_task") {
    await enqueueJob("undo_task_close", { taskId: d.taskId });
    return "Reopening the task.";
  }
  const s = await getSignal(id);
  if (!s) return "Signal not found.";
  switch (d.action) {
    case "approve": {
      if (CLOSED_BY_JARVIS.includes(s.status)) return `Jarvis already closed this (${s.status}). Undo it first if you still want to act.`;
      if (!["new", "pushed", "snoozed", "failed"].includes(s.status)) return `Already ${s.status}.`;
      await prisma.jarvisSignal.update({ where: { id }, data: { status: "approved", decidedAt: new Date() } });
      await enqueueJob("apply_signal", { signalId: id, ...(d.text ? { text: d.text } : {}), mode: d.mode ?? "send" });
      return "On it.";
    }
    case "dismiss":
      if (CLOSED_BY_JARVIS.includes(s.status)) return "Already closed.";
      await prisma.jarvisSignal.update({ where: { id }, data: { status: "dismissed", decidedAt: new Date() } });
      return "Dismissed.";
    case "snooze": {
      const hours = Math.min(Math.max(d.hours ?? 3, 1), 24 * 7);
      await prisma.jarvisSignal.update({ where: { id }, data: { status: "snoozed", snoozeUntil: new Date(Date.now() + hours * 3600e3) } });
      return `Snoozed for ${hours} hours.`;
    }
    case "undo":
      if (s.status !== "applied" && !CLOSED_BY_JARVIS.includes(s.status)) return "Nothing to undo.";
      await enqueueJob("undo_signal", { signalId: id });
      return CLOSED_BY_JARVIS.includes(s.status) ? "Reopening it and its tasks." : "Undoing.";
  }
}

export function actionLabel(type: string | undefined): string {
  switch (type) {
    case "calendar_event":
      return "Add to calendar";
    case "create_task":
      return "Make it a task";
    case "send_reply":
      return "Send reply";
    case "plan_blocks":
      return "Block my calendar";
    case "cleanup":
      return "Approve clean-up";
    default:
      return "Mark done";
  }
}
