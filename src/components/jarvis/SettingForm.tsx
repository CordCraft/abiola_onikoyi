"use client";

import { useActionState } from "react";
import { saveSetting, type FormResult } from "@/app/jarvis/actions";

export function SettingForm({
  settingKey,
  label,
  hint,
  placeholder,
  defaultValue,
  multiline,
  secret,
}: {
  settingKey: string;
  label: string;
  hint: string;
  placeholder: string;
  defaultValue: string;
  multiline?: boolean;
  secret?: boolean;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(saveSetting, undefined);

  return (
    <form action={action} className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-800">{label}</label>
      <p className="text-xs text-zinc-500">{hint}</p>
      <input type="hidden" name="key" value={settingKey} />
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea
            name="value"
            rows={3}
            defaultValue={defaultValue}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400"
          />
        ) : (
          <input
            name="value"
            type={secret ? "password" : "text"}
            defaultValue={defaultValue}
            placeholder={placeholder}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400"
          />
        )}
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "..." : "Save"}
        </button>
      </div>
      {state?.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
      {state?.ok ? <p className="text-xs text-emerald-600">Saved.</p> : null}
    </form>
  );
}
