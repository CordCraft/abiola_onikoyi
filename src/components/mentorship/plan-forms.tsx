"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closePlanDay,
  prepareProgramWeek,
  requestAiTool,
  togglePlanTask,
} from "@/app/mentorship/portal/actions";
import { PLAN_KIND_LABELS, type PlanTaskKind } from "@/lib/mentorship/constants";

// Client forms for the daily programme: task completion (with optional
// evidence), day close-out (reflection + confidence), and AI tool requests.

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

const KIND_TONES: Record<PlanTaskKind, string> = {
  mindset: "bg-purple-500/10 text-purple-300",
  skill: "bg-sky-500/10 text-sky-300",
  project: "bg-emerald-500/10 text-emerald-300",
  career: "bg-amber-500/10 text-amber-300",
  checkpoint: "bg-red-500/10 text-red-300",
};

export type PlanTaskView = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  minutes: number;
  points: number;
  evidenceHint: string | null;
  status: string;
  evidence: string | null;
  mentorComment: string | null;
};

export function PlanTaskItem({
  task,
  locked,
}: {
  task: PlanTaskView;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState(togglePlanTask, undefined);
  const [open, setOpen] = useState(false);
  const done = task.status === "done";
  const kind = (task.kind in KIND_TONES ? task.kind : "skill") as PlanTaskKind;
  const needsEvidence = Boolean(task.evidenceHint) && !task.evidence && !done;

  return (
    <li
      className={`rounded-xl border p-4 transition-colors ${
        done
          ? "border-emerald-500/20 bg-emerald-500/[0.05]"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-start gap-3">
        <form action={action}>
          <input type="hidden" name="id" value={task.id} />
          <button
            type="submit"
            disabled={locked || pending || needsEvidence}
            aria-label={done ? "Reopen task" : "Mark task done"}
            title={
              locked
                ? "Locked"
                : needsEvidence
                  ? "Add evidence below first"
                  : done
                    ? "Reopen"
                    : "Mark done"
            }
            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              done
                ? "border-emerald-400 bg-emerald-400 text-zinc-950"
                : "border-white/25 hover:border-accent"
            }`}
          >
            {done ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </button>
        </form>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${KIND_TONES[kind]}`}
            >
              {PLAN_KIND_LABELS[kind]}
            </span>
            <span className="text-[11px] text-zinc-500">
              ~{task.minutes} min · {task.points} pts
            </span>
          </div>
          <p
            className={`mt-1 text-sm font-medium ${
              done ? "text-zinc-400 line-through decoration-emerald-400/40" : "text-white"
            }`}
          >
            {task.title}
          </p>
          {task.detail ? (
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              {task.detail}
            </p>
          ) : null}

          {task.evidence ? (
            <div className="mt-2 rounded-lg bg-white/[0.04] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Your evidence
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-zinc-300">
                {task.evidence}
              </p>
            </div>
          ) : null}

          {task.evidenceHint && !done && !locked ? (
            <form action={action} className="mt-2 space-y-2">
              <input type="hidden" name="id" value={task.id} />
              <textarea
                name="evidence"
                rows={open ? 4 : 2}
                onFocus={() => setOpen(true)}
                placeholder={task.evidenceHint}
                defaultValue={task.evidence ?? ""}
                className={inputClass}
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-4 py-1.5 text-xs font-semibold text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {pending ? "Saving…" : "Submit evidence & complete"}
              </button>
            </form>
          ) : null}

          {task.mentorComment ? (
            <div className="mt-2 rounded-lg border border-accent/20 bg-accent/[0.06] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                Mentor
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">
                {task.mentorComment}
              </p>
            </div>
          ) : null}

          {state?.error ? (
            <p role="alert" className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {state.error}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function CloseDayForm({ dayId }: { dayId: string }) {
  const [state, action, pending] = useActionState(closePlanDay, undefined);
  const [confidence, setConfidence] = useState<number | null>(null);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={dayId} />
      <textarea
        name="reflection"
        rows={2}
        required
        placeholder="One honest line: what did today teach you, or what got in the way?"
        className={inputClass}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Confidence today, 1 to 5">
          <span className="text-xs text-zinc-500">Confidence</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input
                type="radio"
                name="confidence"
                value={n}
                checked={confidence === n}
                onChange={() => setConfidence(n)}
                className="sr-only"
              />
              <span
                className={`grid h-8 w-8 place-items-center rounded-full border text-xs font-semibold transition-colors ${
                  confidence === n
                    ? "border-accent bg-accent/20 text-accent"
                    : "border-white/10 bg-white/[0.04] text-zinc-400 hover:border-white/25"
                }`}
              >
                {n}
              </span>
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-5 py-2 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Closing out…" : "Close out the day"}
        </button>
      </div>
      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

// Rendered by the programme page when a week the mentee should see has no
// generated days yet (new signups). Kicks off server-side generation on
// mount, keeps the mentee company while the AI writes their week, then
// refreshes to reveal it.
export function GenerateWeek({ week }: { week: number }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    prepareProgramWeek(week)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) router.refresh();
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [week, router]);

  if (failed) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-6 text-center">
        <p className="text-sm text-amber-200">
          Week {week} could not be prepared just now.
        </p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            started.current = false;
            prepareProgramWeek(week).then((res) => {
              if (res.ok) router.refresh();
              else setFailed(true);
            });
          }}
          className="mt-3 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-accent/20 bg-accent/[0.04] p-8 text-center">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      <p className="text-sm font-semibold text-white">
        Building week {week} of your personalised programme…
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        Your mentor&apos;s AI is designing this week&apos;s daily tasks from
        your story, goals, and progress. This takes under a minute.
      </p>
    </div>
  );
}

export function RequestToolForm({
  tool,
  requested,
}: {
  tool: string;
  requested: boolean;
}) {
  const [state, action, pending] = useActionState(requestAiTool, undefined);

  if (requested || state?.ok) {
    return (
      <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
        Requested. Your mentor will provision your key shortly.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="tool" value={tool} />
      <input
        name="note"
        placeholder="What will you build with it? (helps your mentor say yes fast)"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-60"
      >
        {pending ? "Requesting…" : "Request access"}
      </button>
      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
