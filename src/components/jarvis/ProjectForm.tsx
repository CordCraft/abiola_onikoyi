"use client";

import { useActionState } from "react";
import { PROJECT_STATUSES, PRIORITIES } from "@/lib/jarvis/constants";
import type { FormResult } from "@/app/jarvis/actions";

const input =
  "mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";
const label = "block text-sm font-medium text-zinc-700";

export function ProjectForm({
  action,
  ventures,
  project,
  submitLabel,
}: {
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  ventures: { id: string; name: string }[];
  project?: {
    id: string;
    name: string;
    ventureId: string | null;
    status: string;
    priority: string;
    summary: string | null;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {project ? <input type="hidden" name="id" value={project.id} /> : null}
      <div>
        <label htmlFor="name" className={label}>Name</label>
        <input id="name" name="name" required defaultValue={project?.name ?? ""} className={input} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="ventureId" className={label}>Venture</label>
          <select id="ventureId" name="ventureId" defaultValue={project?.ventureId ?? ""} className={input}>
            <option value="">(none)</option>
            {ventures.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className={label}>Status</label>
          <select id="status" name="status" defaultValue={project?.status ?? "active"} className={input}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="priority" className={label}>Priority</label>
          <select id="priority" name="priority" defaultValue={project?.priority ?? "medium"} className={input}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="summary" className={label}>Summary</label>
        <textarea id="summary" name="summary" rows={2} defaultValue={project?.summary ?? ""} className={input} />
      </div>
      {state?.error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      {state?.ok ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Saved.</p> : null}
      <button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
