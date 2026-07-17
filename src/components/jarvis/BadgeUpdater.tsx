"use client";

import { useEffect } from "react";

// Shows the inbox count on the installed app's icon (Badging API).
export function BadgeUpdater({ count }: { count: number }) {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    try {
      if (count > 0) nav.setAppBadge?.(count);
      else nav.clearAppBadge?.();
    } catch { /* unsupported */ }
  }, [count]);
  return null;
}
