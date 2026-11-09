"use client";

import { useState, useTransition } from "react";
import { newPairingCode } from "@/app/jarvis/machines/actions";

export function PairCard() {
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://abiolaonikoyi.com";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900">Pair a new computer</h2>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await newPairingCode();
              if (r.ok && r.code) {
                setCode(r.code);
                setExpires(r.expiresAt ?? null);
              } else setError(r.error || "Failed");
            })
          }
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "..." : code ? "New code" : "Show code"}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      {code ? (
        <div className="mt-3 space-y-3 text-xs text-zinc-600">
          <p>
            Code <span className="font-mono text-lg font-bold tracking-widest text-zinc-900">{code}</span>{" "}
            (single use, valid 15 minutes
            {expires ? `, until ${new Date(expires).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
            ). On the computer, in PowerShell:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-100">
{`node scripts\\jarvis-bridge.mjs pair ${code} --name "Kuwait office" --url ${origin}
powershell -ExecutionPolicy Bypass -File scripts\\install-jarvis-bridge.ps1`}
          </pre>
          <p>
            Run them from the repo folder (or copy the two files from <code>scripts/</code>). Then start it:{" "}
            <code>Start-ScheduledTask -TaskName &quot;Jarvis Bridge&quot;</code>. Full guide in docs/JARVIS-BRIDGE.md.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">Generates a one-time code to link another computer.</p>
      )}
    </section>
  );
}
