// Inbox outbound error copy — timeout ≠ confirmed failure (FAIL VISIBLE, no duplicate resend).

const TIMEOUT_RE = /whapi_timeout|timeout_no_response/i;

/** True when whatsapp-send (or provider) reported unknown delivery. */
export function isInboxOutboundTimeout(data, rawMessage) {
  if (data?.status === "timeout") return true;
  const msg = rawMessage ?? data?.error ?? "";
  return TIMEOUT_RE.test(String(msg));
}

/**
 * Staff-facing Hebrew for failed/uncertain Inbox sends.
 * Timeout: instruct check-before-resend (duplicate risk). Hard fail: keep op label + detail.
 */
export function formatInboxOutboundError(data, fallbackMsg, { opLabel = "שגיאת שליחה" } = {}) {
  const raw = data?.error ?? fallbackMsg ?? "שגיאה לא ידועה";
  if (isInboxOutboundTimeout(data, raw)) {
    return "לא ודאי אם ההודעה הגיעה — בדקו בוואטסאפ של האורח לפני שליחה חוזרת (למנוע כפילות)";
  }
  return `${opLabel}: ${raw}`;
}
