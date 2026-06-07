// Dream Island Resort — Service Worker
// Handles: Web Push notifications, install/activate lifecycle.
// NOTE: This file is in public/ so CRA copies it verbatim — no ES module syntax.
// Must remain vanilla ES2015.

const CACHE_NAME = "dream-island-v1";

// ── Install: skip waiting so new SW activates immediately ─────────────────────
self.addEventListener("install", function (event) {
  self.skipWaiting();
});

// ── Activate: claim all tabs so this SW controls existing pages ───────────────
self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

// ── Push: receive and display a notification ──────────────────────────────────
self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Dream Island", body: event.data ? event.data.text() : "" };
  }

  var title = data.title || "Dream Island";
  var options = {
    body:     data.body     || "",
    icon:     "/icon-192.png",
    badge:    "/icon-192.png",
    dir:      "rtl",
    lang:     "he",
    vibrate:  [200, 100, 200],
    tag:      data.tag      || "dream-island",
    renotify: true,
    data:     { url: data.url || "/" },
    // Actions shown on Android lock screen (Chrome 50+)
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click: focus app or open new tab ────────────────────────────
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // If the app is already open, focus it
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ("focus" in client) return client.focus();
        }
        // Otherwise open a new window
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      })
  );
});

// ── Push subscription change: auto-resubscribe if browser rotates keys ────────
self.addEventListener("pushsubscriptionchange", function (event) {
  // Resubscribe with the same VAPID key — frontend will sync the new sub to DB
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription
        ? { userVisibleOnly: true, applicationServerKey: event.oldSubscription.options.applicationServerKey }
        : { userVisibleOnly: true }
      )
      .then(function (sub) {
        // Post new subscription back to the app window so it can save to Supabase
        return self.clients.matchAll({ type: "window" }).then(function (clients) {
          clients.forEach(function (c) {
            c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED", subscription: sub.toJSON() });
          });
        });
      })
      .catch(function (e) {
        console.warn("[SW] pushsubscriptionchange resubscribe failed:", e);
      })
  );
});
