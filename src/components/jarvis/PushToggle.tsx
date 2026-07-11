"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

type State = "unsupported" | "default" | "subscribed" | "denied" | "working";

// navigator.serviceWorker.ready never settles if registration failed, so every
// use must be raced against a timeout or the UI hangs on "..." forever.
function swReady(timeoutMs = 4000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("service worker not ready")), timeoutMs),
    ),
  ]);
}

// "Enable notifications on this device" — subscribes this browser to the daily
// briefing and nudges via Web Push. On iPhone this only works after the site is
// installed to the home screen (iOS 16.4+).
export function PushToggle() {
  const [state, setState] = useState<State>("working");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      try {
        const reg = await swReady();
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          // Self-heal: re-upsert so a pruned server row (or a failed original
          // POST) does not leave a device that says on but receives nothing.
          fetch("/jarvis/api/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscription: sub.toJSON() }),
          }).catch(() => {});
        }
        setState(sub ? "subscribed" : "default");
      } catch {
        setState("unsupported");
      }
    })();
  }, []);

  async function toggle() {
    if (state === "subscribed") {
      setState("working");
      try {
        const reg = await swReady();
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          // Browser first; a stale server row is pruned on the next failed push.
          await sub.unsubscribe();
          fetch("/jarvis/api/push", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          }).catch(() => {});
        }
        setState("default");
      } catch {
        setState("subscribed");
      }
      return;
    }

    setState("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "default");
        return;
      }
      const reg = await swReady();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      const res = await fetch("/jarvis/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setState("subscribed");
    } catch {
      setState("default");
    }
  }

  if (state === "unsupported") return null;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={state === "working" || state === "denied"}
      title={
        state === "denied"
          ? "Notifications are blocked in browser settings"
          : state === "subscribed"
            ? "Daily briefing on. Tap to turn off on this device."
            : "Get the daily briefing on this device"
      }
      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
        state === "subscribed"
          ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
          : "border-white/25 bg-white/5 text-white hover:bg-white/10"
      }`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
      {state === "working" ? "..." : state === "subscribed" ? "Briefing on" : state === "denied" ? "Blocked" : "Notifications"}
    </button>
  );
}
