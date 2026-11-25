import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { getToday, registerPushToken, replyToNotification, unregisterPushToken } from "./api";
import { getPref, loadPairing, setPref } from "./storage";

// Notifications come from the site's companion push (src/lib/jarvis/app-push.ts).
// Categories must match categoryFor() there. Every category has a Reply text
// field: what you type goes to Jarvis as a chat message, and Jarvis answers
// with another notification you can reply to. Buttons act directly.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const reply: Notifications.NotificationAction = {
  identifier: "reply",
  buttonTitle: "Reply",
  textInput: { submitButtonTitle: "Send", placeholder: "Tell Jarvis" },
  options: { opensAppToForeground: false },
};

export async function setupCategories() {
  await Notifications.setNotificationCategoryAsync("jarvis-task", [
    { identifier: "done", buttonTitle: "Done", options: { opensAppToForeground: false } },
    reply,
  ]);
  await Notifications.setNotificationCategoryAsync("jarvis-signal", [
    // Approving can send a message on your behalf, so it needs Face ID first.
    { identifier: "approve", buttonTitle: "Do it", options: { opensAppToForeground: false, isAuthenticationRequired: true } },
    { identifier: "dismiss", buttonTitle: "Not now", options: { opensAppToForeground: false } },
    reply,
  ]);
  await Notifications.setNotificationCategoryAsync("jarvis-health", [reply]);
  await Notifications.setNotificationCategoryAsync("jarvis-reply", [reply]);
}

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPushToken(data, Device.deviceName ?? "iPhone");
  await setPref("pushToken", data);
  return data;
}

export async function unregisterPush(): Promise<void> {
  const token = await getPref("pushToken");
  if (token) await unregisterPushToken(token).catch(() => {});
}

type Data = { notificationId?: string; kind?: string; threadId?: string | null; route?: string };

export async function handleResponse(
  r: Notifications.NotificationResponse,
  open: (route: string) => void,
) {
  const data = (r.notification.request.content.data ?? {}) as Data;
  const action = r.actionIdentifier;
  if (!data.notificationId) return;
  try {
    if (action === "reply") {
      const text = (r.userText ?? "").trim();
      if (text) await replyToNotification(data.notificationId, { action: "reply", text });
      return;
    }
    if (action === "done" || action === "approve" || action === "dismiss") {
      await replyToNotification(data.notificationId, { action });
      if (action === "done") await getToday().catch(() => {}); // refresh widgets
      return;
    }
  } catch (e) {
    console.warn("notification action failed", e);
    return;
  }
  // A plain tap: the website's reply page shows the message with one-tap answers
  // (or the app screen the notification names, e.g. a song's Suno pack)
  if (action === Notifications.DEFAULT_ACTION_IDENTIFIER) open(data.route ?? `/jarvis/reply/${data.notificationId}`);
}

export async function openOnWeb(path: string) {
  const p = await loadPairing();
  const host = p?.host ?? "https://abiolaonikoyi.com";
  await WebBrowser.openBrowserAsync(path.startsWith("http") ? path : `${host}${path}`);
}
