"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { PortalFormResult } from "@/app/mentorship/portal/actions";
import {
  addGoal,
  addTask,
  submitCheckin,
  sendMessage,
} from "@/app/mentorship/portal/actions";

// Client form components for the mentee portal. Each wraps a Server Action
// with useActionState for inline errors and resets itself after success.

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

function ErrorNote({ state }: { state: PortalFormResult }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {state.error}
    </p>
  );
}

function useResetOnSuccess(state: PortalFormResult) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function GoalForm() {
  const [state, action, pending] = useActionState(addGoal, undefined);
  const ref = useResetOnSuccess(state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input
        name="title"
        required
        placeholder="Goal title, e.g. Publish an article on energy transition"
        className={inputClass}
      />
      <textarea
        name="detail"
        rows={2}
        placeholder="Why this goal matters and what done looks like (optional)"
        className={inputClass}
      />
      <div className="flex items-center justify-between gap-3">
        <select name="targetMonth" className={`${inputClass} w-auto`} defaultValue="">
          <option value="">Target month (optional)</option>
          <option value="1">Month 1 · Discovery</option>
          <option value="2">Month 2 · Build</option>
          <option value="3">Month 3 · Deliver</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Propose goal"}
        </button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function TaskForm({
  goals,
}: {
  goals: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState(addTask, undefined);
  const ref = useResetOnSuccess(state);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-center gap-2">
      <input
        name="title"
        required
        placeholder="Add a task for yourself…"
        className={`${inputClass} min-w-0 flex-1`}
      />
      {goals.length > 0 ? (
        <select name="goalId" className={`${inputClass} w-auto`} defaultValue="">
          <option value="">No goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title.length > 40 ? `${g.title.slice(0, 40)}…` : g.title}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <ErrorNote state={state} />
    </form>
  );
}

export function CheckinForm({ week }: { week: number }) {
  const [state, action, pending] = useActionState(submitCheckin, undefined);
  const ref = useResetOnSuccess(state);
  const [confidence, setConfidence] = useState<number | null>(null);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <div>
        <label htmlFor="wins" className="block text-sm font-medium text-zinc-300">
          Wins and progress this week
        </label>
        <textarea
          id="wins"
          name="wins"
          rows={3}
          required
          placeholder="What moved forward? Small wins count."
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <label htmlFor="blockers" className="block text-sm font-medium text-zinc-300">
          Blockers or questions
        </label>
        <textarea
          id="blockers"
          name="blockers"
          rows={2}
          placeholder="Anything slowing you down? (optional)"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <label htmlFor="nextFocus" className="block text-sm font-medium text-zinc-300">
          Focus for next week
        </label>
        <input
          id="nextFocus"
          name="nextFocus"
          placeholder="One thing you will push on (optional)"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <span className="block text-sm font-medium text-zinc-300">
          Confidence this week
        </span>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Confidence, 1 to 5">
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
                className={`grid h-10 w-10 place-items-center rounded-full border text-sm font-semibold transition-colors ${
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
      </div>
      <ErrorNote state={state} />
      {state?.ok ? (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Week {week} check-in submitted. Your mentor will see it right away.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-5 py-2 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Submitting…" : `Submit week ${week} check-in`}
      </button>
    </form>
  );
}

export function MessageForm({
  action: serverAction,
  hidden,
}: {
  // Defaults to the mentee action; the admin thread passes its own action
  // plus a hidden menteeId field.
  action?: typeof sendMessage;
  hidden?: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(
    serverAction ?? sendMessage,
    undefined,
  );
  const ref = useResetOnSuccess(state);

  return (
    <form ref={ref} action={action} className="space-y-2">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex items-end gap-2">
        <textarea
          name="body"
          rows={2}
          required
          placeholder="Write a message…"
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}
