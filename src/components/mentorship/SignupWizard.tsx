"use client";

import { useActionState, useRef, useState } from "react";
import { signUp, type SignupState } from "@/app/mentorship/join/actions";
import {
  COMMS_OPTIONS,
  INTEREST_OPTIONS,
  LEVEL_OPTIONS,
} from "@/lib/mentorship/constants";
import { compressImage } from "@/components/mentorship/image";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "block text-sm font-medium text-zinc-300";

const STEPS = ["Account", "About you", "Your story", "The programme"];

export function SignupWizard() {
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string>("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [state, action, pending] = useActionState<SignupState, FormData>(
    signUp,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  function field(id: string): string {
    const el = formRef.current?.elements.namedItem(id);
    return el && "value" in el ? String(el.value) : "";
  }

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (!field("name").trim()) return "Enter your full name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field("email").trim())) {
        return "Enter a valid email address.";
      }
      if (field("password").length < 8) {
        return "Choose a password of at least 8 characters.";
      }
      if (field("password") !== field("confirm")) {
        return "The two passwords do not match.";
      }
      return null;
    }
    if (current === 1) {
      if (!photo) return "Please add a photo of yourself.";
      if (!field("phone").trim()) return "Add a phone number (WhatsApp preferred).";
      return null;
    }
    if (current === 2) {
      if (field("backgroundStory").trim().length < 40) {
        return "Tell your story in a few sentences. It shapes your starter goals.";
      }
      if (interests.length === 0) return "Pick at least one area of interest.";
      if (!field("aspirations").trim())
        return "Sketch your 2-year vision, even roughly.";
      return null;
    }
    if (current === 3) {
      if (!field("expectations").trim())
        return "Tell your mentor what you want from the programme.";
      return null;
    }
    return null;
  }

  function goNext() {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setStepError(null);
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setPhotoBusy(false);
    }
  }

  const hidden = (i: number) => (step === i ? "" : "hidden");

  return (
    <div className="glass w-full max-w-2xl rounded-3xl p-8 shadow-2xl shadow-black/40 sm:p-10">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] gradient-text">
        Join the programme
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-white">
        Let&apos;s build your profile
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Your answers shape your starter goals and how your mentor guides you.
        About five minutes, once.
      </p>

      {/* Step indicator */}
      <ol className="mt-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-1.5">
            <span
              className={`h-1.5 rounded-full transition-colors ${
                i < step
                  ? "bg-accent/70"
                  : i === step
                    ? "bg-gradient-to-r from-accent to-accent-2"
                    : "bg-white/10"
              }`}
            />
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${
                i === step ? "text-accent" : "text-zinc-600"
              }`}
            >
              {s}
            </span>
          </li>
        ))}
      </ol>

      <form ref={formRef} action={action} className="mt-8">
        <input type="hidden" name="photoData" value={photo} />
        <input type="hidden" name="interests" value={interests.join(", ")} />

        {/* Step 1: Account */}
        <div className={`space-y-4 ${hidden(0)}`}>
          <div>
            <label htmlFor="name" className={labelClass}>
              Full name
            </label>
            <input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Your full name"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="password" className={labelClass}>
                Choose a password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="confirm" className={labelClass}>
                Confirm password
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            You will sign in with this email and password from now on.
          </p>
        </div>

        {/* Step 2: About you */}
        <div className={`space-y-4 ${hidden(1)}`}>
          <div className="flex items-center gap-5">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04]">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="Your photo" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-3xl text-zinc-600">
                  ☺
                </span>
              )}
            </div>
            <div>
              <label
                htmlFor="photo-file"
                className="inline-block cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10"
              >
                {photoBusy ? "Processing…" : photo ? "Change photo" : "Upload photo"}
              </label>
              <input
                id="photo-file"
                type="file"
                accept="image/*"
                onChange={onPhotoChange}
                className="sr-only"
              />
              <p className="mt-2 text-xs text-zinc-500">
                A clear, friendly headshot. We compress it in your browser.
              </p>
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
                placeholder="+234 800 000 0000"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="linkedin" className={labelClass}>
                LinkedIn profile (optional)
              </label>
              <input
                id="linkedin"
                name="linkedin"
                placeholder="linkedin.com/in/you"
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
                defaultValue="500 Level"
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
                defaultValue="2027"
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
        </div>

        {/* Step 3: Your story */}
        <div className={`space-y-4 ${hidden(2)}`}>
          <div>
            <label htmlFor="backgroundStory" className={labelClass}>
              Your story
            </label>
            <textarea
              id="backgroundStory"
              name="backgroundStory"
              rows={4}
              placeholder="Where are you from, what shaped you, why chemical engineering, and what drives you? Your mentor reads every word, and your starter goals are drafted from this."
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <span className={labelClass}>Areas of interest (pick any)</span>
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
            <label htmlFor="skills" className={labelClass}>
              Skills and tools you already have
            </label>
            <textarea
              id="skills"
              name="skills"
              rows={2}
              placeholder="e.g. HYSYS, Python, MATLAB, lab techniques, public speaking"
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
              placeholder="e.g. Process engineer at TotalEnergies; energy analyst"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="aspirations" className={labelClass}>
                Where do you want to be in 2 years?
              </label>
              <textarea
                id="aspirations"
                name="aspirations"
                rows={2}
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="longTermVision" className={labelClass}>
                And in 5 years?
              </label>
              <textarea
                id="longTermVision"
                name="longTermVision"
                rows={2}
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
          </div>
        </div>

        {/* Step 4: The programme */}
        <div className={`space-y-4 ${hidden(3)}`}>
          <div>
            <label htmlFor="expectations" className={labelClass}>
              What do you want most from this mentorship?
            </label>
            <textarea
              id="expectations"
              name="expectations"
              rows={3}
              placeholder="Be specific. This shapes your goals."
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="challenges" className={labelClass}>
              Your biggest challenge right now
            </label>
            <textarea
              id="challenges"
              name="challenges"
              rows={2}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="availability" className={labelClass}>
                When are you usually free?
              </label>
              <input
                id="availability"
                name="availability"
                placeholder="e.g. Saturdays 5-7pm, weekday evenings"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="commsPref" className={labelClass}>
                Preferred way to hear from your mentor
              </label>
              <select
                id="commsPref"
                name="commsPref"
                defaultValue="whatsapp"
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
          <p className="text-xs text-zinc-500">
            When you finish, we draft three starter goals from your story for
            you and your mentor to refine together.
          </p>
        </div>

        {(stepError || state?.error) && (
          <p
            role="alert"
            className="mt-5 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            {stepError ?? state?.error}
          </p>
        )}

        <div className="mt-7 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setStepError(null);
              setStep((s) => Math.max(0, s - 1));
            }}
            className={`rounded-full border border-white/15 px-5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 ${
              step === 0 ? "invisible" : ""
            }`}
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-2 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-8px] shadow-accent/50 transition-all hover:brightness-110"
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={pending || photoBusy}
              className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-2 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-8px] shadow-accent/50 transition-all hover:brightness-110 disabled:opacity-60"
            >
              {pending ? "Building your programme…" : "Finish & enter the portal"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
