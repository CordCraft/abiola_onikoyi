"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type LoginState } from "./actions";
import { profile } from "@/content/profile";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined,
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2 text-white"
        >
          <span className="grid h-9 w-9 place-items-center rounded-md bg-white text-sm font-bold text-zinc-900">
            {profile.initials}
          </span>
          <span className="font-semibold tracking-tight">{profile.name}</span>
        </Link>

        <div className="rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-xl">
          <h1 className="text-xl font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Private projects area. Authorized access only.
          </p>

          <form action={action} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-zinc-300"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-white placeholder-zinc-500 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
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
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-white placeholder-zinc-500 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
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
              className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <Link
          href="/"
          className="mt-6 block text-center text-sm text-zinc-400 hover:text-white"
        >
          ← Back to site
        </Link>
      </div>
    </main>
  );
}
