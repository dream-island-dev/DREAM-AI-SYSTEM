/**
 * dream_service_fallback — Meta UTILITY template for Whapi-outage / SOS.
 * Opens the 24h service window so guests can reach Dream Bot for room service.
 */

export const SERVICE_FALLBACK_TEMPLATE = "dream_service_fallback";

export const SERVICE_FALLBACK_BTN_REQUEST = "יש לי בקשה";
export const SERVICE_FALLBACK_BTN_OK = "הכל בסדר, תודה";

export const SERVICE_FALLBACK_REQUEST_ACK_HE =
  "בשמחה! כתבו לנו כאן מה תרצו — בקשות חדר, שירות או שאלה — ונטפל בהקדם 🌴";

export const SERVICE_FALLBACK_OK_ACK_HE =
  "שמחים לשמוע! אנחנו כאן אם תצטרכו משהו במהלך השהות 🌴";

const REQUEST_RE = /יש\s*לי\s*בקשה/i;
const OK_RE = /הכל\s*בסדר/i;

export function isServiceFallbackButtonReply(
  text: string | null | undefined,
  opts?: { buttonTitle?: string | null },
): "request" | "ok" | null {
  const btn = String(opts?.buttonTitle ?? "").trim();
  if (btn === SERVICE_FALLBACK_BTN_REQUEST || REQUEST_RE.test(btn)) return "request";
  if (btn === SERVICE_FALLBACK_BTN_OK || OK_RE.test(btn)) return "ok";
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (REQUEST_RE.test(t)) return "request";
  if (OK_RE.test(t)) return "ok";
  return null;
}
