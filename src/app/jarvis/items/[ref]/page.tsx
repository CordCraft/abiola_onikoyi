import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getItem, itemContext } from "@/lib/jarvis/items";
import { getThread } from "@/lib/jarvis/queries";
import { toView } from "@/lib/jarvis/v2/view";
import { SignalCard } from "@/components/jarvis/SignalCard";
import { ItemRow } from "@/components/jarvis/ItemRow";
import { JarvisChat, type ChatItem } from "@/components/jarvis/JarvisChat";

export const dynamic = "force-dynamic";

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";

const QUICK_TASK = ["Done", "Someone else handled it", "I'll do it tomorrow", "Not needed any more", "Help me do it"];
const QUICK_SIGNAL = ["Done, I replied myself", "Najeeb handled it", "Send the reply", "Not needed any more", "Tell me more"];

// One item: what it is, and a chat about it. Whatever you type ("done",
// "I'll do it Friday after I call Bolanle") goes to Jarvis with the item
// attached, and Jarvis closes, reschedules or notes your plan.
export default async function ItemPage({ params }: { params: Promise<{ ref: string }> }) {
  await verifySession();
  const { ref } = await params;
  const found = await getItem(decodeURIComponent(ref));
  if (!found) notFound();
  const { item, signal } = found;

  const ids = signal && Array.isArray(signal.inboundIds) ? (signal.inboundIds as string[]) : [];
  const [messages, thread] = await Promise.all([
    ids.length ? prisma.jarvisInbound.findMany({ where: { id: { in: ids } }, orderBy: { occurredAt: "asc" } }) : Promise.resolve([]),
    item.threadId ? getThread(item.threadId).catch(() => null) : Promise.resolve(null),
  ]);
  const chatItems: ChatItem[] = (thread?.messages ?? []).map((m) => ({
    kind: "msg" as const,
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Link href="/jarvis/items" className="text-sm text-zinc-500 hover:text-zinc-900">
        Back to your list
      </Link>

      {signal ? (
        <SignalCard s={toView(signal)} />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-sm">
          <ItemRow item={item} closed={!item.open} />
        </ul>
      )}
      {!item.open && item.closedNote ? <p className="text-sm text-zinc-500">Closed: {item.closedNote}</p> : null}

      {messages.length > 0 && (
        <details className="rounded-2xl bg-white/60 p-3 ring-1 ring-zinc-200">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">What Jarvis heard ({messages.length})</summary>
          <div className="mt-2 space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="rounded-xl bg-white/80 p-3 text-sm ring-1 ring-zinc-100">
                <p className="text-xs text-zinc-400">
                  {m.direction === "out" ? "You" : m.senderName || m.sender} · {m.source === "whatsapp" ? (m.isGroup ? m.chatName : "WhatsApp") : m.subject || m.source} ·{" "}
                  {m.occurredAt.toLocaleString("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="mt-1 whitespace-pre-line text-zinc-700">{m.body.slice(0, 2000)}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <JarvisChat
        initialThreadId={thread?.id ?? null}
        initialItems={chatItems}
        contextPrefix={thread ? undefined : itemContext(item)}
        quickReplies={item.open ? (item.kind === "task" ? QUICK_TASK : QUICK_SIGNAL) : item.kind === "task" ? ["Reopen it", "What happened?"] : ["What happened?"]}
        itemRef={item.ref}
      />
    </div>
  );
}
