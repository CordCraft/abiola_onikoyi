import Link from "next/link";
import { listThreads, getThread } from "@/lib/jarvis/queries";
import { prisma } from "@/lib/prisma";
import { deleteThread } from "@/app/jarvis/actions";
import { JarvisChat, type ChatItem, type SavedRecord } from "@/components/jarvis/JarvisChat";
import { ThreadRename } from "@/components/jarvis/ThreadRename";
import { ConfirmSubmit } from "@/components/dashboard/ConfirmSubmit";

const FRESH_DAYS = 30;

export default async function JarvisChatPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; doc?: string; inbox?: string }>;
}) {
  const { t, doc, inbox } = await searchParams;
  const threads = await listThreads();
  const thread = t ? await getThread(t) : null;

  // Rebuild the chat feed: receipts (from the JSON column) render before the
  // assistant message of their turn, matching the live stream order.
  const initialItems: ChatItem[] = [];
  for (const m of thread?.messages ?? []) {
    const receipts = Array.isArray(m.receipts) ? (m.receipts as unknown as SavedRecord[]) : null;
    if (m.role === "assistant" && receipts?.length) {
      initialItems.push({ kind: "receipts", records: receipts });
    }
    initialItems.push({
      kind: "msg",
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    });
  }

  // Prefills: file-the-inbox shortcut, or "discuss in chat" from a document page
  let initialInput: string | undefined;
  if (inbox && !thread) {
    initialInput = "File my inbox captures into the right projects, and turn any action items into tasks.";
  }
  if (doc && !thread) {
    const d = await prisma.jarvisDocument
      .findUnique({ where: { id: doc }, select: { id: true, name: true } })
      .catch(() => null);
    if (d) initialInput = `About the document "${d.name}" [doc:${d.id}]: `;
  }

  // Server component: rendered per request, so "now" is safe here.
  // eslint-disable-next-line react-hooks/purity
  const cutoff = Date.now() - FRESH_DAYS * 24 * 60 * 60 * 1000;
  const fresh = threads.filter((th) => th.updatedAt.getTime() >= cutoff || th.id === thread?.id);
  const older = threads.filter((th) => th.updatedAt.getTime() < cutoff && th.id !== thread?.id);

  const threadRow = (th: (typeof threads)[number]) => (
    <li key={th.id} className="group relative shrink-0 lg:shrink">
      <Link
        href={`/jarvis/chat?t=${th.id}`}
        className={`block max-w-[180px] truncate rounded-lg px-3 py-2 pr-3 text-sm transition-colors lg:max-w-none lg:pr-14 ${
          th.id === thread?.id
            ? "bg-white font-medium text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
            : "text-zinc-500 hover:bg-white/70 hover:text-zinc-900"
        }`}
      >
        {th.title || "Untitled"}
      </Link>
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center lg:group-hover:flex">
        <ThreadRename id={th.id} title={th.title || "Untitled"} />
        <form action={deleteThread}>
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
      </div>
    </li>
  );

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
          {fresh.map(threadRow)}
        </ul>
        {older.length > 0 ? (
          <details className="hidden lg:block">
            <summary className="cursor-pointer px-3 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-600">
              Older ({older.length})
            </summary>
            <ul className="mt-1 flex flex-col gap-1">{older.map(threadRow)}</ul>
          </details>
        ) : null}
      </aside>

      <JarvisChat
        key={thread?.id ?? "new"}
        initialThreadId={thread?.id ?? null}
        initialItems={initialItems}
        initialInput={initialInput}
      />
    </div>
  );
}
