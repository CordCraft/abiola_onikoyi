"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  WebAuthnError,
} from "@simplewebauthn/browser";

// Same rule as login/actions.ts: same-site paths only.
function safeDestination(from: string): string {
  return from.startsWith("/") && !from.startsWith("//") && !from.includes("\\")
    ? from
    : "/dashboard";
}

type Mode = "auto" | "manual" | "conditional";

export function PasskeySignIn({ from }: { from: string }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const run = useCallback(
    async (mode: Mode) => {
      if (mode === "manual") {
        setBusy(true);
        setError(null);
      }
      try {
        const optsRes = await fetch("/api/jarvis-auth/passkey/login-options", {
          method: "POST",
        });
        if (!optsRes.ok) throw new Error("options");
        const optionsJSON = await optsRes.json();
        const response = await startAuthentication({
          optionsJSON,
          useBrowserAutofill: mode === "conditional",
        });
        const verifyRes = await fetch("/api/jarvis-auth/passkey/login-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response }),
        });
        if (!verifyRes.ok) {
          if (mode === "manual") {
            setError("Face ID sign-in did not work. Use your password instead.");
          }
          return;
        }
        window.location.assign(safeDestination(from));
      } catch (err) {
        // Cancelled prompts and silent auto-start failures stay quiet; only a
        // deliberate tap on the button gets a message.
        const cancelled =
          err instanceof WebAuthnError &&
          (err.code === "ERROR_CEREMONY_ABORTED" ||
            err.name === "NotAllowedError" ||
            err.name === "AbortError");
        if (mode === "manual" && !cancelled) {
          setError("Face ID sign-in did not work. Use your password instead.");
        }
      } finally {
        if (mode === "manual") setBusy(false);
      }
    },
    [from],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    (async () => {
      if (!browserSupportsWebAuthn()) return;
      const platform = await platformAuthenticatorIsAvailable().catch(() => false);
      if (!alive || !platform) return;
      setSupported(true);

      const autoStart = from === "/jarvis" || from.startsWith("/jarvis/");
      const triedKey = "jarvis_faceid_auto";
      try {
        if (autoStart && !sessionStorage.getItem(triedKey)) {
          sessionStorage.setItem(triedKey, "1");
          await run("auto");
          return;
        }
      } catch {
        // sessionStorage unavailable: skip the one-shot auto start.
      }
      if (await browserSupportsWebAuthnAutofill().catch(() => false)) {
        void run("conditional");
      }
    })();
    return () => {
      alive = false;
    };
  }, [from, run]);

  if (!supported) return null;

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => void run("manual")}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-sky-400 disabled:opacity-60"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <path d="M9 10v1M15 10v1M12 10v3h-1M9 16c.8.7 1.8 1 3 1s2.2-.3 3-1" />
        </svg>
        {busy ? "Waiting for Face ID…" : "Sign in with Face ID"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-center text-sm text-red-300">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex items-center gap-3 text-xs text-zinc-500">
        <span className="h-px flex-1 bg-white/10" />
        or use your password
        <span className="h-px flex-1 bg-white/10" />
      </div>
    </div>
  );
}
