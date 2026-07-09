// supabase/functions/_shared/guestBotHandoff.ts
// Canonical staff-handoff copy + detection for Dream Bot (Meta) and Suites
// Whapi DM — one sentence, one detector, so Inbox red-dot logic never drifts.

/** Exact guest-facing sentence when the bot cannot resolve alone. */
export const GUEST_STAFF_HANDOFF_SENTENCE =
  "אני בודק את זה מול הצוות שלנו ונחזור אליך בהקדם 🙏";

/** Pre-2026-07-09 Meta copy — still matched so in-flight replies flag staff. */
export const LEGACY_META_HANDOFF_SENTENCE =
  "אני בודק את זה מול דלפק הקבלה, נציג אנושי יחזור אליך לכאן ברגעים אלו ממש.";

/** True when the outbound text is (or contains) a staff handoff promise. */
export function isGuestStaffHandoffReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.includes(GUEST_STAFF_HANDOFF_SENTENCE) || t.includes(LEGACY_META_HANDOFF_SENTENCE)) {
    return true;
  }
  return /בודק(?:ים)?\s+את\s+זה\s+מול\s+(?:הצוות|דלפק)/u.test(t)
    && /נחזור|יחזור|ברגעים/u.test(t);
}

/**
 * Appended to Meta (Dream Bot) LLM context — full routing matrix including
 * log_guest_request for operational field ops vs handoff for human topics.
 */
export function buildMetaGuestRoutingGuidanceSuffix(): string {
  return `

══ ניווט בקשות (לא להציג לאורח) ══
• אם התשובה מופיעה במפורש בידע הריזורט או ב"פרטי האורח" — ענה/י בעצמך בלי להפנות לצוות.
• בקשה פיזית בחדר (מגבות, מזון לחדר, תקלה, ניקיון) → קרא ל-log_guest_request (לוח תפעול / קריאות שטח).
• ספא, קבלה, כספים, שינוי תאריך/חדר, תלונה חמורה, או כל שאלה שלא בידע שלך → אל תמציא/י; השב במדויק: "${GUEST_STAFF_HANDOFF_SENTENCE}".
• אם אין פרופיל אורח ב"פרטי האורח" (מספר לא מזוהה) — עדיין ענה/י בנימוס; לשאלה שדורשת אדם השתמש/י במשפט ההפניה למעלה.`;
}

/**
 * Appended to Whapi Suites-device DM LLM context — guest profile is always
 * present when auto-reply runs (shouldAutoReplyGuestWhapiDm gate); no
 * log_guest_request tool on this channel — operational asks → handoff + staff flag.
 */
export function buildWhapiGuestRoutingGuidanceSuffix(): string {
  return `

══ ניווט בקשות — ערוץ מכשיר הסוויטות (לא להציג לאורח) ══
• בשיחה זו יש תמיד פרופיל אורח פעיל — השתמש/י בפרטי האורח שצורפו.
• אם התשובה בידע הריזורט או בפרטי האורח — ענה/י בעצמך.
• בקשה תפעולית בחדר (מגבות, תקלה, ניקיון, שער/דלת) או בקשה ללוח בקשות (ספא, מנהלות, עתידית) שלא ניתן לפתור מיד — אל תמציא/י פתרון; השב במדויק: "${GUEST_STAFF_HANDOFF_SENTENCE}" (הצוות יראה את השיחה ויטפל).`;
}
