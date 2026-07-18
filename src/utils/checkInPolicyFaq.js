/**
 * Pure helpers mirrored from supabase/functions/_shared/automationSchedule.ts
 * for npm test coverage. Keep in sync when editing the Deno source.
 */

import {
  buildMealsItinerary,
  extractRestaurantMealHours,
  formatGuestMealsForAi,
  formatRestaurantKnowledgeForReply,
  getGuestDinnerSlot,
  retrieveMealKnowledgeLines,
} from "../data/stayMealsSchema";
import { formatGuestDietaryBrief } from "../data/guestProfileSchema";

export const CHECK_IN_POLICY_QUESTION_PATTERN =
  /(?:מה|מתי|איזו?\s*שעה|כמה|האם)\s+[\s\S]{0,60}?(?:צ.?ק.?אין|צ.?ק.?אא?וט|שעת?\s*(?:כניסה|עזיבה)|כניסה\s*(?:ל)?חדר|להיכנס\s*לחדר|הכנס\w*\s*לחדר|check.?in|check.?out)|שעות?\s*(?:ה)?כניסה|קבלת\s*חדר|מועד\s*כניסה|(?:אפשר|ניתן|מותר)\s+[\s\S]{0,40}?(?:להיכנס|כניסה|לחדר)|מתי\s+(?:מקבלים|נותנים|מוסרים)\s*(?:את\s*)?החדר|מה\s+שעות/i;

export const CHECK_IN_HOURS_REPLY_PATTERN =
  /שעות?\s*(?:ה)?כניסה|כניסה\s*ל(?:חדר|מתחם)|קבלת\s*חדר|ימי\s*חול|שבתות\s*וחגים|החל\s*מהשעה/i;

export function isCheckInPolicyQuestion(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return CHECK_IN_POLICY_QUESTION_PATTERN.test(t);
}

export function looksLikeCheckInHoursReply(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return CHECK_IN_HOURS_REPLY_PATTERN.test(t);
}

export function hasCompleteGuestMessageEnding(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/[.!?…🙏✅🥰🌸❤️💆🔑🌴✨🤍😊)\u201d\u2019"']$/u.test(t)) return true;
  if (/https?:\/\/\S+$/i.test(t)) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true;
  return false;
}

const TRUNCATED_REPLY_TAIL_PATTERN =
  /(?:^|[\s,])מה$|החל\s+מה$|ובשבתות\s+וחגים\s+החל\s+מה$|בימי\s+חול,?\s+ובשבתות\s+וחגים\s+החל\s+מה$|ובין$|בין\s+השעות?\s*$|שתצטר$/u;

export function endsWithMidWordHebrewCut(text) {
  const lastWord = String(text || "").trim().split(/\s+/).pop() ?? "";
  if (lastWord.length < 5 || lastWord.length > 10) return false;
  if (/[םןתהך]$/u.test(lastWord)) return false;
  if (/[וכ]$/u.test(lastWord) && lastWord.length >= 7) return false;
  return /[צקרפגדבשט]$/u.test(lastWord);
}

export function isReplyObviouslyTruncated(text) {
  const t = String(text || "").trim();
  if (!t || t.length < 25) return false;
  if (TRUNCATED_REPLY_TAIL_PATTERN.test(t)) return true;
  if (endsWithMidWordHebrewCut(t)) return true;
  return false;
}

export function buildCheckInPolicyReply(cfg = {}, _arrivalDateStr) {
  const entryTime = (cfg.night_before_entry_time_weekday || "").trim() || "12:00";
  const checkinWeekday =
    (cfg.night_before_checkin_time_weekday || "").trim()
    || (cfg.hotel_checkin_time || "").trim()
    || "15:00";
  const checkinShabbat =
    (cfg.night_before_checkin_time_shabbat || "").trim() || "18:00";
  const checkout = (cfg.hotel_checkout_time || "").trim() || "11:00";

  return (
    `שמח לעזור 🙏\n` +
    `כניסה למתחם: מהשעה ${entryTime} (כל יום).\n` +
    `קבלת חדר/סוויטה: ימי חול מהשעה ${checkinWeekday}, שבתות וחגים מהשעה ${checkinShabbat}.\n` +
    `צ'ק-אאוט: עד ${checkout}.\n\n` +
    `אם תרצו לנסות להיכנס לחדר לפני השעה הרשמית — נבדוק מול הצוות לפי תפוסה. פשוט כתבו לנו.`
  );
}

export const DINING_QUESTION_PATTERN =
  /(?:יש|פותח|פתוח|זמין)[\s\S]{0,50}?(?:אוכל|מסעדה|לאכול|ארוחה|ביס)|(?:שירות\s*חדרים|הזמין|להזמין|להזמנה)[\s\S]{0,40}?(?:חדר|אוכל|לחדר)|(?:מה|מתי|איזה?\s*שעה)[\s\S]{0,50}?(?:שעות|פתוח)[\s\S]{0,30}?(?:מסעדה|אוכל|ארוחה)|(?:מתי|מה\s*שעות?)\s*[\s\S]{0,25}?מסעדה|(?:אפשר|ניתן|מותר)[\s\S]{0,40}?(?:לאכול|להזמין|אוכל|ארוחה)|order\s*(?:food|to\s*room)|room\s*service|something\s*(?:to\s*)?eat|where\s*(?:can\s*)?(?:we\s*)?eat/i;

export const DINING_HOURS_REPLY_PATTERN =
  /שירות\s*חדרים|מסעדת?\s*ערמונים|שעות\s*(?:ה)?מסעדה|room\s*service/i;

export function isDiningQuestion(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return DINING_QUESTION_PATTERN.test(t);
}

export function looksLikeDiningHoursReply(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return DINING_HOURS_REPLY_PATTERN.test(t);
}

export const GUEST_OWN_MEAL_QUESTION_PATTERN =
  /(?:שלנו|שלי|אצלנו|בהזמנה(?:\s*(?:שלנו|שלי))?)|(?:מה|איזה|האם)\s*[\s\S]{0,35}?(?:פנסיון|חצי\s*פנסיון|פנסיון\s*מלא|ארוח(?:ה|ות)(?:\s*(?:שלנו|שלי|כלולות))?)|(?:מתי|באיזה\s*שעה)\s*[\s\S]{0,30}?(?:ארוחת\s*(?:בוקר|צהריים|ערב)|הבוקר|הערב)(?:\s*שלנו)?|(?:האם|יש\s*ל(?:נו|י))\s*[\s\S]{0,25}?(?:פנסיון|ארוח(?:ה|ות)\s*כלול)|(?:אלרג|צמחונ|טבעונ|ללא\s*גלוטן|לקטוז|תזונה|כשר)|what(?:'s| is)\s*(?:included|our)|our\s*(?:meal|breakfast|dinner|lunch|board|plan)/iu;

export function isGuestOwnMealQuestion(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return GUEST_OWN_MEAL_QUESTION_PATTERN.test(t);
}

function formatGuestMealSummaryLine(guest) {
  const mealSummary = formatGuestMealsForAi(guest);
  if (!mealSummary) return null;
  return mealSummary.replace(
    /^ארוחות \(לפי הפנסיון בהזמנה\):\s*/,
    "לפי הפנסיון שלכם: ",
  );
}

export function buildDiningReply(cfg = {}, guest = null, guestText = "", knowledgeBase = "") {
  const kb = knowledgeBase || "";
  const lines = [
    "שמח לעזור 🙏",
    formatRestaurantKnowledgeForReply(cfg, kb, guestText),
    "שירות חדרים זמין 24/7 — ניתן להזמין ישירות לסוויטה.",
    "לשמירת מקום במסעדה או להזמנה — כתבו לנו ונדאג.",
  ];

  const dinnerSlot = getGuestDinnerSlot(guest);
  const mentionsEvening = guestText && /ערב|אוכל|ארוחה|dinner|evening|מסעדה/i.test(guestText);
  if (dinnerSlot && mentionsEvening) {
    lines.splice(2, 0, `ארוחת הערב שלכם לפי ההזמנה: ${dinnerSlot}.`);
  }

  return lines.join("\n");
}

export function buildGuestOwnMealReply(cfg = {}, guest, guestText, knowledgeBase = "") {
  const t = String(guestText || "").trim();
  const kb = knowledgeBase || "";
  const lines = ["שמח לעזור 🙏"];
  const rows = buildMealsItinerary(guest);
  const byLabel = new Map(rows.map((r) => [r.label, r.value]));

  const asksDiet = /אלרג|צמחונ|טבעונ|גלוטן|לקטוז|תזונה|כשר|diet|allerg/i.test(t);
  const asksBreakfast = /בוקר|breakfast/i.test(t);
  const asksDinner = /ערב|dinner/i.test(t);
  const asksLunch = /צהריים|lunch/i.test(t);

  if (asksDiet) {
    const diet = formatGuestDietaryBrief(guest?.guest_profile ?? null);
    lines.push(
      diet
        ? `ברשומה שלכם: ${diet}. הצוות במסעדה מודע.`
        : "לא רשום אצלנו מגבלת תזונה — ספרו לנו ונדאג.",
    );
  }

  if (asksBreakfast) {
    const guestBreakfast = byLabel.get("ארוחת בוקר");
    if (guestBreakfast) {
      lines.push(`ארוחת הבוקר שלכם לפי ההזמנה: ${guestBreakfast}.`);
    } else {
      const breakfastKb = retrieveMealKnowledgeLines(kb, t, "breakfast");
      if (breakfastKb.length) {
        lines.push(breakfastKb.join("\n"));
      }
    }
  } else if (asksLunch) {
    const restaurantLunch = extractRestaurantMealHours(cfg, "lunch", kb, t);
    if (restaurantLunch) lines.push(`שעות ארוחת הצהריים במסעדה: ${restaurantLunch}.`);
    if (byLabel.has("ארוחת צהריים")) {
      lines.push(`לפי הפנסיון שלכם — שעת הארוחה: ${byLabel.get("ארוחת צהריים")}.`);
    }
  } else if (asksDinner) {
    const restaurantDinner = extractRestaurantMealHours(cfg, "dinner", kb, t);
    if (restaurantDinner) lines.push(`שעות ארוחת הערב במסעדה: ${restaurantDinner}.`);
    const guestDinner = byLabel.get("ארוחת ערב") ?? byLabel.get("ארוחה");
    if (guestDinner) lines.push(`לפי הפנסיון שלכם — שעת הארוחה: ${guestDinner}.`);
  }

  const summaryLine = formatGuestMealSummaryLine(guest);
  const answeredSlot = (asksBreakfast || asksLunch || asksDinner) && lines.length > 1;
  if (!answeredSlot && !asksDiet) {
    lines.push(
      summaryLine ?? "לא מצאנו פרטי פנסיון/ארוחות ברשומה — נבדוק מול הקבלה ונחזור אליכם.",
    );
  } else if (!answeredSlot && asksDiet && summaryLine) {
    lines.push(summaryLine);
  } else if (lines.length === 1) {
    lines.push(
      summaryLine ?? "לא מצאנו פרטי ארוחות ברשומה — נבדוק מול הקבלה ונחזור אליכם.",
    );
  }

  return lines.join("\n");
}

export function buildDiningReplyForGuest(cfg = {}, guestText = "", guest = null, knowledgeBase = "") {
  const kb = knowledgeBase || "";
  if (guest && isGuestOwnMealQuestion(guestText)) {
    return buildGuestOwnMealReply(cfg, guest, guestText, kb);
  }
  return buildDiningReply(cfg, guest, guestText, kb);
}

export function resolveTruncatedReplyFallback(
  replyText,
  guestText,
  cfg,
  arrivalDateStr,
  genericFallback,
  guest = null,
  knowledgeBase = "",
) {
  const kb = knowledgeBase || "";
  if (isDiningQuestion(guestText)) {
    return buildDiningReplyForGuest(cfg, guestText, guest, kb);
  }
  if (isCheckInPolicyQuestion(guestText)) {
    return buildCheckInPolicyReply(cfg, arrivalDateStr);
  }
  if (looksLikeDiningHoursReply(replyText)) {
    return buildDiningReplyForGuest(cfg, guestText, guest, kb);
  }
  if (looksLikeCheckInHoursReply(replyText)) {
    return buildCheckInPolicyReply(cfg, arrivalDateStr);
  }
  return genericFallback;
}
