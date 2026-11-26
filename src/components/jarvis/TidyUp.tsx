"use client";

import { useActionState, useState } from "react";
import { tidyAction, type TidyState } from "@/app/jarvis/items/actions";
import { SubmitButton } from "@/components/SubmitButton";

// "Tidy up": Jarvis reads every open item next to your recent messages and
// proposes what to close and merge. You untick anything to keep, then Apply.
export function TidyUp({ openCount }: { openCount: number }) {
  const [state, action] = useActionState<TidyState, FormData>(tidyAction, undefined);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const p = state?.proposal;
  const toggle = (ref: string) =>
    setSkip((s) => {
      const n = new Set(s);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      return n;
    });

  if (!p || state?.message) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="step" value="propose" />
        <SubmitButton className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800" pendingLabel="Reading everything...">
          Tidy up {openCount ? `(${openCount} open)` : ""}
        </SubmitButton>
        {state?.message ? <span className="text-sm text-emerald-700">{state.message}</span> : null}
        {state?.error ? <span className="text-sm text-red-600">{state.error}</span> : null}
      </form>
    );
  }

  const closeCount = p.close.filter((c) => !skip.has(c.ref)).length;
  const mergeCount = p.merge.reduce((n, m) => n + m.duplicates.filter((d) => !skip.has(d.ref)).length, 0);

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow-sm">
      <input type="hidden" name="step" value="apply" />
      <div>
        <p className="text-sm font-semibold text-zinc-900">Jarvis suggests</p>
        <p className="text-sm text-zinc-600">{p.summary}</p>
      </div>
      {p.close.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Close ({p.close.length})</p>
          <ul className="mt-2 space-y-1.5">
            {p.close.map((c) => (
              <li key={c.ref} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={!skip.has(c.ref)} onChange={() => toggle(c.ref)} aria-label={`Close ${c.title}`} />
                {!skip.has(c.ref) ? (
                  <>
                    <input type="hidden" name="close" value={c.ref} />
                    <input type="hidden" name="reason" value={`${c.ref}::${c.reason}`} />
                  </>
                ) : null}
                <span>
                  <span className={skip.has(c.ref) ? "text-zinc-400 line-through" : "text-zinc-800"}>{c.title}</span>
                  <span className="block text-xs text-zinc-500">{c.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.merge.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Merge duplicates</p>
          <ul className="mt-2 space-y-2">
            {p.merge.map((m) => {
              const dups = m.duplicates.filter((d) => !skip.has(d.ref));
              return (
                <li key={m.keep} className="text-sm">
                  <span className="font-medium text-zinc-800">Keep: {m.keepTitle}</span>
                  {dups.length ? <input type="hidden" name="merge" value={`${m.keep}::${dups.map((d) => d.ref).join(",")}`} /> : null}
                  <ul className="mt-1 space-y-1 pl-4">
                    {m.duplicates.map((d) => (
                      <li key={d.ref} className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={!skip.has(d.ref)} onChange={() => toggle(d.ref)} aria-label={`Merge ${d.title}`} />
                        <span className={skip.has(d.ref) ? "text-zinc-400 line-through" : "text-zinc-600"}>{d.title}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-zinc-500">{p.keep} stay open.</p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800" disabled={!closeCount && !mergeCount}>
          Apply: close {closeCount}, merge {mergeCount}
        </SubmitButton>
      </div>
      {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
