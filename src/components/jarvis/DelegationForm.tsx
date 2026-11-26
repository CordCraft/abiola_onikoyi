"use client";

import { useActionState } from "react";
import { saveDelegation, type ItemResult } from "@/app/jarvis/items/actions";
import { SubmitButton } from "@/components/SubmitButton";

const KINDS = [
  { key: "reply", label: "Guest and client replies" },
  { key: "followup", label: "Follow-ups" },
  { key: "task", label: "Tasks from messages" },
  { key: "event", label: "Meetings" },
];

// Who handles this project first. Matching things Jarvis notices wait for
// them, close themselves when they answer, and reach you only if still open.
export function DelegationForm({
  projectId,
  name,
  contact,
  mins,
  kinds,
}: {
  projectId: string;
  name: string | null;
  contact: string | null;
  mins: number | null;
  kinds: string | null;
}) {
  const [state, action] = useActionState<ItemResult, FormData>(saveDelegation, undefined);
  const on = new Set((kinds ?? "reply,followup").split(","));
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-xs text-zinc-500">Name</span>
          <input name="delegateName" defaultValue={name ?? ""} placeholder="Najeeb" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-zinc-500">WhatsApp number or email</span>
          <input name="delegateContact" defaultValue={contact ?? ""} placeholder="+973..." className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-zinc-500">Tell me if still open after (min)</span>
          <input name="escalateMins" type="number" min={5} max={1440} defaultValue={mins ?? 30} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-sm text-zinc-700">
        {KINDS.map((k) => (
          <label key={k.key} className="flex items-center gap-1.5">
            <input type="checkbox" name="delegateKinds" value={k.key} defaultChecked={on.has(k.key)} />
            {k.label}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800">Save</SubmitButton>
        <span className="text-xs text-zinc-500">Leave the name empty to handle everything yourself.</span>
      </div>
      {state?.message ? <p className="text-sm text-emerald-700">{state.message}</p> : null}
      {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}
