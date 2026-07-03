// Staff deep-link helpers — QR / URL → open a specific App.js page after login.
// Persists in sessionStorage so a scan → Google login → land on wa_inbox works.

const STORAGE_KEY = "xos_staff_deep_link";

export function buildStaffDeepLink({ page = "wa_inbox", phone = null, guestName = null } = {}) {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://dream-ai-system.vercel.app";
  const params = new URLSearchParams();
  params.set("page", page);
  if (phone) params.set("phone", String(phone).replace(/\D/g, ""));
  if (guestName) params.set("guestName", guestName);
  return `${origin}/?${params.toString()}`;
}

/** Read ?page=… from the URL once, stash for post-login navigation, strip query. */
export function captureStaffDeepLinkFromUrl() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  if (!page) return;
  const payload = {
    page,
    phone: params.get("phone") || null,
    guestName: params.get("guestName") || null,
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — best effort */
  }
  window.history.replaceState({}, "", window.location.pathname || "/");
}

/** Returns pending deep link (and clears storage) or null. */
export function consumeStaffDeepLink() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** QR image URL — no extra npm dependency. */
export function qrCodeImageUrl(text, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(text)}`;
}
