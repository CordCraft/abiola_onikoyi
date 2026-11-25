import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { ensureCompanionTables } from "@/lib/jarvis/companion-setup";
import { hasActiveAppDevice, sendToAppDevices } from "@/lib/jarvis/app-push";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  // Notification action buttons (Chrome/Android; iOS web push ignores them)
  actions?: { action: string; title: string }[];
  // Arbitrary data the service worker needs to execute an action
  taskId?: string;
  // Signal cards: the service worker posts Do it / Not now for this id
  signalId?: string;
  // What this is about: picks the quick answers on the reply screen and the
  // banner buttons in the native app.
  kind?: "health" | "task" | "signal" | "briefing" | "reply" | "other";
  // Extra context passed to Jarvis with a reply (e.g. which plan item).
  ref?: Record<string, string>;
  // The chat this belongs to (Jarvis answering a reply), so the next reply
  // continues the same conversation.
  threadId?: string;
  // A screen in the native iPhone app to open on tap (e.g. "/songs/<id>"),
  // instead of the web reply page.
  appRoute?: string;
};

type Stored = { id: string | null; kind: string; url: string };

// Every notification is stored so tapping it opens /jarvis/reply/<id> (web)
// and a typed reply in the native app can be matched to what it answers.
async function store(payload: PushPayload): Promise<Stored> {
  const kind = payload.kind ?? (payload.signalId ? "signal" : payload.taskId ? "task" : "other");
  try {
    await ensureCompanionTables();
    const row = await prisma.jarvisNotification.create({
      data: {
        title: payload.title.slice(0, 200),
        body: payload.body.slice(0, 2000),
        url: payload.url,
        kind,
        tag: payload.tag ?? null,
        threadId: payload.threadId ?? null,
        ref: { ...(payload.ref ?? {}), ...(payload.taskId ? { taskId: payload.taskId } : {}), ...(payload.signalId ? { signalId: payload.signalId } : {}) },
      },
    });
    return { id: row.id, kind, url: `/jarvis/reply/${row.id}` };
  } catch (err) {
    console.error("push: could not store notification, using original url", err);
    return { id: null, kind, url: payload.url };
  }
}

// Send a notification to the native iPhone app and every web push
// subscription. When the native app is installed, iPhone web push
// subscriptions are skipped so the phone does not buzz twice. Prunes dead
// subscriptions and no-ops cleanly when nothing is configured.
export async function sendPushToAll(
  payload: PushPayload,
): Promise<{ sent: number; pruned: number; failed: number; skipped?: string }> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subscriptions = publicKey && privateKey ? await prisma.jarvisPushSubscription.findMany() : [];
  await ensureCompanionTables().catch(() => {});
  const nativeApp = await hasActiveAppDevice();
  if (!subscriptions.length && !nativeApp) {
    return { sent: 0, pruned: 0, failed: 0, skipped: publicKey && privateKey ? "No subscribed devices" : "VAPID keys not configured and no app installed" };
  }

  const stored = await store(payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  if (nativeApp && stored.id) {
    const r = await sendToAppDevices({ notificationId: stored.id, title: payload.title, body: payload.body, kind: stored.kind, threadId: payload.threadId, appRoute: payload.appRoute });
    sent += r.sent;
    pruned += r.pruned;
    failed += r.failed;
  }

  const webTargets = nativeApp ? subscriptions.filter((s) => !s.endpoint.includes("push.apple.com")) : subscriptions;
  if (webTargets.length && publicKey && privateKey) {
    webpush.setVapidDetails("mailto:abiolaonikoyi@gmail.com", publicKey, privateKey);
    const wire = {
      title: payload.title,
      body: payload.body,
      url: stored.url,
      tag: payload.tag,
      actions: payload.actions,
      taskId: payload.taskId,
      signalId: payload.signalId,
    };
    const body = JSON.stringify(wire);
    for (const sub of webTargets) {
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
          await prisma.jarvisPushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
          pruned += 1;
        } else {
          failed += 1;
          console.error(`push: send failed (${status ?? "?"})`, err);
        }
      }
    }
  }
  return { sent, pruned, failed };
}
