"use client";

import { useActionState } from "react";
import { saveRhythm } from "@/app/jarvis/settings/rhythm-actions";
import type { Rhythm } from "@/lib/jarvis/v2/rhythm";
import { SubmitButton } from "@/components/SubmitButton";

const DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function Time({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="text-xs font-medium text-zinc-600">
      {label}
      <input type="time" name={name} defaultValue={value} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900" />
    </label>
  );
}

export function RhythmForm({ rhythm, learned }: { rhythm: Rhythm; learned: { firstActive?: string; lastActive?: string; busiest?: string[] } | null }) {
  const [state, action] = useActionState(saveRhythm, undefined);
  return (
    <form action={action} className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <h2 className="text-lg font-semibold text-zinc-900">My rhythm</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Jarvis plans your day around this, tells you when to stop, and stays quiet during family time and at night.
        {learned?.firstActive && ` From your messages it has learned you are usually active from ${learned.firstActive} to ${learned.lastActive}${learned.busiest?.length ? `, busiest around ${learned.busiest.join(", ")}` : ""}.`}
      </p>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-zinc-600">Workdays</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <label key={d} className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-700">
              <input type="checkbox" name="workdays" value={d} defaultChecked={rhythm.workdays.includes(d)} />
              {d.slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Time name="workStart" label="Work starts" value={rhythm.workStart} />
        <Time name="workEnd" label="Stop work at" value={rhythm.workEnd} />
        <Time name="familyStart" label="Family time from" value={rhythm.familyStart} />
        <Time name="familyEnd" label="Family time until" value={rhythm.familyEnd} />
        <Time name="quietStart" label="Quiet from" value={rhythm.quietStart} />
        <Time name="quietEnd" label="Quiet until" value={rhythm.quietEnd} />
        <label className="text-xs font-medium text-zinc-600">
          Pushes per day (max)
          <input type="number" name="maxPushesPerDay" min={1} max={60} defaultValue={rhythm.maxPushesPerDay} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900" />
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Pushes per hour (max)
          <input type="number" name="maxPushesPerHour" min={1} max={20} defaultValue={rhythm.maxPushesPerHour} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900" />
        </label>
        <label className="text-xs font-medium text-zinc-600">
          Time zone
          <select name="tz" defaultValue={rhythm.tz} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900">
            <option value="Asia/Kuwait">Kuwait</option>
            <option value="Asia/Riyadh">Saudi Arabia (Dhahran)</option>
            <option value="Asia/Bahrain">Bahrain</option>
            <option value="Africa/Lagos">Nigeria</option>
            <option value="Africa/Kigali">Rwanda</option>
            <option value="Europe/London">London</option>
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <SubmitButton className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Save rhythm</SubmitButton>
        {state?.ok && <span className="text-sm text-emerald-700">Saved. Jarvis uses it from the next minute.</span>}
      </div>
    </form>
  );
}
