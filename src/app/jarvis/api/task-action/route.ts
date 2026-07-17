import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { respawnRecurringTask } from "@/lib/jarvis/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Executes "Mark done" / "Snooze" buttons on nudge notifications. Called by
// the service worker with the session cookie (same-origin credentials).
export async function POST(req: Request) {
  try {
    await verifySession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { taskId?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const task = body.taskId
    ? await prisma.jarvisTask.findUnique({ where: { id: body.taskId } })
    : null;
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  if (body.action === "done") {
    await prisma.jarvisTask.update({
      where: { id: task.id },
      data: { status: "done", completedAt: new Date() },
    });
    await respawnRecurringTask(task);
    return NextResponse.json({ ok: true, action: "done" });
  }

  if (body.action === "snooze") {
    const base = task.dueDate && task.dueDate.getTime() > Date.now() ? task.dueDate : new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + 1);
    await prisma.jarvisTask.update({ where: { id: task.id }, data: { dueDate: next } });
    return NextResponse.json({ ok: true, action: "snooze", dueDate: next.toISOString() });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
