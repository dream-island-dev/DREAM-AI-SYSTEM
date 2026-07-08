/**
 * Pure helpers mirrored from supabase/functions/_shared/automationSchedule.ts
 * for npm test coverage. Keep in sync when editing the Deno source.
 */

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

export function isReplyObviouslyTruncated(text) {
  const t = String(text || "").trim();
  if (!t || t.length < 25) return false;
  if (/(?:^|[\s,])מה$|החל\s+מה$|ובשבתות\s+וחגים\s+החל\s+מה$|בימי\s+חול,?\s+ובשבתות\s+וחגים\s+החל\s+מה$/u.test(t)) {
    return true;
  }
  if (t.length > 70 && !hasCompleteGuestMessageEnding(t)) return true;
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

export function resolveTruncatedReplyFallback(
  replyText,
  guestText,
  cfg,
  arrivalDateStr,
  genericFallback,
) {
  if (isCheckInPolicyQuestion(guestText) || looksLikeCheckInHoursReply(replyText)) {
    return buildCheckInPolicyReply(cfg, arrivalDateStr);
  }
  return genericFallback;
}
