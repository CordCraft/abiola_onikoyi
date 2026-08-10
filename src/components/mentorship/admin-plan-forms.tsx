"use client";

import { Spinner } from "@/components/mentorship/Spinner";
import { useActionState, useEffect, useState } from "react";
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

// Server actions here have no client-side timeout, so a slow or stuck DB
// connection leaves the button spinning with no explanation. After a few
// seconds of continuous pending, say so instead of spinning silently.
function useSlowPending(pending: boolean, ms = 7000) {
  const [tracked, setTracked] = useState({ pending, slow: false });
  if (pending !== tracked.pending) {
    setTracked({ pending, slow: false });
  }
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setTracked((s) => (s.pending ? { ...s, slow: true } : s));
    }, ms);
    return () => clearTimeout(timer);
  }, [pending, ms]);
  return tracked.pending && tracked.slow;
}

function SlowNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="text-xs text-amber-600">
      Still sending — this can take longer when the database connection is
      waking up. Nothing is lost; refresh in a bit to check before resending.
    </p>
  );
}

export function PlanDayCommentForm({ dayId }: { dayId: string }) {
  const [state, action, pending] = useActionState(adminCommentPlanDay, undefined);
  const slow = useSlowPending(pending);

  return (
    <div className="space-y-1.5">
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
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="h-3.5 w-3.5" /> Sending…
            </span>
          ) : (
            "Reply"
          )}
        </button>
        <Error state={state} />
      </form>
      <SlowNotice show={slow} />
    </div>
  );
}

export function PlanTaskCommentForm({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(adminCommentPlanTask, undefined);
  const slow = useSlowPending(pending);

  return (
    <div className="space-y-1.5">
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
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="h-3.5 w-3.5" /> …
            </span>
          ) : (
            "Comment"
          )}
        </button>
        <Error state={state} />
      </form>
      <SlowNotice show={slow} />
    </div>
  );
}

// Dark variants for the "mirror" view, which reuses the mentee portal's
// visual language inside the admin dashboard.

const darkInputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

function DarkError({ state }: { state: AdminFormResult }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
      {state.error}
    </p>
  );
}

function SlowNoticeDark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="text-xs text-amber-300">
      Still sending — this can take longer when the database connection is
      waking up. Nothing is lost; refresh in a bit to check before resending.
    </p>
  );
}

export function PlanDayCommentFormDark({ dayId }: { dayId: string }) {
  const [state, action, pending] = useActionState(adminCommentPlanDay, undefined);
  const slow = useSlowPending(pending);

  return (
    <div className="space-y-2">
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={dayId} />
        <textarea
          name="comment"
          rows={2}
          required
          placeholder="Reply to this day's work…"
          className={darkInputClass}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-4 py-1.5 text-xs font-semibold text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="h-3.5 w-3.5" /> Sending…
            </span>
          ) : (
            "Reply"
          )}
        </button>
        <DarkError state={state} />
      </form>
      <SlowNoticeDark show={slow} />
    </div>
  );
}

export function PlanTaskCommentFormDark({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(adminCommentPlanTask, undefined);
  const slow = useSlowPending(pending);

  return (
    <div className="space-y-1.5">
      <form action={action} className="mt-2 flex items-start gap-2">
        <input type="hidden" name="id" value={taskId} />
        <input
          name="comment"
          required
          placeholder="Comment on this evidence…"
          className={`${darkInputClass} flex-1`}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="h-3.5 w-3.5" /> …
            </span>
          ) : (
            "Comment"
          )}
        </button>
        <DarkError state={state} />
      </form>
      <SlowNoticeDark show={slow} />
    </div>
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
        placeholder={`${TOOL_LABELS[tool] ?? tool} key (blank = shared site key)`}
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
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Granting…
          </span>
        ) : (
          "Grant"
        )}
      </button>
      <Error state={state} />
    </form>
  );
}
