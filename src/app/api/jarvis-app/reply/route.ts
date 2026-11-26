import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureCompanionTables } from "@/lib/jarvis/companion-setup";
import { phoneAuthorised } from "@/lib/jarvis/phone-auth";
import { siteBase, startTurnStep } from "@/lib/jarvis/app-turn";
import { decideSignal } from "@/lib/jarvis/v2/signals";
import { ensureV2Tables } from "@/lib/jarvis/v2/setup";
import { respawnRecurringTask } from "@/lib/jarvis/tools";
import { sendPushToAll } from "@/lib/jarvis/push";
import { getItem, itemContext } from "@/lib/jarvis/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A reply typed into (or a button tapped on) a native notification banner.
// POST { notificationId, text?, action?: "reply" | "done" | "approve" | "dismiss" }
// Buttons on tasks and signals act directly; everything else, and every typed
// reply, goes to Jarvis as a chat message with the notification as context.
// Answers in well under a second: the phone may only be awake briefly.
export async function POST(req: Request) {
  if (!(await phoneAuthorised(req))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { notificationId?: string; text?: string; action?: string } | null;
  await ensureCompanionTables();
  const n = body?.notificationId ? await prisma.jarvisNotification.findUnique({ where: { id: body.notificationId } }) : null;
  const action = body?.action ?? "reply";
  let text = String(body?.text ?? "").trim().slice(0, 4000);
  const ref = (n?.ref ?? {}) as Record<string, string>;

  if (n && !n.openedAt) await prisma.jarvisNotification.update({ where: { id: n.id }, data: { openedAt: new Date() } }).catch(() => {});

  // Deterministic buttons first.
  if (action === "approve" || action === "dismiss") {
    if (!ref.signalId) return NextResponse.json({ error: "not a signal" }, { status: 400 });
    await ensureV2Tables();
    const message = await decideSignal(ref.signalId, { action: action === "approve" ? "approve" : "dismiss" });
    return NextResponse.json({ ok: true, message });
  }
  if (action === "done" && ref.taskId) {
    const task = await prisma.jarvisTask.findUnique({ where: { id: ref.taskId } });
    if (task && (task.status === "todo" || task.status === "doing")) {
      await prisma.jarvisTask.update({ where: { id: task.id }, data: { status: "done", completedAt: new Date() } });
      await respawnRecurringTask(task);
    }
    return NextResponse.json({ ok: true, message: "Task marked done" });
  }
  if (action === "done") text = text || "Done";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  // Continue the conversation when replying to one of Jarvis's answers;
  // otherwise start a new chat that carries the notification as context.
  const refBits = Object.entries(ref)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  // A reply about one task or signal goes into that item's own chat.
  const itemRef = ref.signalId ? `signal-${ref.signalId}` : ref.taskId ? `task-${ref.taskId}` : null;
  const found = n && !n.threadId && itemRef ? await getItem(itemRef).catch(() => null) : null;
  const threadId = n?.threadId ?? found?.item.threadId ?? null;
  const message = threadId
    ? text
    : found
      ? `${itemContext(found.item)}\n\n${text}`
      : n
        ? `[Replying to your notification "${n.title}" sent ${n.createdAt.toISOString()}. It said: ${n.body}${refBits ? ` (${refBits})` : ""}]\n\n${text}`
        : text;

  const started = await startTurnStep({ threadId, message, replyTo: n?.id ?? null, item: found ? found.item.ref : undefined }, siteBase(req));
  if (!started) {
    await sendPushToAll({ title: "Jarvis did not get that", body: `Your reply "${text.slice(0, 80)}" could not be processed. Open Jarvis to send it again.`, url: "/jarvis/chat", kind: "other" }).catch(() => {});
    return NextResponse.json({ error: "could not start" }, { status: 502 });
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
