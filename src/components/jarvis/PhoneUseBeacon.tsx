"use client";

import { useEffect } from "react";

// Pings Jarvis when the app is opened or brought back to the front, at most
// every 5 minutes, so app use counts towards the sleep estimate.
export function PhoneUseBeacon() {
  useEffect(() => {
    const KEY = "jarvis-health-ping";
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      let last = 0;
      try {
        last = Number(localStorage.getItem(KEY)) || 0;
      } catch {
        /* storage blocked: ping anyway */
      }
      if (Date.now() - last < 5 * 60_000) return;
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* fine */
      }
      void fetch("/jarvis/api/health-ping", { method: "POST", keepalive: true }).catch(() => {});
    };
    ping();
    document.addEventListener("visibilitychange", ping);
    return () => document.removeEventListener("visibilitychange", ping);
  }, []);
  return null;
}
