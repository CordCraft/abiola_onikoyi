"use client";

import Link from "next/link";
import { useActionState } from "react";
import { itemQuick, type ItemResult } from "@/app/jarvis/items/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { Item } from "@/lib/jarvis/items";

const typeTone: Record<string, string> = {
  task: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  reply: "bg-amber-50 text-amber-800 ring-amber-200",
  opportunity: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  followup: "bg-violet-50 text-violet-700 ring-violet-200",
  event: "bg-sky-50 text-sky-700 ring-sky-200",
};

// One line on the list: tap the title to open its chat, or close it in one tap.
export function ItemRow({ item, n, closed = false }: { item: Item; n?: number; closed?: boolean }) {
  const [state, action] = useActionState<ItemResult, FormData>(itemQuick, undefined);
  const gone = !!state?.message;
  return (
    <li className={`flex items-start gap-3 px-4 py-3 transition-opacity ${gone ? "opacity-40" : ""}`}>
      {n ? <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-zinc-400">{n}</span> : null}
      <div className="min-w-0 flex-1">
        <Link href={`/jarvis/items/${item.ref}`} className="block text-sm font-medium text-zinc-900 hover:text-indigo-700">
          {item.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          <span className={`rounded-full px-1.5 py-0.5 ring-1 ${typeTone[item.type] ?? "bg-zinc-100 text-zinc-600 ring-zinc-200"}`}>{item.type}</span>
          {item.project ? <span>{item.project}</span> : null}
          {item.due ? <span className={item.overdue && !closed ? "font-medium text-red-600" : ""}>{item.overdue && !closed ? "overdue " : ""}{item.due}</span> : null}
          {item.delegatedTo ? <span>with {item.delegatedTo}</span> : null}
          {item.threadId ? <span className="text-indigo-500">chat</span> : null}
        </div>
        {closed && item.closedNote ? <p className="mt-1 text-xs text-zinc-500">{item.closedNote}</p> : null}
        {item.note && !closed ? <p className="mt-1 text-xs text-zinc-500">Your plan: {item.note}</p> : null}
        {state?.message ? <p className="mt-1 text-xs text-emerald-700">{state.message}</p> : null}
        {state?.error ? <p className="mt-1 text-xs text-red-600">{state.error}</p> : null}
      </div>
      {!closed && !gone ? (
        <form action={action} className="flex shrink-0 items-center gap-1">
          <input type="hidden" name="ref" value={item.ref} />
          <SubmitButton name="action" value="tomorrow" className="rounded-full px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100" title="Move to tomorrow">
            Tmrw
          </SubmitButton>
          <SubmitButton name="action" value="done" className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-emerald-400 hover:text-emerald-700" title="Done">
            Done
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}
