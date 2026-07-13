// src/utils/guestClubUi.js
// Guest Club opt-in copy — shared by Guest Portal thank-you + staff
// preview/editor (Feedback → Surveys). Stored in bot_config.guest_club_ui.

export const BOT_CONFIG_CLUB_UI_KEY = "guest_club_ui";

export const DEFAULT_GUEST_CLUB_UI = Object.freeze({
  title: "🌴 מועדון לקוחות Dream Island",
  body: "רוצים לקבל הצעות בלעדיות לאירועים וסדנאות מיוחדים במתחם?",
  join_label: "כן, אני רוצה ✨",
  decline_label: "לא תודה",
  joined_confirm: "אתם במועדון — נעדכן בהצעות בלעדיות ✨",
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
    join_label: trimLabel(parsed.join_label, DEFAULT_GUEST_CLUB_UI.join_label),
    decline_label: trimLabel(parsed.decline_label, DEFAULT_GUEST_CLUB_UI.decline_label),
    joined_confirm: trimLabel(parsed.joined_confirm, DEFAULT_GUEST_CLUB_UI.joined_confirm),
  };
}

export function serializeGuestClubUi(ui) {
  const n = normalizeGuestClubUi(ui);
  return JSON.stringify(n);
}

export function cloneDefaultClubUi() {
  return plainDefaultClubUi();
}
