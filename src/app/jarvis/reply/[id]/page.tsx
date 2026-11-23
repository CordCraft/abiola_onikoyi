import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { ensureCompanionTables } from "@/lib/jarvis/companion-setup";
import { JarvisChat, type ChatItem } from "@/components/jarvis/JarvisChat";
import { getThread } from "@/lib/jarvis/queries";

export const dynamic = "force-dynamic";

const QUICK: Record<string, string[]> = {
  health: ["Done", "Done, it felt easy", "Done, it was hard", "Skipping today", "Move it to this evening"],
  task: ["Mark it done", "Snooze to tomorrow", "Break it into steps"],
  signal: ["Do it", "Not now", "Tell me more"],
  briefing: ["Got it", "Plan my day around this", "Tell me more"],
  reply: ["Thanks", "Do it", "Tell me more"],
  other: ["Got it", "Tell me more"],
};

// Tapping any Jarvis notification lands here: the message, one-tap answers
// and a text box. The answer goes to Jarvis with the notification attached,
// so it can log the workout, finish the task or act on the signal.
export default async function ReplyPage({ params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  await ensureCompanionTables();
  const { id } = await params;
  const n = await prisma.jarvisNotification.findUnique({ where: { id } });
  if (!n) notFound();
  if (!n.openedAt) await prisma.jarvisNotification.update({ where: { id }, data: { openedAt: new Date() } }).catch(() => {});

  const ref = (n.ref ?? {}) as Record<string, string>;
  const kind = n.kind && QUICK[n.kind] ? n.kind : "other";
  const refBits = Object.entries(ref)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  const contextPrefix = `[Replying to your notification "${n.title}" sent ${n.createdAt.toISOString()}. It said: ${n.body}${refBits ? ` (${refBits})` : ""}]`;
  // A notification that is Jarvis answering an earlier reply continues that chat.
  const thread = n.threadId ? await getThread(n.threadId).catch(() => null) : null;
  const items: ChatItem[] = (thread?.messages ?? []).map((m) => ({
    kind: "msg" as const,
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));
  const openUrl = n.url && n.url !== "/jarvis" && !n.url.startsWith("/jarvis/reply") ? n.url : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-500">Jarvis asked</p>
            <h1 className="mt-1 text-lg font-semibold text-zinc-900">{n.title}</h1>
          </div>
          {openUrl ? (
            <Link href={openUrl} className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-400">
              Open
            </Link>
          ) : null}
        </div>
        {n.body ? <p className="mt-2 whitespace-pre-line text-sm text-zinc-600">{n.body}</p> : null}
      </div>
      <JarvisChat
        initialThreadId={thread?.id ?? null}
        initialItems={items}
        contextPrefix={thread ? undefined : contextPrefix}
        quickReplies={QUICK[kind]}
        autoFocus
      />
    </div>
  );
}
