import Link from "next/link";
import { listThreads, getThread } from "@/lib/jarvis/queries";
import { JarvisChat } from "@/components/jarvis/JarvisChat";

export default async function JarvisChatPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const threads = await listThreads();
  const thread = t ? await getThread(t) : null;

  const initialMessages = (thread?.messages ?? []).map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));
  const initialProposals = (thread?.proposals ?? [])
    .filter((p) => p.status === "pending")
    .map((p) => ({ id: p.id, summary: p.summary, kind: p.kind }));

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-3">
        <Link
          href="/jarvis/chat"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 px-3 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New chat
        </Link>
        <ul className="space-y-1">
          {threads.map((th) => (
            <li key={th.id}>
              <Link
                href={`/jarvis/chat?t=${th.id}`}
                className={`block truncate rounded-lg px-3 py-2 text-sm transition-colors ${
                  th.id === thread?.id
                    ? "bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                    : "text-zinc-500 hover:bg-white/70 hover:text-zinc-900"
                }`}
              >
                {th.title || "Untitled"}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <JarvisChat
        key={thread?.id ?? "new"}
        initialThreadId={thread?.id ?? null}
        initialMessages={initialMessages}
        initialProposals={initialProposals}
      />
    </div>
  );
}
