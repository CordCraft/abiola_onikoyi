"use client";

import { Spinner } from "@/components/mentorship/Spinner";
import { useActionState, useEffect, useRef, useState } from "react";
import type { AdminFormResult } from "@/app/dashboard/mentorship/actions";
import {
  adminAddGoal,
  adminAddTask,
  adminSendMessage,
  createAnnouncement,
  createMentee,
  createMentorshipSession,
  createResource,
  replyToCheckin,
  saveCohort,
  updateMentee,
} from "@/app/dashboard/mentorship/actions";

export type CohortOption = { id: string; label: string; closed?: boolean };

// Light-themed admin forms for the dashboard mentorship area.

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";
const buttonClass =
  "rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60";

// Group sessions and announcements: everyone, or one cohort.
function CohortSelect({
  cohorts,
  name = "cohort",
  allLabel = "Every cohort",
  defaultValue = "",
}: {
  cohorts: CohortOption[];
  name?: string;
  allLabel?: string | null;
  defaultValue?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue} className={`${inputClass} w-auto`}>
      {allLabel !== null ? <option value="">{allLabel}</option> : null}
      {cohorts
        .filter((c) => !c.closed)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
    </select>
  );
}

function Feedback({ state }: { state: AdminFormResult }) {
  if (state?.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        Saved.
      </p>
    );
  }
  return null;
}

function useResetOnSuccess(state: AdminFormResult) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
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
      Still sending. This can take longer when the database connection is
      waking up. Nothing is lost; refresh in a bit to check whether it went
      through before resending.
    </p>
  );
}

export function MenteeForm({
  mode,
  defaults,
  cohorts,
  defaultCohort,
}: {
  mode: "create" | "edit";
  cohorts?: CohortOption[];
  defaultCohort?: string;
  defaults?: {
    id: string;
    name: string;
    email: string;
    headline: string | null;
    focusArea: string | null;
  };
}) {
  const [state, action, pending] = useActionState(
    mode === "create" ? createMentee : updateMentee,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Full name
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={defaults?.name}
            placeholder="Arafat Alabi"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={defaults?.email}
            placeholder="mentee@example.com"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="headline" className="block text-sm font-medium text-zinc-700">
            Headline
          </label>
          <input
            id="headline"
            name="headline"
            defaultValue={defaults?.headline ?? ""}
            placeholder="500-level Chemical Engineering, UNILAG"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="focusArea" className="block text-sm font-medium text-zinc-700">
            Focus area
          </label>
          <input
            id="focusArea"
            name="focusArea"
            defaultValue={defaults?.focusArea ?? ""}
            placeholder="Process safety and tech"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        {mode === "create" && cohorts && cohorts.length > 0 ? (
          <div>
            <span className="block text-sm font-medium text-zinc-700">Cohort</span>
            <div className="mt-1.5">
              <CohortSelect cohorts={cohorts} allLabel={null} defaultValue={defaultCohort} />
            </div>
          </div>
        ) : null}
      </div>
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending
          ? "Saving…"
          : mode === "create"
            ? "Add mentee"
            : "Save changes"}
      </button>
    </form>
  );
}

export function AdminGoalForm({ menteeId }: { menteeId: string }) {
  const [state, action, pending] = useActionState(adminAddGoal, undefined);
  const ref = useResetOnSuccess(state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="menteeId" value={menteeId} />
      <input name="title" required placeholder="Goal title" className={inputClass} />
      <textarea
        name="detail"
        rows={2}
        placeholder="What does done look like? (optional)"
        className={inputClass}
      />
      <div className="flex items-center justify-between gap-3">
        <select name="targetMonth" className={`${inputClass} w-auto`} defaultValue="">
          <option value="">Target month (optional)</option>
          <option value="1">Month 1 · Discovery</option>
          <option value="2">Month 2 · Build</option>
          <option value="3">Month 3 · Deliver</option>
        </select>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Adding…
          </span>
        ) : (
          "Add goal"
        )}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AdminTaskForm({
  menteeId,
  goals,
}: {
  menteeId: string;
  goals: { id: string; title: string }[];
}) {
  const [state, action, pending] = useActionState(adminAddTask, undefined);
  const ref = useResetOnSuccess(state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="menteeId" value={menteeId} />
      <input
        name="title"
        required
        placeholder="Task title, e.g. Draft your LinkedIn headline"
        className={inputClass}
      />
      <input name="notes" placeholder="Notes (optional)" className={inputClass} />
      <div className="flex flex-wrap items-center gap-3">
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
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          Due
          <input name="dueDate" type="date" className={`${inputClass} w-auto`} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Assigning…
          </span>
        ) : (
          "Assign task"
        )}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

// One-tap starters for check-in replies; the mentor edits before sending.
const REPLY_STARTERS = [
  { chip: "Great week", text: "Great week. What made the biggest difference, and how do you repeat it next week?" },
  { chip: "Unblock", text: "Good progress. On the blocker: break it into the smallest next step and do that first. Message me if it is still stuck by midweek." },
  { chip: "Talk on our call", text: "Thanks for the honesty. Let us talk this through on our next call. Bring one question." },
  { chip: "Stretch", text: "Strong work. For next week, pick one task that scares you a little and do it first." },
];

export function CheckinReplyForm({
  checkinId,
  firstName,
}: {
  checkinId: string;
  firstName?: string;
}) {
  const [state, action, pending] = useActionState(replyToCheckin, undefined);
  const slow = useSlowPending(pending);
  const textRef = useRef<HTMLTextAreaElement>(null);

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="id" value={checkinId} />
      <div className="flex flex-wrap gap-1.5">
        {REPLY_STARTERS.map((r) => (
          <button
            key={r.chip}
            type="button"
            onClick={() => {
              if (!textRef.current) return;
              textRef.current.value = firstName ? `${firstName}, ${r.text}` : r.text;
              textRef.current.focus();
            }}
            className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-400"
          >
            {r.chip}
          </button>
        ))}
      </div>
      <textarea
        ref={textRef}
        name="reply"
        rows={3}
        required
        placeholder="Reply to this check-in…"
        className={inputClass}
      />
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Sending…
          </span>
        ) : (
          "Send reply"
        )}
      </button>
      <SlowNotice show={slow} />
    </form>
  );
}

export function AdminMessageForm({ menteeId }: { menteeId: string }) {
  const [state, action, pending] = useActionState(adminSendMessage, undefined);
  const ref = useResetOnSuccess(state);
  const slow = useSlowPending(pending);

  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="menteeId" value={menteeId} />
      <div className="flex items-end gap-2">
        <textarea
          name="body"
          rows={2}
          required
          placeholder="Message this mentee…"
          className={`${inputClass} flex-1`}
        />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Sending…
          </span>
        ) : (
          "Send"
        )}
        </button>
      </div>
      <Feedback state={state} />
      <SlowNotice show={slow} />
    </form>
  );
}

export function SessionForm({
  mentees,
  cohorts = [],
}: {
  mentees: { id: string; name: string }[];
  cohorts?: CohortOption[];
}) {
  const [state, action, pending] = useActionState(
    createMentorshipSession,
    undefined,
  );
  const ref = useResetOnSuccess(state);
  const [kind, setKind] = useState<"group" | "one_on_one">("group");

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input
        name="title"
        required
        placeholder="Session title, e.g. Kickoff: goals and expectations"
        className={inputClass}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as "group" | "one_on_one")}
          className={`${inputClass} w-auto`}
        >
          <option value="group">Group session</option>
          <option value="one_on_one">One on one</option>
        </select>
        {kind === "one_on_one" ? (
          <select name="menteeId" required className={`${inputClass} w-auto`}>
            <option value="">Pick mentee…</option>
            {mentees.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : cohorts.length > 0 ? (
          <CohortSelect cohorts={cohorts} />
        ) : null}
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          When (WAT)
          <input
            name="scheduledAt"
            type="datetime-local"
            required
            className={`${inputClass} w-auto`}
          />
        </label>
      </div>
      <input
        name="link"
        placeholder="Google Meet link (optional)"
        className={inputClass}
      />
      <textarea
        name="agenda"
        rows={2}
        placeholder="Agenda (optional)"
        className={inputClass}
      />
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Scheduling…
          </span>
        ) : (
          "Schedule session"
        )}
      </button>
    </form>
  );
}

export function ResourceForm() {
  const [state, action, pending] = useActionState(createResource, undefined);
  const ref = useResetOnSuccess(state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <input name="title" required placeholder="Resource title" className={inputClass} />
      <input name="url" placeholder="https://… (optional)" className={inputClass} />
      <input
        name="note"
        placeholder="Why it is worth their time (optional)"
        className={inputClass}
      />
      <div className="flex flex-wrap items-center gap-4">
        <select name="category" className={`${inputClass} w-auto`} defaultValue="reading">
          <option value="reading">Reading</option>
          <option value="video">Video</option>
          <option value="course">Course</option>
          <option value="tool">Tool</option>
          <option value="other">Other</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input type="checkbox" name="pinned" className="h-4 w-4 rounded border-zinc-300" />
          Pin to top
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Sharing…
          </span>
        ) : (
          "Share resource"
        )}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AnnouncementForm({ cohorts = [] }: { cohorts?: CohortOption[] }) {
  const [state, action, pending] = useActionState(createAnnouncement, undefined);
  const ref = useResetOnSuccess(state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <input name="title" required placeholder="Announcement title" className={`${inputClass} min-w-0 flex-1`} />
        {cohorts.length > 0 ? <CohortSelect cohorts={cohorts} /> : null}
      </div>
      <textarea
        name="body"
        rows={3}
        required
        placeholder="What should the cohort know?"
        className={inputClass}
      />
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> Posting…
          </span>
        ) : (
          "Post announcement"
        )}
      </button>
    </form>
  );
}

export function CohortForm({
  defaults,
}: {
  defaults?: { id: string; label: string; startDate: string; kickoffAt: string };
}) {
  const [state, action, pending] = useActionState(saveCohort, undefined);
  const ref = useResetOnSuccess(defaults ? undefined : state);

  return (
    <form ref={ref} action={action} className="space-y-3">
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm text-zinc-600">
          Name
          <input
            name="label"
            required
            defaultValue={defaults?.label}
            placeholder="Cohort 3 · 2027"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-sm text-zinc-600">
          Kickoff call (WAT)
          <input
            name="kickoffAt"
            type="datetime-local"
            defaultValue={defaults?.kickoffAt}
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-sm text-zinc-600">
          Day 1 of the programme (a Saturday)
          <input
            name="startDate"
            type="date"
            required
            defaultValue={defaults?.startDate}
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>
      <Feedback state={state} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : defaults ? "Save dates" : "Create cohort"}
      </button>
    </form>
  );
}
