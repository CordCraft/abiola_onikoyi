"use client";

import { useState } from "react";
import {
  pairMobileDevice,
  revokeMobileDevice,
  type DeviceRow,
} from "@/app/jarvis/settings/mobile-actions";

// Pairs the native Jarvis iPhone app. On the iPhone: tap "Pair this iPhone",
// then "Open in the Jarvis app". From a laptop: copy the code and paste it in
// the app's pairing screen.
export function MobilePairing({ initial }: { initial: DeviceRow[] }) {
  const [devices, setDevices] = useState(initial);
  const [name, setName] = useState("iPhone");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const link = token
    ? `jarvisapp://pair?token=${encodeURIComponent(token)}&host=${encodeURIComponent(window.location.origin)}`
    : null;

  async function pair() {
    setBusy(true);
    try {
      const r = await pairMobileDevice(name);
      setToken(r.token);
      setDevices(r.devices);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Unpair this device? The app on it will be signed out.")) return;
    setDevices(await revokeMobileDevice(id));
  }

  return (
    <section className="rounded-2xl border border-white/60 bg-white/80 p-5">
      <h2 className="text-lg font-semibold text-zinc-900">iPhone app</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Pair the native Jarvis app for Siri, widgets and notification buttons.
      </p>

      {devices.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 text-sm">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2">
              <span className="text-zinc-800">
                {d.name}
                <span className="ml-2 text-zinc-500">
                  paired {new Date(d.createdAt).toLocaleDateString()}
                </span>
              </span>
              <button onClick={() => revoke(d.id)} className="text-red-600 hover:underline">
                Unpair
              </button>
            </li>
          ))}
        </ul>
      )}

      {link ? (
        <div className="mt-4 space-y-3 text-sm">
          <a
            href={link}
            className="block rounded-xl bg-zinc-900 px-4 py-3 text-center font-medium text-white"
          >
            Open in the Jarvis app
          </a>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
            className="w-full rounded-xl border border-zinc-300 px-4 py-2 text-zinc-700"
          >
            {copied ? "Copied" : "Copy pairing code"}
          </button>
          <p className="text-zinc-500">Keep this code private: it signs the app in. It is not shown again, and Unpair revokes it.</p>
        </div>
      ) : (
        <div className="mt-4 flex gap-2 text-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-xl border border-zinc-300 px-3 py-2"
            aria-label="Device name"
          />
          <button
            onClick={pair}
            disabled={busy}
            className="rounded-xl bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Pairing..." : "Pair this iPhone"}
          </button>
        </div>
      )}
    </section>
  );
}
