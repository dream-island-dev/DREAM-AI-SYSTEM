// Inbox outbound error copy — timeout ≠ confirmed failure (FAIL VISIBLE, no duplicate resend).

const TIMEOUT_RE = /whapi_timeout|timeout_no_response/i;
const WINDOW_CLOSED_RE = /window_closed/i;

/** True when staff picked Meta but the Meta 24h session is closed. */
export function shouldWarnMetaWindowClosed(contact, outboundCh) {
  return outboundCh === "meta" && !isMetaSessionWindowOpenForContact(contact);
}

/** Staff-facing copy when Meta 24h session window is closed. */
export const META_WINDOW_CLOSED_WHAPI_HINT =
  "אין חלון 24 שעות פעיל עם האורח ב-Dream Bot — לשליחת הודעה חופשית בחר «מכשיר הסוויטות» למעלה.";

export const META_WINDOW_CLOSED_WHAPI_AVAILABLE_HINT =
  "חלון Dream Bot סגור — האורח כתב דרך מכשיר הסוויטות. לשליחה חופשית בחר «מכשיר הסוויטות» למעלה.";

export const META_WINDOW_CLOSED_SOS_HINT =
  "אין חלון 24 שעות פעיל עם האורח ב-Dream Bot — שליחה חופשית דרך Meta חסומה. השתמש בתבנית Meta מאושרת.";

export function resolveMetaWindowClosedHint({
  whapiSosActive = false,
  whapiSessionOpen = false,
} = {}) {
  if (whapiSosActive) return META_WINDOW_CLOSED_SOS_HINT;
  if (whapiSessionOpen) return META_WINDOW_CLOSED_WHAPI_AVAILABLE_HINT;
  return META_WINDOW_CLOSED_WHAPI_HINT;
}

function lastInboundOnChannel(contact, channel) {
  if (!contact?.messages?.length) return null;
  let lastAt = null;
  for (const m of contact.messages) {
    if (m.direction !== "inbound" || !m.created_at) continue;
    const ch = m.inbox_channel === "whapi" || m.channel === "whapi" ? "whapi" : "meta";
    if (ch !== channel) continue;
    if (!lastAt || m.created_at > lastAt) lastAt = m.created_at;
  }
  return lastAt;
}

/** Meta session open = last inbound on Dream Bot (meta) channel within 24h. */
export function isMetaSessionWindowOpenForContact(contact) {
  const lastMetaInboundAt = lastInboundOnChannel(contact, "meta");
  if (!lastMetaInboundAt) return false;
  const ts = new Date(lastMetaInboundAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts < 24 * 3600 * 1000;
}

/** Whapi session open = last inbound on Suites device within 24h (no Meta template needed). */
export function isWhapiSessionWindowOpenForContact(contact) {
  const lastWhapiInboundAt = lastInboundOnChannel(contact, "whapi");
  if (!lastWhapiInboundAt) return false;
  const ts = new Date(lastWhapiInboundAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts < 24 * 3600 * 1000;
}

/** True when whatsapp-send (or provider) reported unknown delivery. */
export function isInboxOutboundTimeout(data, rawMessage) {
  if (data?.status === "timeout") return true;
  const msg = rawMessage ?? data?.error ?? "";
  return TIMEOUT_RE.test(String(msg));
}

export function isInboxWindowClosed(data, rawMessage) {
  if (data?.status === "window_closed") return true;
  const msg = rawMessage ?? data?.error ?? "";
  return WINDOW_CLOSED_RE.test(String(msg));
}

/**
 * Staff-facing Hebrew for failed/uncertain Inbox sends.
 * Timeout: instruct check-before-resend (duplicate risk). Hard fail: keep op label + detail.
 */
export function formatInboxOutboundError(data, fallbackMsg, { opLabel = "שגיאת שליחה", whapiSosActive = false } = {}) {
  const raw = data?.error ?? fallbackMsg ?? "שגיאה לא ידועה";
  if (isInboxWindowClosed(data, raw)) {
    return resolveMetaWindowClosedHint({ whapiSosActive });
  }
  if (isInboxOutboundTimeout(data, raw)) {
    return "לא ודאי אם ההודעה הגיעה — בדקו בוואטסאפ של האורח לפני שליחה חוזרת (למנוע כפילות)";
  }
  return `${opLabel}: ${raw}`;
}
