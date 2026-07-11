import Link from "next/link";
import { listThreads, getThread } from "@/lib/jarvis/queries";
import { deleteThread } from "@/app/jarvis/actions";
import { JarvisChat } from "@/components/jarvis/JarvisChat";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";

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

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr] lg:gap-6">
      <aside className="min-w-0 space-y-3">
        <Link
          href="/jarvis/chat"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 px-3 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New chat
        </Link>

        {/* Mobile: horizontal chip strip. Desktop: vertical list. */}
        <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          {threads.map((th) => (
            <li key={th.id} className="group relative shrink-0 lg:shrink">
              <Link
                href={`/jarvis/chat?t=${th.id}`}
                className={`block max-w-[180px] truncate rounded-lg px-3 py-2 pr-3 text-sm transition-colors lg:max-w-none lg:pr-8 ${
                  th.id === thread?.id
                    ? "bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                    : "text-zinc-500 hover:bg-white/70 hover:text-zinc-900"
                }`}
              >
                {th.title || "Untitled"}
              </Link>
              <form
                action={deleteThread}
                className="absolute right-1 top-1/2 hidden -translate-y-1/2 lg:group-hover:block"
              >
                <input type="hidden" name="id" value={th.id} />
                <ConfirmSubmit
                  message="Delete this conversation?"
                  className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-red-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </ConfirmSubmit>
              </form>
            </li>
          ))}
        </ul>
      </aside>

      <JarvisChat
        key={thread?.id ?? "new"}
        initialThreadId={thread?.id ?? null}
        initialMessages={initialMessages}
      />
    </div>
  );
}
