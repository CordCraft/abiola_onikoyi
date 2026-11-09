import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getSignal } from "@/lib/jarvis/v2/signals";
import { toView } from "@/lib/jarvis/v2/view";
import { SignalCard } from "@/components/jarvis/SignalCard";

export const dynamic = "force-dynamic";

const TZ = process.env.OWNER_TZ || "Asia/Kuwait";

export default async function SignalPage({ params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;
  const s = await getSignal(id);
  if (!s) notFound();
  const ids = Array.isArray(s.inboundIds) ? (s.inboundIds as string[]) : [];
  const messages = ids.length
    ? await prisma.jarvisInbound.findMany({ where: { id: { in: ids } }, orderBy: { occurredAt: "asc" } })
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/jarvis" className="text-sm text-zinc-500 hover:text-zinc-900">
        Back to Today
      </Link>
      <SignalCard s={toView(s)} />
      {messages.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">What Jarvis heard</h2>
          {messages.map((m) => (
            <div key={m.id} className="rounded-xl bg-white/70 p-3 text-sm ring-1 ring-zinc-200">
              <p className="text-xs text-zinc-400">
                {m.direction === "out" ? "You" : m.senderName || m.sender} · {m.source === "whatsapp" ? (m.isGroup ? m.chatName : "WhatsApp") : m.subject || m.source} ·{" "}
                {m.occurredAt.toLocaleString("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 whitespace-pre-line text-zinc-700">{m.body.slice(0, 2000)}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
