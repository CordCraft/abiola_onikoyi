import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  // Notification action buttons (Chrome/Android; iOS ignores them)
  actions?: { action: string; title: string }[];
  // Arbitrary data the service worker needs to execute an action
  taskId?: string;
};

// Send a notification to every subscribed device. Prunes dead subscriptions,
// counts hard failures, and no-ops cleanly when VAPID keys are not configured.
export async function sendPushToAll(
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; failed: number; skipped?: string }> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return { sent: 0, pruned: 0, failed: 0, skipped: "VAPID keys not configured" };

  const subscriptions = await prisma.jarvisPushSubscription.findMany();
  if (!subscriptions.length) return { sent: 0, pruned: 0, failed: 0, skipped: "No subscribed devices" };

  webpush.setVapidDetails("mailto:abiolaonikoyi@gmail.com", publicKey, privateKey);
  const body = JSON.stringify(payload);

  let sent = 0;
  let pruned = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 3600 * 12, urgency: "normal" },
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await prisma.jarvisPushSubscription
          .delete({ where: { endpoint: sub.endpoint } })
          .catch(() => {});
        pruned += 1;
      } else {
        failed += 1;
        console.error(`push: send failed (${status ?? "?"})`, err);
      }
    }
  }
  return { sent, pruned, failed };
}
