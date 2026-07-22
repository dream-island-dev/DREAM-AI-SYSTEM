// supabase/functions/_shared/guestBotHandoff.ts
// Canonical staff-handoff copy + detection for Dream Bot (Meta) and Suites
// Whapi DM — one sentence, one detector, so Inbox red-dot logic never drifts.

/** Exact guest-facing sentence when the bot cannot resolve alone. */
export const GUEST_STAFF_HANDOFF_SENTENCE =
  "אני בודק את זה מול הצוות שלנו ונחזור אליך בהקדם 🙏";

/** Pre-2026-07-09 Meta copy — still matched so in-flight replies flag staff. */
export const LEGACY_META_HANDOFF_SENTENCE =
  "אני בודק את זה מול דלפק הקבלה, נציג אנושי יחזור אליך לכאן ברגעים אלו ממש.";

/**
 * Guest asked staff to call / get back to them — never invert to "please contact us".
 * Shared Tier-0 ack for Meta + Whapi (Approach 1, 2026-07-12).
 */
export const GUEST_CALLBACK_ACK_SENTENCE =
  "רשמתי, הצוות שלנו יחזור אליכם בהקדם כדי לתאם 🙏";

export type GuestHumanRequestType = "call" | "chat";

export type GuestHumanRequest = {
  requested: boolean;
  type: GuestHumanRequestType | null;
};

/** Phone / callback keywords → type = "call" */
const HUMAN_CALL_PATTERNS: RegExp[] = [
  /תחייגו|תצלצלו|תתקשרו/i,
  /מספר\s*טלפון/i,
  /תחזרו\s*אל(י|יי)/i,
  /תחזירו\s*אל(י|יי)/i,
  /שיחזרו\s*אל(י|יי)/i,
  /צרו\s*אית[יך]\s*קשר/i,
  /תיצרו\s*אית[יך]\s*קשר/i,
  /תתקשרו\s*אל(י|יי)/i,
  /לטלפן|לצלצל/i,
];

/** Human-agent (text/chat) keywords → type = "chat" */
const HUMAN_CHAT_PATTERNS: RegExp[] = [
  /נציג[ה]?/i,
  /מענה\s*אנושי/i,
  /לדבר\s*עם\s*מישהו/i,
  /אדם\s*אנושי|עם\s*אדם/i,
  /בן\s*אדם/i,
  /עם\s*בנ?[אוי]\s*אדם/i,
];

/** Generic "human" keyword — chat type (טלפון → call) */
const HUMAN_GENERAL_PATTERNS: RegExp[] = [
  /\bאנושי\b/i,
  /\bטלפון\b/i,
];

/**
 * Shared human-request detector for Meta + Whapi.
 * Flags Inbox red-dot AND drives Tier-0 deterministic reply (no LLM inventing
 * "please contact us" when the guest asked staff to call them back).
 */
export function detectGuestHumanRequest(text: string): GuestHumanRequest {
  const t = String(text ?? "");
  if (!t.trim()) return { requested: false, type: null };
  if (HUMAN_CALL_PATTERNS.some((p) => p.test(t))) return { requested: true, type: "call" };
  if (HUMAN_CHAT_PATTERNS.some((p) => p.test(t))) return { requested: true, type: "chat" };
  if (HUMAN_GENERAL_PATTERNS.some((p) => p.test(t))) {
    return { requested: true, type: /טלפון/.test(t) ? "call" : "chat" };
  }
  return { requested: false, type: null };
}

/** Canonical guest-facing ack for an explicit human/callback request. */
export function buildGuestHumanRequestReply(
  type: GuestHumanRequestType | null | undefined,
): string {
  return type === "call" ? GUEST_CALLBACK_ACK_SENTENCE : GUEST_STAFF_HANDOFF_SENTENCE;
}

/** True when the outbound text is (or contains) a staff handoff / callback promise. */
export function isGuestStaffHandoffReply(text: string): boolean {
  const t = text.trim();
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

const CALLBACK_INVERT_GUARD =
  `• אם האורח מבקש שיחזרו אליו / יתקשרו / נציג אנושי — Tier-0 כבר מטפל; לעולם אל תבקש/י ממנו "ליצור קשר" או להתקשר אלינו. אשר/י שהצוות יחזור אליו.`;

/**
 * Appended to Meta (Dream Bot) LLM context — full routing matrix including
 * log_guest_request for operational field ops vs handoff for human topics.
 */
export function buildMetaGuestRoutingGuidanceSuffix(): string {
  return `

══ ניווט בקשות (לא להציג לאורח) ══
• אם התשובה מופיעה במפורש בידע הריזורט או ב"פרטי האורח" — ענה/י בעצמך בלי להפנות לצוות.
• בקשה פיזית בחדר (מגבות, מזון לחדר, תקלה, ניקיון) → קרא ל-log_guest_request והשב במדויק: "${GUEST_STAFF_HANDOFF_SENTENCE}" (מסמן Inbox לנציג — לא פותח קריאת שטח אוטומטית).
• ספא, קבלה, כספים, שינוי תאריך/חדר, תלונה חמורה, או כל שאלה שלא בידע שלך → אל תמציא/י; השב במדויק: "${GUEST_STAFF_HANDOFF_SENTENCE}".
${CALLBACK_INVERT_GUARD}
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
• בקשה תפעולית בחדר (מגבות, תקלה, ניקיון, שער/דלת) או בקשה ללוח בקשות (ספא, מנהלות, עתידית) שלא ניתן לפתור מיד — אל תמציא/י פתרון; השב במדויק: "${GUEST_STAFF_HANDOFF_SENTENCE}" (הצוות יראה את השיחה ויטפל).
${CALLBACK_INVERT_GUARD}`;
}
