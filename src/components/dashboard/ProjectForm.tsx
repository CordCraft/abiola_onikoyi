"use client";

import { useActionState } from "react";
import { STATUSES, STATUS_LABELS } from "@/lib/project-constants";
import type { FormResult } from "@/app/dashboard/actions";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";
const labelClass = "block text-sm font-medium text-zinc-700";

type ProjectFormProps = {
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  project?: {
    id: string;
    title: string;
    summary: string;
    status: string;
    link: string | null;
  };
  submitLabel: string;
};

export function ProjectForm({ action, project, submitLabel }: ProjectFormProps) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    action,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-5">
      {project ? <input type="hidden" name="id" value={project.id} /> : null}

      <div>
        <label htmlFor="title" className={labelClass}>
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          defaultValue={project?.title ?? ""}
          placeholder="e.g. Acme — AI scheduling assistant"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="summary" className={labelClass}>
          Summary
        </label>
        <textarea
          id="summary"
          name="summary"
          rows={2}
          defaultValue={project?.summary ?? ""}
          placeholder="One or two lines describing the project."
          className={inputClass}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="status" className={labelClass}>
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={project?.status ?? "building"}
            className={inputClass}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="link" className={labelClass}>
            Link <span className="text-zinc-400">(optional)</span>
          </label>
          <input
            id="link"
            name="link"
            type="url"
            defaultValue={project?.link ?? ""}
            placeholder="https://…"
            className={inputClass}
          />
        </div>
      </div>

      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Saved.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
