import "server-only";
import { prisma } from "@/lib/prisma";

// Native push to the Jarvis iPhone app through Expo's push service (EAS holds
// the APNs key, so nothing Apple-specific lives here). Each notification
// carries an iOS category, which decides the banner's buttons; every category
// has a "Reply" text field, so you can answer without opening anything.

export type AppPush = {
  notificationId: string;
  title: string;
  body: string;
  kind: string; // health | task | signal | briefing | reply | other
  threadId?: string | null;
  appRoute?: string; // screen in the iPhone app (mobile/) to open on tap
};

// Must match the categories registered in apps/jarvis-ios (src/notifications.ts).
export function categoryFor(kind: string): string {
  if (kind === "health") return "jarvis-health";
  if (kind === "task") return "jarvis-task";
  if (kind === "signal") return "jarvis-signal";
  return "jarvis-reply";
}

export async function hasActiveAppDevice(): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 864e5);
  return (await prisma.jarvisAppDevice.count({ where: { lastSeenAt: { gte: since } } }).catch(() => 0)) > 0;
}

export async function sendToAppDevices(p: AppPush): Promise<{ sent: number; pruned: number; failed: number }> {
  const devices = await prisma.jarvisAppDevice.findMany().catch(() => []);
  if (!devices.length) return { sent: 0, pruned: 0, failed: 0 };

  const messages = devices.map((d) => ({
    to: d.pushToken,
    title: p.title.slice(0, 120),
    body: p.body.slice(0, 1000),
    sound: "default",
    priority: "high",
    categoryId: categoryFor(p.kind),
    data: { notificationId: p.notificationId, kind: p.kind, threadId: p.threadId ?? null, ...(p.appRoute ? { route: p.appRoute } : {}) },
  }));

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  // Only needed if "enhanced push security" is switched on for the Expo project.
  if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  let sent = 0;
  let pruned = 0;
  let failed = 0;
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers, body: JSON.stringify(messages) });
    const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    const tickets = json?.data ?? [];
    for (let i = 0; i < devices.length; i++) {
      const t = tickets[i];
      if (t?.status === "ok") sent++;
      else if (t?.details?.error === "DeviceNotRegistered") {
        await prisma.jarvisAppDevice.delete({ where: { id: devices[i].id } }).catch(() => {});
        pruned++;
      } else {
        failed++;
        console.error("app-push: send failed", t ?? res.status);
      }
    }
  } catch (err) {
    console.error("app-push: request failed", err);
    failed = devices.length;
  }
  return { sent, pruned, failed };
}
