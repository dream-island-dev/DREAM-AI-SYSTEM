// Single source of truth for manager-facing bot_scripts labels (BotScriptEditor + ACC).
// FAIL VISIBLE: unknown script_key → "⚠ raw_key", never silent blank.

export const BOT_SCRIPT_FRIENDLY = {
  stage_3_morning:          "הודעת בוקר (שלב 3)",
  complaint_reply:          "מענה לתלונה",
  negative_feedback_reply:  "מענה למשוב שלילי",
  upsell_reply:             "הצעת שדרוג / מכירה",
  fallback_reply:           "מענה ברירת מחדל",
  greeting_reply:           "ברכת פתיחה — היי / שלום",
  positive_feedback_reply:  "מענה למשוב חיובי",
  upsell_accepted_reply:    "אישור קבלת שדרוג",
  upsell_decline_reply:     "סירוב לשדרוג",
  ongoing_concierge:        "שיח קונסיירג׳ שוטף",
  stage_2_arrival:          "הודעת הגעה (שלב 2)",
  callback_reply:           "מענה לבקשת חזרה טלפונית",
  spa_menu:                 "תפריט טיפולי ספא",
  stage_2_payment_reply:    "מענה לתשלום (שלב 2)",
  night_before_reminder:    "תזכורת ערב לפני — כניסה ושעות (שלב 2.5)",
  night_before_reminder_shabbat: "תזכורת ערב לפני — הגעה בשבת (שלב 2.5)",
  stage_3_morning_shabbat:  "בוקר הגעה — שבת (שלב 3)",
  pre_arrival_2d:           "פנייה ראשונה — אישור הגעה (שלב 1 — טקסט חופשי)",
  mid_stay:                 "בדיקת שלום באמצע השהות (שלב 4 — טקסט חופשי)",
  mid_stay_daypass:         "בדיקת שלום באמצע הביקור (שלב 4 — בילוי יומי)",
  checkout_fb:              "בקשת משוב לאחר העזיבה (שלב 5 — טקסט חופשי)",
  checkout_fb_daypass:      "בקשת משוב לאחר הביקור (שלב 5 — בילוי יומי)",
  night_before_daypass:     "תזכורת ערב לפני — בילוי יומי (שלב 2.5)",
  morning_daypass:          "בוקר הגעה — בילוי יומי (שלב 3)",
};

// Two mojibake modes seen in this DB so far: (1) literal '?' floods — a
// PowerShell pipe re-encoding Hebrew to a non-UTF-8 console codepage before
// it reaches Postgres; (2) U+FFFD replacement chars / repeated "Ã.." pairs —
// invalid UTF-8 bytes decoded as Latin-1/Windows-1252 somewhere in transit.
const MOJIBAKE_PAIR = /Ã./g;

/** True when DB text (title or body) was corrupted in transit — used for both display_name and message_text. */
export function isGarbledDbText(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (s.includes("�")) return true;
  const q = (s.match(/\?/g) || []).length;
  if (q >= 2 && q / s.length >= 0.25) return true;
  return (s.match(MOJIBAKE_PAIR) || []).length >= 3;
}

export function scriptKeyFriendly(key) {
  return BOT_SCRIPT_FRIENDLY[key] ?? `⚠ ${key}`;
}

/** Prefer DB display_name; fall back to friendly map when garbled or empty. */
export function resolveBotScriptDisplayName(scriptKey, dbDisplayName) {
  const db = String(dbDisplayName ?? "").trim();
  if (db && !isGarbledDbText(db)) return db;
  return scriptKeyFriendly(scriptKey);
}
