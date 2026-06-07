// src/utils/pushNotifications.js
// Helpers for Web Push subscription lifecycle.
// Used by App.js bell button and by the SW pushsubscriptionchange handler.

const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY;

/**
 * Convert a URL-safe base64 string (VAPID public key format) to a Uint8Array
 * as required by pushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Returns the current push state.
 * @returns {'unsupported'|'denied'|'subscribed'|'unsubscribed'|'sw_missing'}
 */
export async function getPushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "sw_missing";
  }
}

/**
 * Request notification permission, subscribe to push, and upsert the
 * PushSubscription object to the push_subscriptions Supabase table.
 *
 * @param {object} supabase   — Supabase client
 * @param {string} userId     — authenticated user UUID
 * @returns {PushSubscription|null}
 */
export async function subscribeToPush(supabase, userId) {
  if (!VAPID_PUBLIC_KEY) throw new Error("REACT_APP_VAPID_PUBLIC_KEY not set");

  // 1. Request permission (shows browser dialog)
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("permission_denied");

  // 2. Wait for SW to be ready
  const reg = await navigator.serviceWorker.ready;

  // 3. Subscribe via the Push API
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  // 4. Persist to Supabase (upsert — one row per user, latest wins)
  await syncSubscriptionToSupabase(supabase, userId, sub);

  return sub;
}

/**
 * Unsubscribe from push and remove the record from Supabase.
 */
export async function unsubscribeFromPush(supabase, userId) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* ignore if already gone */ }

  await supabase.from("push_subscriptions").delete().eq("user_id", userId);
}

/**
 * Upsert a PushSubscription object to Supabase.
 * Called on initial subscribe and on pushsubscriptionchange (key rotation).
 */
export async function syncSubscriptionToSupabase(supabase, userId, sub) {
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id:      userId,
      subscription: sub.toJSON ? sub.toJSON() : sub, // handle both PushSubscription and plain JSON
      user_agent:   navigator.userAgent.slice(0, 200),
      updated_at:   new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw new Error("db_push_sub: " + error.message);
}
