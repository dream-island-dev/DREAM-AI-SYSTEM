/**
 * Guest Club UI labels — Deno mirror of src/utils/guestClubUi.js
 * Keep fields in sync when editing copy defaults.
 */

export const BOT_CONFIG_CLUB_UI_KEY = "guest_club_ui";

export const DEFAULT_GUEST_CLUB_UI = {
  title: "🌴 מועדון לקוחות Dream Island",
  body: "רוצים לקבל הצעות בלעדיות, הטבות לימי הולדת ואירועים מיוחדים במתחם?",
  benefits_hint: "מלאו תאריכים מיוחדים וקבלו הטבות ליום הולדת, יום נישואין ועוד 🎁",
  profile_step_title: "פרטים להטבות אישיות",
  guest_birthday_label: "תאריך לידה שלכם",
  guest_birthday_hint: "חובה להצטרפות — לקבלת הטבות ביום ההולדת",
  partner_toggle_label: "יש לי בן/בת זוג",
  partner_birthday_label: "תאריך לידה של בן/בת הזוג",
  anniversary_label: "יום נישואין",
  optional_suffix: "(לא חובה)",
  consent_line:
    "בלחיצה על «הצטרפות» אתם מאשרים לקבל הודעות שיווק והטבות ב-WhatsApp מ-Dream Island. ניתן לבטל בכל עת.",
  join_label: "כן, אני רוצה ✨",
  continue_label: "המשך להצטרפות ✨",
  submit_profile_label: "הצטרפות למועדון 🎁",
  decline_label: "לא תודה",
  joined_confirm: "אתם במועדון — נעדכן בהצעות והטבות בלעדיות ✨",
  wa_review_hint: "נשלחה אליכם גם הודעה בוואטסאפ עם קישור לביקורת בגוגל ⭐",
};

function trimLabel(raw: unknown, fallback: string): string {
  const t = String(raw ?? "").trim();
  return t || fallback;
}

export type GuestClubUi = {
  title: string;
  body: string;
  benefits_hint: string;
  profile_step_title: string;
  guest_birthday_label: string;
  guest_birthday_hint: string;
  partner_toggle_label: string;
  partner_birthday_label: string;
  anniversary_label: string;
  optional_suffix: string;
  consent_line: string;
  join_label: string;
  continue_label: string;
  submit_profile_label: string;
  decline_label: string;
  joined_confirm: string;
  wa_review_hint: string;
};

export function normalizeGuestClubUi(raw: unknown): GuestClubUi {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_GUEST_CLUB_UI };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_GUEST_CLUB_UI };
  }
  const obj = parsed as Record<string, unknown>;
  return {
    title: trimLabel(obj.title, DEFAULT_GUEST_CLUB_UI.title),
    body: trimLabel(obj.body, DEFAULT_GUEST_CLUB_UI.body),
    benefits_hint: trimLabel(obj.benefits_hint, DEFAULT_GUEST_CLUB_UI.benefits_hint),
    profile_step_title: trimLabel(obj.profile_step_title, DEFAULT_GUEST_CLUB_UI.profile_step_title),
    guest_birthday_label: trimLabel(obj.guest_birthday_label, DEFAULT_GUEST_CLUB_UI.guest_birthday_label),
    guest_birthday_hint: trimLabel(obj.guest_birthday_hint, DEFAULT_GUEST_CLUB_UI.guest_birthday_hint),
    partner_toggle_label: trimLabel(obj.partner_toggle_label, DEFAULT_GUEST_CLUB_UI.partner_toggle_label),
    partner_birthday_label: trimLabel(obj.partner_birthday_label, DEFAULT_GUEST_CLUB_UI.partner_birthday_label),
    anniversary_label: trimLabel(obj.anniversary_label, DEFAULT_GUEST_CLUB_UI.anniversary_label),
    optional_suffix: trimLabel(obj.optional_suffix, DEFAULT_GUEST_CLUB_UI.optional_suffix),
    consent_line: trimLabel(obj.consent_line, DEFAULT_GUEST_CLUB_UI.consent_line),
    join_label: trimLabel(obj.join_label, DEFAULT_GUEST_CLUB_UI.join_label),
    continue_label: trimLabel(obj.continue_label, DEFAULT_GUEST_CLUB_UI.continue_label),
    submit_profile_label: trimLabel(obj.submit_profile_label, DEFAULT_GUEST_CLUB_UI.submit_profile_label),
    decline_label: trimLabel(obj.decline_label, DEFAULT_GUEST_CLUB_UI.decline_label),
    joined_confirm: trimLabel(obj.joined_confirm, DEFAULT_GUEST_CLUB_UI.joined_confirm),
    wa_review_hint: trimLabel(obj.wa_review_hint, DEFAULT_GUEST_CLUB_UI.wa_review_hint),
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse optional portal date field (YYYY-MM-DD). Returns null if empty/invalid. */
export function parseOptionalClubDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  if (!s || !ISO_DATE_RE.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/** Required birthday on join — must be valid ISO date. */
export function parseRequiredClubBirthday(raw: unknown): string | null {
  return parseOptionalClubDate(raw);
}
