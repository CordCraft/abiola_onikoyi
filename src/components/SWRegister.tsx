"use client";

import { useEffect } from "react";

// Registers the service worker (Web Push + installability). Safe no-op where
// service workers are unavailable.
export function SWRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  }, []);
  return null;
}
