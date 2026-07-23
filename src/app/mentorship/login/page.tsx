"use client";

import { useActionState } from "react";
import Link from "next/link";
import { menteeLogin, type MenteeLoginState } from "./actions";
import { profile } from "@/content/profile";
import { COHORT_LABEL } from "@/lib/mentorship/constants";

export default function MenteeLoginPage() {
  const [state, action, pending] = useActionState<MenteeLoginState, FormData>(
    menteeLogin,
    undefined,
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/mentorship"
          className="mb-8 flex items-center justify-center gap-2 text-white"
        >
          <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-md bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-mark.png"
              alt={`${profile.name} logo`}
              className="h-full w-full object-contain"
            />
          </span>
          <span className="font-semibold tracking-tight">Mentorship Portal</span>
        </Link>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] gradient-text">
            {COHORT_LABEL}
          </p>
          <h1 className="mt-2 text-xl font-semibold text-white">Mentee sign in</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Use the access code your mentor shared with you.
          </p>

          <form action={action} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-300"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-white placeholder-zinc-500 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>

            <div>
              <label
                htmlFor="code"
                className="block text-sm font-medium text-zinc-300"
              >
                Access code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                required
                placeholder="ABCD-EFGH"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 font-mono uppercase tracking-widest text-white placeholder-zinc-600 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
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
              className="w-full rounded-lg bg-gradient-to-r from-accent to-accent-2 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Enter the portal"}
            </button>
          </form>
        </div>

        <Link
          href="/mentorship"
          className="mt-6 block text-center text-sm text-zinc-400 hover:text-white"
        >
          ← About the programme
        </Link>
      </div>
    </main>
  );
}
