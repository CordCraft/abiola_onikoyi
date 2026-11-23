"use client";

import { useState, useTransition } from "react";
import { newHealthToken } from "@/app/jarvis/health/actions";

export function HealthTokenBox({ hasToken, endpoint }: { hasToken: boolean; endpoint: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const make = () => {
    if (hasToken && !confirm("Make a new key? Shortcuts using the old key stop working until you paste the new one.")) return;
    start(async () => {
      const r = await newHealthToken();
      setToken(r.token ?? null);
      setCopied(false);
    });
  };

  return (
    <div className="space-y-2 text-sm">
      <p className="text-zinc-600">
        Endpoint: <code className="break-all rounded bg-zinc-100 px-1.5 py-0.5 text-xs">{endpoint}</code>
      </p>
      {token ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">Your key (shown once). Copy it into the Shortcuts now.</p>
          <code className="mt-1 block break-all text-xs text-zinc-900">{token}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(token).then(() => setCopied(true));
            }}
            className="mt-2 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white"
          >
            {copied ? "Copied" : "Copy key"}
          </button>
        </div>
      ) : (
        <p className="text-zinc-500">{hasToken ? "A key is set. Make a new one if you lost it." : "No key yet. Make one to connect your iPhone."}</p>
      )}
      <button
        type="button"
        onClick={make}
        disabled={pending}
        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 disabled:opacity-50"
      >
        {pending ? "Making..." : hasToken ? "Make a new key" : "Make my iPhone key"}
      </button>
    </div>
  );
}
