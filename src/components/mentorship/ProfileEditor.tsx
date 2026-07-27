"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  changePassword,
  updateProfile,
  type ProfileFormResult,
} from "@/app/mentorship/portal/profile/actions";
import {
  COMMS_OPTIONS,
  INTEREST_OPTIONS,
  LEVEL_OPTIONS,
} from "@/lib/mentorship/constants";
import { compressImage } from "@/components/mentorship/image";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "block text-sm font-medium text-zinc-300";

function Feedback({ state }: { state: ProfileFormResult }) {
  if (state?.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
        {state.error}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
        Saved.
      </p>
    );
  }
  return null;
}

export function ProfileEditor({
  existing,
}: {
  existing: {
    photoData: string | null;
    phone: string | null;
    linkedin: string | null;
    level: string | null;
    gradYear: string | null;
    interests: string | null;
    backgroundStory: string | null;
    skills: string | null;
    dreamRoles: string | null;
    aspirations: string | null;
    longTermVision: string | null;
    expectations: string | null;
    challenges: string | null;
    availability: string | null;
    commsPref: string | null;
  };
}) {
  const [photo, setPhoto] = useState<string>(existing.photoData ?? "");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>(
    existing.interests ? existing.interests.split(",").map((s) => s.trim()) : [],
  );
  const [state, action, pending] = useActionState(updateProfile, undefined);

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="photoData" value={photo} />
      <input type="hidden" name="interests" value={interests.join(", ")} />

      <div className="flex items-center gap-5">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04]">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Your photo" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div>
          <label
            htmlFor="photo-file"
            className="inline-block cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10"
          >
            {photoBusy ? "Processing…" : "Change photo"}
          </label>
          <input
            id="photo-file"
            type="file"
            accept="image/*"
            onChange={onPhotoChange}
            className="sr-only"
          />
          {photoError ? (
            <p className="mt-2 text-xs text-red-300">{photoError}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone (WhatsApp preferred)
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={existing.phone ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="linkedin" className={labelClass}>
            LinkedIn profile
          </label>
          <input
            id="linkedin"
            name="linkedin"
            defaultValue={existing.linkedin ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="level" className={labelClass}>
            Current level
          </label>
          <select
            id="level"
            name="level"
            defaultValue={existing.level ?? "500 Level"}
            className={`mt-1.5 ${inputClass}`}
          >
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gradYear" className={labelClass}>
            Expected graduation year
          </label>
          <select
            id="gradYear"
            name="gradYear"
            defaultValue={existing.gradYear ?? "2027"}
            className={`mt-1.5 ${inputClass}`}
          >
            {["2026", "2027", "2028", "2029", "2030", "Graduated"].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className={labelClass}>Areas of interest</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((opt) => {
            const on = interests.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setInterests((cur) =>
                    on ? cur.filter((i) => i !== opt) : [...cur, opt],
                  )
                }
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  on
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : "border-white/15 text-zinc-400 hover:border-white/30 hover:text-white"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="backgroundStory" className={labelClass}>
          Your story
        </label>
        <textarea
          id="backgroundStory"
          name="backgroundStory"
          rows={4}
          defaultValue={existing.backgroundStory ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <label htmlFor="skills" className={labelClass}>
          Skills and tools
        </label>
        <textarea
          id="skills"
          name="skills"
          rows={2}
          defaultValue={existing.skills ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <label htmlFor="dreamRoles" className={labelClass}>
          Dream roles or companies
        </label>
        <input
          id="dreamRoles"
          name="dreamRoles"
          defaultValue={existing.dreamRoles ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="aspirations" className={labelClass}>
            2-year vision
          </label>
          <textarea
            id="aspirations"
            name="aspirations"
            rows={3}
            defaultValue={existing.aspirations ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="longTermVision" className={labelClass}>
            5-year vision
          </label>
          <textarea
            id="longTermVision"
            name="longTermVision"
            rows={3}
            defaultValue={existing.longTermVision ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>
      <div>
        <label htmlFor="expectations" className={labelClass}>
          What you want from the mentorship
        </label>
        <textarea
          id="expectations"
          name="expectations"
          rows={3}
          defaultValue={existing.expectations ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <label htmlFor="challenges" className={labelClass}>
          Biggest challenge right now
        </label>
        <textarea
          id="challenges"
          name="challenges"
          rows={2}
          defaultValue={existing.challenges ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="availability" className={labelClass}>
            When you are usually free
          </label>
          <input
            id="availability"
            name="availability"
            defaultValue={existing.availability ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="commsPref" className={labelClass}>
            Preferred contact channel
          </label>
          <select
            id="commsPref"
            name="commsPref"
            defaultValue={existing.commsPref ?? "whatsapp"}
            className={`mt-1.5 ${inputClass}`}
          >
            {COMMS_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending || photoBusy}
        className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-2 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-8px] shadow-accent/50 transition-all hover:brightness-110 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-4">
      <div>
        <label htmlFor="current" className={labelClass}>
          Current password
        </label>
        <input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="next" className={labelClass}>
            New password
          </label>
          <input
            id="next"
            name="next"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="confirm" className={labelClass}>
            Confirm new password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-60"
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
