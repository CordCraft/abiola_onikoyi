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
          className="block rounded-lg bg-zinc-900 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-zinc-700"
        >
          + New chat
        </Link>
        <ul className="space-y-1">
          {threads.map((th) => (
            <li key={th.id}>
              <Link
                href={`/jarvis/chat?t=${th.id}`}
                className={`block truncate rounded-md px-3 py-2 text-sm ${
                  th.id === thread?.id
                    ? "bg-white font-medium text-zinc-900 ring-1 ring-zinc-200"
                    : "text-zinc-600 hover:bg-white"
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
