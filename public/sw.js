/* Jarvis service worker: install/activate + Web Push handlers.
   Deliberately NO fetch interception — the chat streams NDJSON and must never
   be buffered or cached by the SW. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "Jarvis", body: "", url: "/jarvis" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch {
    if (event.data) data.body = event.data.text();
  }
  // Always show a notification: iOS revokes push subscriptions that stay silent.
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/jarvis", taskId: data.taskId || null },
      // Action buttons (Mark done / Snooze on task nudges); iOS ignores these.
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
      // Distinct tag per push (sender provides it) so a new notification never
      // silently replaces an unread one; renotify re-alerts where supported.
      tag: data.tag || "jarvis-" + Date.now(),
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/jarvis";

  // Action buttons execute without opening the app.
  if (event.action && data.taskId) {
    event.waitUntil(
      fetch("/jarvis/api/task-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: data.taskId, action: event.action }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("action failed");
          return self.registration.showNotification(
            event.action === "done" ? "Task marked done" : "Snoozed until tomorrow",
            { icon: "/icon-192.png", badge: "/icon-192.png", tag: "jarvis-action-ack" }
          );
        })
        .catch(() =>
          // Session expired or offline: open the app instead.
          self.clients.openWindow(url)
        )
    );
    return;
  }
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Prefer a tab already inside the app.
        const existing =
          clients.find((c) => c.url && c.url.includes("/jarvis")) || clients[0];
        if (existing && "focus" in existing) {
          return existing
            .focus()
            .then((focused) =>
              "navigate" in focused ? focused.navigate(url) : focused
            )
            .catch(() => self.clients.openWindow(url));
        }
        return self.clients.openWindow(url);
      })
  );
});
