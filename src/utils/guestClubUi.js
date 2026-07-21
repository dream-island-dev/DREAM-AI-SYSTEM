// src/utils/guestClubUi.js
// Guest Club opt-in copy — shared by Guest Portal thank-you + staff
// preview/editor (Feedback → Surveys). Stored in bot_config.guest_club_ui.

export const BOT_CONFIG_CLUB_UI_KEY = "guest_club_ui";

export const DEFAULT_GUEST_CLUB_UI = Object.freeze({
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
});

function trimLabel(raw, fallback) {
  const t = String(raw ?? "").trim();
  return t || fallback;
}

function plainDefaultClubUi() {
  return { ...DEFAULT_GUEST_CLUB_UI };
}

/** Merge raw bot_config JSON onto defaults. */
export function normalizeGuestClubUi(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return plainDefaultClubUi();
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return plainDefaultClubUi();
  }
  return {
    title: trimLabel(parsed.title, DEFAULT_GUEST_CLUB_UI.title),
    body: trimLabel(parsed.body, DEFAULT_GUEST_CLUB_UI.body),
    benefits_hint: trimLabel(parsed.benefits_hint, DEFAULT_GUEST_CLUB_UI.benefits_hint),
    profile_step_title: trimLabel(parsed.profile_step_title, DEFAULT_GUEST_CLUB_UI.profile_step_title),
    guest_birthday_label: trimLabel(parsed.guest_birthday_label, DEFAULT_GUEST_CLUB_UI.guest_birthday_label),
    guest_birthday_hint: trimLabel(parsed.guest_birthday_hint, DEFAULT_GUEST_CLUB_UI.guest_birthday_hint),
    partner_toggle_label: trimLabel(parsed.partner_toggle_label, DEFAULT_GUEST_CLUB_UI.partner_toggle_label),
    partner_birthday_label: trimLabel(parsed.partner_birthday_label, DEFAULT_GUEST_CLUB_UI.partner_birthday_label),
    anniversary_label: trimLabel(parsed.anniversary_label, DEFAULT_GUEST_CLUB_UI.anniversary_label),
    optional_suffix: trimLabel(parsed.optional_suffix, DEFAULT_GUEST_CLUB_UI.optional_suffix),
    consent_line: trimLabel(parsed.consent_line, DEFAULT_GUEST_CLUB_UI.consent_line),
    join_label: trimLabel(parsed.join_label, DEFAULT_GUEST_CLUB_UI.join_label),
    continue_label: trimLabel(parsed.continue_label, DEFAULT_GUEST_CLUB_UI.continue_label),
    submit_profile_label: trimLabel(parsed.submit_profile_label, DEFAULT_GUEST_CLUB_UI.submit_profile_label),
    decline_label: trimLabel(parsed.decline_label, DEFAULT_GUEST_CLUB_UI.decline_label),
    joined_confirm: trimLabel(parsed.joined_confirm, DEFAULT_GUEST_CLUB_UI.joined_confirm),
    wa_review_hint: trimLabel(parsed.wa_review_hint, DEFAULT_GUEST_CLUB_UI.wa_review_hint),
  };
}

export function serializeGuestClubUi(ui) {
  const n = normalizeGuestClubUi(ui);
  return JSON.stringify(n);
}

export function cloneDefaultClubUi() {
  return plainDefaultClubUi();
}
