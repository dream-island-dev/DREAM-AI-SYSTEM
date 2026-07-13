/**
 * Guest Club UI labels — Deno mirror of src/utils/guestClubUi.js
 * Keep fields in sync when editing copy defaults.
 */

export const BOT_CONFIG_CLUB_UI_KEY = "guest_club_ui";

export const DEFAULT_GUEST_CLUB_UI = {
  title: "🌴 מועדון לקוחות Dream Island",
  body: "רוצים לקבל הצעות בלעדיות לאירועים וסדנאות מיוחדים במתחם?",
  join_label: "כן, אני רוצה ✨",
  decline_label: "לא תודה",
  joined_confirm: "אתם במועדון — נעדכן בהצעות בלעדיות ✨",
};

function trimLabel(raw: unknown, fallback: string): string {
  const t = String(raw ?? "").trim();
  return t || fallback;
}

export type GuestClubUi = {
  title: string;
  body: string;
  join_label: string;
  decline_label: string;
  joined_confirm: string;
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
    join_label: trimLabel(obj.join_label, DEFAULT_GUEST_CLUB_UI.join_label),
    decline_label: trimLabel(obj.decline_label, DEFAULT_GUEST_CLUB_UI.decline_label),
    joined_confirm: trimLabel(obj.joined_confirm, DEFAULT_GUEST_CLUB_UI.joined_confirm),
  };
}
