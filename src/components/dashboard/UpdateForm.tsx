"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUpdate, type FormResult } from "@/app/dashboard/actions";

export function UpdateForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    createUpdate,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a successful post.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input
        name="title"
        type="text"
        required
        placeholder="Update title, e.g. Closed first pilot customer"
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
      />
      <textarea
        name="body"
        rows={4}
        required
        placeholder="What changed? Markdown supported (## headings, **bold**, - lists, [links](https://…))."
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30"
      />

      {state?.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Posting…" : "Post update"}
      </button>
    </form>
  );
}
