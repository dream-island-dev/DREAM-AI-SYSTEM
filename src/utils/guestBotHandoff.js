// Mirrors supabase/functions/_shared/guestBotHandoff.ts for Inbox UI backstop.

export const GUEST_STAFF_HANDOFF_SENTENCE =
  "אני בודק את זה מול הצוות שלנו ונחזור אליך בהקדם 🙏";

export const LEGACY_META_HANDOFF_SENTENCE =
  "אני בודק את זה מול דלפק הקבלה, נציג אנושי יחזור אליך לכאן ברגעים אלו ממש.";

export const GUEST_CALLBACK_ACK_SENTENCE =
  "רשמתי, הצוות שלנו יחזור אליכם בהקדם כדי לתאם 🙏";

/** True when outbound text is (or contains) staff handoff / callback promise. */
export function isGuestStaffHandoffReply(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (
    t.includes(GUEST_STAFF_HANDOFF_SENTENCE)
    || t.includes(LEGACY_META_HANDOFF_SENTENCE)
    || t.includes(GUEST_CALLBACK_ACK_SENTENCE)
  ) {
    return true;
  }
  return /בודק(?:ים)?\s+את\s+זה\s+מול\s+(?:הצוות|דלפק)/u.test(t)
    && /נחזור|יחזור|ברגעים/u.test(t);
}
