import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { needsYou, recentlyClosed, waitingOnOthers } from "@/lib/jarvis/items";
import { ItemRow } from "@/components/jarvis/ItemRow";
import { TidyUp } from "@/components/jarvis/TidyUp";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "open", label: "Needs you" },
  { key: "waiting", label: "With others" },
  { key: "closed", label: "Closed this week" },
] as const;

// Every task and everything Jarvis noticed, as one list.
export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await verifySession();
  const { view = "open" } = await searchParams;
  const items = view === "waiting" ? await waitingOnOthers() : view === "closed" ? await recentlyClosed() : await needsYou(200);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Your list</h1>
          <p className="text-sm text-zinc-500">Tap anything to talk to Jarvis about it. Say &quot;done&quot;, &quot;Najeeb handled it&quot; or &quot;I&apos;ll do it Friday&quot;.</p>
        </div>
      </div>
      <nav className="flex gap-1 rounded-full bg-zinc-100 p-1 text-sm">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "open" ? "/jarvis/items" : `/jarvis/items?view=${v.key}`}
            className={`flex-1 rounded-full px-3 py-1.5 text-center ${view === v.key ? "bg-white font-medium text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "open" ? <TidyUp openCount={items.length} /> : null}
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500">
          {view === "waiting" ? "Nothing is waiting on a co-host. Set who handles a project on its page." : view === "closed" ? "Nothing closed this week yet." : "Nothing needs you. All clear."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-white/60 bg-white/85 shadow-sm">
          {items.map((i, n) => (
            <ItemRow key={i.ref} item={i} n={view === "open" ? n + 1 : undefined} closed={view === "closed"} />
          ))}
        </ul>
      )}
    </div>
  );
}
