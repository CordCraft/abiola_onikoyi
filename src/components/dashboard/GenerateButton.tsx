"use client";

import { useActionState } from "react";
import { generateNow, type FormResult } from "@/app/dashboard/blog/actions";

export function GenerateButton() {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    generateNow,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60"
      >
        {pending ? "Generating…" : "Generate draft now"}
      </button>
      {state?.error ? (
        <span className="max-w-xs text-right text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
