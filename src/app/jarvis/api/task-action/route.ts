import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { respawnRecurringTask } from "@/lib/jarvis/tools";
import { buildToday } from "@/lib/jarvis/mobile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Executes "Mark done" / "Snooze" buttons on nudge notifications. Called by
// the service worker with the session cookie (same-origin credentials), and by
// the iPhone app, its widgets and Siri with a device Bearer token.
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

  // From the iPhone app: undo a done tap, start a task, or bump its priority.
  if (body.action === "reopen") {
    await prisma.jarvisTask.update({ where: { id: task.id }, data: { status: "todo", completedAt: null } });
    return NextResponse.json({ ok: true, action: "reopen" });
  }

  if (body.action === "doing") {
    await prisma.jarvisTask.update({ where: { id: task.id }, data: { status: "doing" } });
    return NextResponse.json({ ok: true, action: "doing" });
  }

  if (body.action === "today") {
    const today = new Date((await buildToday(1)).date); // owner's local day
    await prisma.jarvisTask.update({ where: { id: task.id }, data: { dueDate: today } });
    return NextResponse.json({ ok: true, action: "today" });
  }

  if (body.action === "high" || body.action === "medium" || body.action === "low") {
    await prisma.jarvisTask.update({ where: { id: task.id }, data: { priority: body.action } });
    return NextResponse.json({ ok: true, action: body.action });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
