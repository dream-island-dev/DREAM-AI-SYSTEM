// Single source of truth for manager-facing bot_scripts labels (BotScriptEditor + ACC).
// FAIL VISIBLE: unknown script_key → "⚠ raw_key", never silent blank.

export const BOT_SCRIPT_FRIENDLY = {
  stage_3_morning:          "הודעת בוקר (שלב 3)",
  complaint_reply:          "מענה לתלונה",
  negative_feedback_reply:  "מענה למשוב שלילי",
  upsell_reply:             "הצעת שדרוג (Upsell)",
  fallback_reply:           "מענה ברירת מחדל (Fallback)",
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

/** True when DB label was corrupted (e.g. migration SQL piped without UTF-8 on Windows). */
export function isGarbledDbLabel(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  const q = (s.match(/\?/g) || []).length;
  return q >= 2 && q / s.length >= 0.25;
}

export function scriptKeyFriendly(key) {
  return BOT_SCRIPT_FRIENDLY[key] ?? `⚠ ${key}`;
}

/** Prefer DB display_name; fall back to friendly map when garbled or empty. */
export function resolveBotScriptDisplayName(scriptKey, dbDisplayName) {
  const db = String(dbDisplayName ?? "").trim();
  if (db && !isGarbledDbLabel(db)) return db;
  return scriptKeyFriendly(scriptKey);
}
