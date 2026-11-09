"use client";

import { useState, useTransition } from "react";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import {
  listPasskeys,
  removePasskey,
  type PasskeyRow,
} from "@/app/jarvis/settings/passkey-actions";

function fmt(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function PasskeyManager({ initial }: { initial: PasskeyRow[] }) {
  const [rows, setRows] = useState<PasskeyRow[]>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function refresh() {
    setRows(await listPasskeys());
  }

  async function setup() {
    setMessage(null);
    setBusy(true);
    try {
      if (!browserSupportsWebAuthn() || !(await platformAuthenticatorIsAvailable())) {
        setMessage("This browser has no Face ID or Touch ID available.");
        return;
      }
      const optsRes = await fetch("/api/jarvis-auth/passkey/register-options", {
        method: "POST",
      });
      if (!optsRes.ok) throw new Error("Could not start setup");
      const optionsJSON = await optsRes.json();
      const response = await startRegistration({ optionsJSON });
      const verifyRes = await fetch("/api/jarvis-auth/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (!verifyRes.ok) throw new Error("Could not verify");
      setMessage("Face ID is set up on this device.");
      await refresh();
    } catch (err) {
      const cancelled =
        err instanceof WebAuthnError &&
        (err.code === "ERROR_CEREMONY_ABORTED" || err.name === "NotAllowedError");
      setMessage(
        cancelled
          ? "Setup was cancelled."
          : err instanceof WebAuthnError && err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
            ? "This device is already set up."
            : "Face ID setup failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function remove(id: string) {
    if (!window.confirm("Remove this device? Face ID will stop working on it.")) return;
    startTransition(async () => {
      await removePasskey(id);
      await refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900 p-5">
      <h2 className="text-lg font-semibold text-white">Face ID sign-in</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Open Jarvis by looking at your phone. Your password still works as a
        fallback.
      </p>

      <button
        type="button"
        onClick={() => void setup()}
        disabled={busy}
        className="mt-4 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-sky-400 disabled:opacity-60"
      >
        {busy ? "Waiting for Face ID…" : "Set up Face ID on this device"}
      </button>
      {message ? (
        <p role="status" className="mt-3 text-sm text-zinc-300">
          {message}
        </p>
      ) : null}

      <ul className="mt-5 divide-y divide-white/10">
        {rows.length === 0 ? (
          <li className="py-3 text-sm text-zinc-500">No devices yet.</li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{r.deviceName}</p>
                <p className="text-xs text-zinc-500">
                  Added {fmt(r.createdAt)} · Last used {fmt(r.lastUsedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(r.id)}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
