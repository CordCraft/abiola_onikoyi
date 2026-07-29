"use client";

import { useActionState } from "react";
import type { AdminFormResult } from "@/app/dashboard/mentorship/actions";
import {
  adminCommentPlanDay,
  adminCommentPlanTask,
  adminGrantAiTool,
} from "@/app/dashboard/mentorship/actions";

// Admin-side client forms for the daily programme (light dashboard theme).

const inputClass =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

function Error({ state }: { state: AdminFormResult }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
      {state.error}
    </p>
  );
}

export function PlanDayCommentForm({ dayId }: { dayId: string }) {
  const [state, action, pending] = useActionState(adminCommentPlanDay, undefined);

  return (
    <form action={action} className="flex items-start gap-2">
      <input type="hidden" name="id" value={dayId} />
      <textarea
        name="comment"
        rows={2}
        required
        placeholder="Comment on this day's work…"
        className={`${inputClass} flex-1`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Reply"}
      </button>
      <Error state={state} />
    </form>
  );
}

export function PlanTaskCommentForm({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(adminCommentPlanTask, undefined);

  return (
    <form action={action} className="mt-2 flex items-start gap-2">
      <input type="hidden" name="id" value={taskId} />
      <input
        name="comment"
        required
        placeholder="Comment on this evidence…"
        className={`${inputClass} flex-1`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60"
      >
        {pending ? "…" : "Comment"}
      </button>
      <Error state={state} />
    </form>
  );
}

const TOOL_LABELS: Record<string, string> = {
  anthropic: "Claude API",
  openai: "OpenAI API",
  fal: "fal.ai",
};

export function GrantToolForm({
  menteeId,
  tool,
}: {
  menteeId: string;
  tool: string;
}) {
  const [state, action, pending] = useActionState(adminGrantAiTool, undefined);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="menteeId" value={menteeId} />
      <input type="hidden" name="tool" value={tool} />
      <input
        name="apiKey"
        required
        placeholder={`Paste ${TOOL_LABELS[tool] ?? tool} key…`}
        className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
      />
      <input
        name="note"
        placeholder="Note to mentee (optional)"
        className={`${inputClass} w-44`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
      >
        {pending ? "Granting…" : "Grant"}
      </button>
      <Error state={state} />
    </form>
  );
}
