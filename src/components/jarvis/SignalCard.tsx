"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { decide, type SignalResult } from "@/app/jarvis/signals/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { resolvedByLabel } from "@/lib/jarvis/labels";

export type SignalView = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  why: string | null;
  score: number;
  source: string | null;
  status: string;
  actionType: string | null;
  actionLabel: string;
  replyText: string | null;
  replyTo: string | null;
  when: string | null;
  createdAt: string;
  resultNote: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  cleanup: { close: { title: string; evidence: string }[]; merge: { keep: string; drop: string[] }[] } | null;
};

const kindTone: Record<string, string> = {
  event: "bg-sky-50 text-sky-700 ring-sky-200",
  task: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  reply: "bg-amber-50 text-amber-800 ring-amber-200",
  opportunity: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  followup: "bg-violet-50 text-violet-700 ring-violet-200",
  plan: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  fyi: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

const sourceLabel: Record<string, string> = { whatsapp: "WhatsApp", gmail: "Gmail", outlook: "Outlook", planner: "Jarvis" };

// One signal with its one-tap actions. `compact` is the Today list version.
export function SignalCard({ s, compact = false }: { s: SignalView; compact?: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState<SignalResult, FormData>(decide, undefined);
  const [text, setText] = useState(s.replyText ?? "");
  const open = ["new", "pushed", "snoozed", "failed"].includes(s.status);
  const closedByJarvis = s.status === "resolved" || s.status === "expired";
  const isCleanup = s.cleanup !== null;
  const mergeCount = s.cleanup ? s.cleanup.merge.reduce((n, g) => n + g.drop.length, 0) : 0;

  // The listener applies approved actions within seconds; refresh to show the outcome.
  useEffect(() => {
    if (!state?.message) return;
    const t = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(t);
  }, [state, router]);

  return (
    <article className="rounded-2xl border border-white/60 bg-white/85 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_10px_30px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            <span className={`rounded-full px-2 py-0.5 ring-1 ${kindTone[s.kind] ?? kindTone.fyi}`}>{s.kind}</span>
            {s.source && <span className="text-zinc-400">{sourceLabel[s.source] ?? s.source}</span>}
            {s.when && <span className="text-zinc-400">· {s.when}</span>}
          </div>
          <h3 className={`font-semibold text-zinc-900 ${compact ? "text-[15px]" : "text-lg"}`}>
            {compact ? <a href={`/jarvis/signals/${s.id}`}>{s.title}</a> : s.title}
          </h3>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-900/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-600" title="How much this matters">
          {s.score}
        </span>
      </div>
      {s.cleanup ? (
        <div className="mt-2">
          <p className="text-sm text-zinc-600">
            {s.cleanup.close.length} item{s.cleanup.close.length === 1 ? "" : "s"} to close, {mergeCount} duplicate{mergeCount === 1 ? "" : "s"} to merge. Nothing changes until you approve, and Undo works afterwards.
          </p>
          {!compact && (
            <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200">
              {s.cleanup.close.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">To close</h4>
                  <ul className="mt-1 space-y-1.5">
                    {s.cleanup.close.map((c, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-zinc-800">{c.title}</span>
                        {c.evidence && <span className="block text-xs text-zinc-500">{c.evidence}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.cleanup.merge.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Duplicates to merge</h4>
                  <ul className="mt-1 space-y-1.5">
                    {s.cleanup.merge.map((g, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-zinc-800">Keep: {g.keep}</span>
                        <span className="block text-xs text-zinc-500">Merging in: {g.drop.join("; ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {compact && (
            <a href={`/jarvis/signals/${s.id}`} className="mt-1 inline-block text-xs font-medium text-indigo-600">
              Review the list
            </a>
          )}
        </div>
      ) : (
        s.detail && <p className={`mt-1.5 whitespace-pre-line text-sm text-zinc-600 ${compact ? "line-clamp-3" : ""}`}>{s.detail}</p>
      )}
      {s.why && !compact && <p className="mt-2 text-xs text-zinc-400">{s.why}</p>}

      {closedByJarvis && (
        <p className="mt-3 text-sm text-zinc-500">
          {resolvedByLabel[s.resolvedBy ?? ""] ?? "Closed by Jarvis"}
          {s.resolution ? `: ${s.resolution}` : "."}
          {s.resolvedAt ? ` (${s.resolvedAt})` : ""}
        </p>
      )}
      {!open && !closedByJarvis && (
        <p className="mt-3 text-sm text-zinc-500">
          {s.status === "applied" ? "Done." : s.status === "approved" ? "Working on it..." : s.status === "undone" ? "Undone." : s.status === "dismissed" ? "Dismissed." : s.status}
          {s.resultNote ? ` ${s.resultNote}` : ""}
        </p>
      )}

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="id" value={s.id} />
        {open && s.actionType === "send_reply" && !compact && (
          <label className="block">
            <span className="text-xs text-zinc-500">Reply to {s.replyTo}</span>
            <textarea
              name="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none"
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          {open && (
            <SubmitButton name="action" value="approve" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
              {s.actionLabel}
            </SubmitButton>
          )}
          {open && s.actionType === "send_reply" && s.source !== "whatsapp" && !compact && (
            <SubmitButton name="action" value="draft" className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-white">
              Save as draft
            </SubmitButton>
          )}
          {open && (
            <>
              <input type="hidden" name="hours" value="3" />
              {!isCleanup && (
                <SubmitButton name="action" value="snooze" className="rounded-full border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-white">
                  Later
                </SubmitButton>
              )}
              <SubmitButton name="action" value="dismiss" className="rounded-full px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100">
                Not now
              </SubmitButton>
            </>
          )}
          {(closedByJarvis || (s.status === "applied" && s.actionType !== "send_reply")) && (
            <SubmitButton name="action" value="undo" className="rounded-full border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-white">
              Undo
            </SubmitButton>
          )}
        </div>
        {state?.message && <p className="text-xs text-emerald-700">{state.message}</p>}
        {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      </form>
    </article>
  );
}
