"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { decide, type SignalResult } from "@/app/jarvis/signals/actions";
import { SubmitButton } from "@/components/SubmitButton";

// Queues the listener's undo job for a signal or a closed task, then refreshes once it has had time to run.
export function UndoButton({ id, kind }: { id: string; kind: "signal" | "task" }) {
  const router = useRouter();
  const [state, action] = useActionState<SignalResult, FormData>(decide, undefined);
  useEffect(() => {
    if (!state?.message) return;
    const t = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(t);
  }, [state, router]);
  return (
    <form action={action} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton name="action" value={kind === "task" ? "undo_task" : "undo"} className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-white">
        Undo
      </SubmitButton>
      {state?.message && <span className="text-xs text-emerald-700">{state.message}</span>}
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
