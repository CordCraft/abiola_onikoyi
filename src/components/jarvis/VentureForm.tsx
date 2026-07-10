"use client";

import { useActionState } from "react";
import { VENTURE_STATUSES } from "@/lib/jarvis/constants";
import { createVenture, type FormResult } from "@/app/jarvis/actions";

const input =
  "mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";

export function VentureForm() {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(createVenture, undefined);
  return (
    <form action={formAction} className="space-y-3">
      <input name="name" required placeholder="Venture name" className={input} />
      <input name="description" placeholder="Short description (optional)" className={input} />
      <select name="status" defaultValue="active" className={input}>
        {VENTURE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {state?.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60">
        {pending ? "Adding…" : "Add venture"}
      </button>
    </form>
  );
}
