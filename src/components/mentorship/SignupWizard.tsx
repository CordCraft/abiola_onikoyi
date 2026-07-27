"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { signUp, type SignupState } from "@/app/mentorship/join/actions";
import {
  COMMS_OPTIONS,
  INTEREST_OPTIONS,
  LEVEL_OPTIONS,
} from "@/lib/mentorship/constants";
import { compressImage } from "@/components/mentorship/image";
import { PasswordInput } from "@/components/mentorship/PasswordInput";
import { Spinner } from "@/components/mentorship/Spinner";
import { VoiceTextArea } from "@/components/mentorship/VoiceTextArea";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "block text-sm font-medium text-zinc-300";

const STEPS = ["Account", "About you", "Your story", "The programme"];

// Everything the mentee types lives in this controlled state, and (except
// passwords) is saved to localStorage on every keystroke. That survives both
// React's form reset after a server-action error and a full page refresh, so
// no input is ever lost. Passwords stay in memory only.
type Draft = {
  step: number;
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  level: string;
  gradYear: string;
  backgroundStory: string;
  skills: string;
  dreamRoles: string;
  aspirations: string;
  longTermVision: string;
  expectations: string;
  challenges: string;
  availability: string;
  commsPref: string;
  interests: string[];
  photo: string;
};

const EMPTY_DRAFT: Draft = {
  step: 0,
  name: "",
  email: "",
  phone: "",
  linkedin: "",
  level: "500 Level",
  gradYear: "2027",
  backgroundStory: "",
  skills: "",
  dreamRoles: "",
  aspirations: "",
  longTermVision: "",
  expectations: "",
  challenges: "",
  availability: "",
  commsPref: "whatsapp",
  interests: [],
  photo: "",
};

const DRAFT_KEY = "mentorship-signup-draft-v1";

export function SignupWizard() {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [customInterest, setCustomInterest] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [state, action, pending] = useActionState<SignupState, FormData>(
    signUp,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  const step = draft.step;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Restore any saved draft once after mount (localStorage is client-only;
  // deferred a tick so hydration completes against the empty draft first).
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(DRAFT_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<Draft>;
          setDraft({ ...EMPTY_DRAFT, ...parsed });
        }
      } catch {
        // Corrupt draft: start fresh.
      }
      setRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Save progressively after every change.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage full or blocked: the controlled state still protects the form.
    }
  }, [draft, restored]);

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    setDraft(EMPTY_DRAFT);
    setPassword("");
    setConfirm("");
    setStepError(null);
  }

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (!draft.name.trim()) return "Enter your full name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
        return "Enter a valid email address.";
      }
      if (password.length < 8) return "Choose a password of at least 8 characters.";
      if (password !== confirm) return "The two passwords do not match.";
      return null;
    }
    if (current === 1) {
      if (!draft.photo) return "Please add a photo of yourself.";
      if (!draft.phone.trim()) return "Add a phone number (WhatsApp preferred).";
      return null;
    }
    if (current === 2) {
      if (draft.backgroundStory.trim().length < 40) {
        return "Tell your story in a few sentences. It shapes your starter goals.";
      }
      if (draft.interests.length === 0) return "Pick at least one area of interest.";
      if (!draft.aspirations.trim()) return "Sketch your 2-year vision, even roughly.";
      return null;
    }
    if (current === 3) {
      if (!draft.expectations.trim())
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
    set("step", Math.min(step + 1, STEPS.length - 1));
  }

  // Validate every step before submitting; jump back to the first one with a
  // gap (covers a refresh that emptied the in-memory passwords).
  function onSubmitAll(e: React.FormEvent) {
    for (let i = 0; i < STEPS.length; i++) {
      const err = validateStep(i);
      if (err) {
        e.preventDefault();
        set("step", i);
        setStepError(err);
        return;
      }
    }
    setStepError(null);
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setStepError(null);
    try {
      set("photo", await compressImage(file));
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function toggleInterest(opt: string) {
    setDraft((d) => ({
      ...d,
      interests: d.interests.includes(opt)
        ? d.interests.filter((i) => i !== opt)
        : [...d.interests, opt],
    }));
  }

  function addCustomInterest() {
    const cleaned = customInterest.trim().slice(0, 40);
    if (!cleaned) return;
    setDraft((d) => ({
      ...d,
      interests: d.interests.includes(cleaned)
        ? d.interests
        : [...d.interests, cleaned],
    }));
    setCustomInterest("");
  }

  const customInterests = draft.interests.filter(
    (i) => !(INTEREST_OPTIONS as readonly string[]).includes(i),
  );
  const hidden = (i: number) => (step === i ? "" : "hidden");
  const passwordOk = password.length >= 8;
  const matchOk = password.length > 0 && password === confirm;

  return (
    <div className="glass relative w-full max-w-2xl rounded-3xl p-8 shadow-2xl shadow-black/40 sm:p-10">
      {/* Busy overlay while the account is being created */}
      {pending ? (
        <div className="absolute inset-0 z-10 grid place-items-center rounded-3xl bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <Spinner className="h-8 w-8 text-accent" />
            <p className="text-sm font-medium text-white">
              Creating your account…
            </p>
            <p className="max-w-xs text-xs text-zinc-400">
              Setting up your portal. Your starter goals are drafted from your
              story moments after you land inside.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] gradient-text">
            Join the programme
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">
            Let&apos;s build your profile
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Your answers shape your starter goals and how your mentor guides
            you. About five minutes. Progress saves on this device as you type.
          </p>
        </div>
        <button
          type="button"
          onClick={clearDraft}
          className="shrink-0 text-xs text-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400 hover:underline"
        >
          Start over
        </button>
      </div>

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

      <form ref={formRef} action={action} onSubmit={onSubmitAll} className="mt-8">
        <input type="hidden" name="photoData" value={draft.photo} />
        <input type="hidden" name="interests" value={draft.interests.join(", ")} />

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
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
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
              value={draft.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="you@example.com"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="password" className={labelClass}>
                Choose a password
              </label>
              <div className="mt-1.5">
                <PasswordInput
                  id="password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="confirm" className={labelClass}>
                Confirm password
              </label>
              <div className="mt-1.5">
                <PasswordInput
                  id="confirm"
                  name="confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Same password again"
                  className={inputClass}
                />
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs">
            <p className="font-medium text-zinc-300">Password checklist</p>
            <p className={`mt-1.5 ${passwordOk ? "text-emerald-300" : "text-zinc-500"}`}>
              {passwordOk ? "✓" : "•"} At least 8 characters (a phrase you can
              remember works well)
            </p>
            <p className={`mt-0.5 ${matchOk ? "text-emerald-300" : "text-zinc-500"}`}>
              {matchOk ? "✓" : "•"} Both entries match (use the eye icon to
              double-check)
            </p>
          </div>
        </div>

        {/* Step 2: About you */}
        <div className={`space-y-4 ${hidden(1)}`}>
          <div className="flex items-center gap-5">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04]">
              {photoBusy ? (
                <span className="grid h-full w-full place-items-center text-zinc-500">
                  <Spinner className="h-6 w-6" />
                </span>
              ) : draft.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.photo}
                  alt="Your photo"
                  className="h-full w-full object-cover"
                />
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
                {photoBusy ? "Processing…" : draft.photo ? "Change photo" : "Upload photo"}
              </label>
              <input
                id="photo-file"
                type="file"
                accept="image/*"
                onChange={onPhotoChange}
                className="sr-only"
              />
              <p className="mt-2 text-xs text-zinc-500">
                A clear, friendly headshot.
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
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
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
                value={draft.linkedin}
                onChange={(e) => set("linkedin", e.target.value)}
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
                value={draft.level}
                onChange={(e) => set("level", e.target.value)}
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
                value={draft.gradYear}
                onChange={(e) => set("gradYear", e.target.value)}
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
            <div className="mt-1.5">
              <VoiceTextArea
                id="backgroundStory"
                name="backgroundStory"
                rows={4}
                value={draft.backgroundStory}
                onChange={(t) => set("backgroundStory", t)}
                placeholder="Where are you from, what shaped you, why chemical engineering, and what drives you? Speak or type. Your mentor reads every word, and your starter goals are drafted from this."
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <span className={labelClass}>Areas of interest (pick any, or add your own)</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((opt) => {
                const on = draft.interests.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleInterest(opt)}
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
              {customInterests.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed
                  onClick={() => toggleInterest(opt)}
                  title="Tap to remove"
                  className="rounded-full border border-accent-2/60 bg-accent-2/15 px-3 py-1.5 text-xs font-medium text-accent-2 transition-colors"
                >
                  {opt} ×
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={customInterest}
                onChange={(e) => setCustomInterest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomInterest();
                  }
                }}
                placeholder="Something else? Add your own interest"
                className={`${inputClass} max-w-xs`}
              />
              <button
                type="button"
                onClick={addCustomInterest}
                className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10"
              >
                Add
              </button>
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
              value={draft.skills}
              onChange={(e) => set("skills", e.target.value)}
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
              value={draft.dreamRoles}
              onChange={(e) => set("dreamRoles", e.target.value)}
              placeholder="e.g. Process engineer at TotalEnergies; energy analyst"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="aspirations" className={labelClass}>
                Where do you want to be in 2 years?
              </label>
              <div className="mt-1.5">
                <VoiceTextArea
                  id="aspirations"
                  name="aspirations"
                  rows={3}
                  value={draft.aspirations}
                  onChange={(t) => set("aspirations", t)}
                  placeholder="Speak or type it."
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="longTermVision" className={labelClass}>
                And in 5 years?
              </label>
              <div className="mt-1.5">
                <VoiceTextArea
                  id="longTermVision"
                  name="longTermVision"
                  rows={3}
                  value={draft.longTermVision}
                  onChange={(t) => set("longTermVision", t)}
                  placeholder="Dream out loud."
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Step 4: The programme */}
        <div className={`space-y-4 ${hidden(3)}`}>
          <div>
            <label htmlFor="expectations" className={labelClass}>
              What do you want most from this mentorship?
            </label>
            <div className="mt-1.5">
              <VoiceTextArea
                id="expectations"
                name="expectations"
                rows={3}
                value={draft.expectations}
                onChange={(t) => set("expectations", t)}
                placeholder="Be specific. This shapes your goals."
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="challenges" className={labelClass}>
              Your biggest challenge right now
            </label>
            <div className="mt-1.5">
              <VoiceTextArea
                id="challenges"
                name="challenges"
                rows={2}
                value={draft.challenges}
                onChange={(t) => set("challenges", t)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="availability" className={labelClass}>
                When are you usually free?
              </label>
              <input
                id="availability"
                name="availability"
                value={draft.availability}
                onChange={(e) => set("availability", e.target.value)}
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
                value={draft.commsPref}
                onChange={(e) => set("commsPref", e.target.value)}
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
              set("step", Math.max(0, step - 1));
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
              className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-2 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-8px] shadow-accent/50 transition-all hover:brightness-110 disabled:opacity-60"
            >
              {pending ? <Spinner className="h-4 w-4" /> : null}
              {pending ? "Building your programme…" : "Finish & enter the portal"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
