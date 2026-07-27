"use client";

import { useActionState } from "react";
import Link from "next/link";
import { menteeLogin, type MenteeLoginState } from "./actions";
import { profile } from "@/content/profile";
import { COHORT_LABEL } from "@/lib/mentorship/constants";

const inputClass =
  "mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-white placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";

export default function MenteeLoginPage() {
  const [state, action, pending] = useActionState<MenteeLoginState, FormData>(
    menteeLogin,
    undefined,
  );

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      {/* Ambient backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mentorship/portal-ambient.jpg"
          alt=""
          className="ambient-drift h-full w-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/85 to-background" />
      </div>

      <div className="glass w-full max-w-3xl overflow-hidden rounded-3xl shadow-2xl shadow-black/40">
        <div className="grid md:grid-cols-[1fr_0.85fr]">
          {/* Form side */}
          <div className="p-8 sm:p-10">
            <Link href="/mentorship" className="flex items-center gap-2.5 text-white">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-md bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-mark.png"
                  alt={`${profile.name} logo`}
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="font-semibold tracking-tight">
                Mentorship Portal
              </span>
            </Link>

            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.25em] gradient-text">
              {COHORT_LABEL}
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Welcome back</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Sign in with your email and password.
            </p>

            <form action={action} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-zinc-300"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className={inputClass}
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  Forgot it? Ask your mentor for a reset, then register again on
                  the Join page. Your profile is kept.
                </p>
              </div>

              {state?.error ? (
                <p
                  role="alert"
                  className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300"
                >
                  {state.error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-[0_8px_30px_-8px] shadow-accent/50 transition-all hover:brightness-110 disabled:opacity-60"
              >
                {pending ? "Signing in…" : "Enter the portal"}
              </button>
            </form>

            <div className="mt-6 rounded-xl border border-accent/20 bg-accent/[0.06] p-4">
              <p className="text-sm font-medium text-white">New mentee?</p>
              <p className="mt-0.5 text-xs text-zinc-400">
                Create your account and build your profile in one go.
              </p>
              <Link
                href="/mentorship/join"
                className="mt-3 inline-block rounded-full border border-accent/40 px-4 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
              >
                Join the programme →
              </Link>
            </div>

            <Link
              href="/mentorship"
              className="mt-6 block text-sm text-zinc-400 transition-colors hover:text-white"
            >
              ← About the programme
            </Link>
          </div>

          {/* Art side */}
          <div className="relative hidden md:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/mentorship/login-art.jpg"
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent" />
            <div className="absolute bottom-0 p-8">
              <p className="text-lg font-medium leading-snug text-white">
                “Three strong goals beat ten vague ones.”
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                {profile.name} · Your mentor
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
