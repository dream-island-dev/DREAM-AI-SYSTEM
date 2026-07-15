// supabase/functions/_shared/frontDeskOnboarding.ts
// One-time capabilities guide for Adir — sent once before the daily morning brief.

import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import {
  composeFromStaffTemplate,
  STAFF_TEMPLATE_KEYS,
  type StaffTemplateMap,
} from "./staffNotifyTemplates.ts";

export const FRONT_DESK_ONBOARDING_CONFIG_KEY = "front_desk_onboarding_sent";

/** Full Hebrew guide — deterministic, no LLM. */
export function buildFrontDeskCapabilitiesOnboardingMessage(
  templates?: StaffTemplateMap,
): string {
  const fromDb = composeFromStaffTemplate(templates, STAFF_TEMPLATE_KEYS.ADIR_ONBOARDING, {
    requests_board_link: buildStaffAppDeepLink({ page: "requests_board" }),
    inbox_link: buildStaffAppDeepLink({ page: "wa_inbox" }),
  });
  if (fromDb) return fromDb;

  return [
    "אדיר, בוקר טוב 🌅",
    "",
    "זו הודעה חד-פעמית — מדריך מלא לעוזרת דלפק הסוויטות שלך.",
    "מעכשיו, כל בוקר תקבל רק את סיכום ההגעות והבקשות.",
    "אם משהו לא ברור — פשוט תשאל אותי.",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "📱 איך מדברים איתי?",
    "━━━━━━━━━━━━━━━━━━━━",
    "שלח הודעה קולית או טקסט למכשיר הסוויטות (Whapi).",
    "אני עונה בעברית ומבצעת פעולות אמיתיות במערכת.",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "🔔 מה מגיע אליך אוטומטית",
    "━━━━━━━━━━━━━━━━━━━━",
    "• בוקר — סיכום הגעות היום/מחר + בקשות פתוחות",
    "• שעת הגעה — כשאורח מדווח (Dream Bot / מכשיר סוויטות)",
    "• התראות — בקשות שלא טופלו, אורח שמחכה, הזמנות מהפורטל, מלאי",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "🕐 הגעות (עד ~16:00)",
    "━━━━━━━━━━━━━━━━━━━━",
    "«לוח הגעות» / «מי מגיע היום?»",
    "«מי בלי שעת הגעה?»",
    "«מי מגיע מחר?»",
    "«תשלחי לבקש שעות» — רק אחרי שאתה מאשר «כן»",
    "«חדר 5 מוכן» — מעדכנת + שולחת לאורח",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "📋 בקשות אורחים",
    "━━━━━━━━━━━━━━━━━━━━",
    "«מה פתוח לי?» / «יש בקשות?»",
    "«טיפלתי בבקשת חדר 7» — מסמנת כטופל",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "👤 מידע על אורח / תפעול",
    "━━━━━━━━━━━━━━━━━━━━",
    "«מי בחדר אמטיסט 5?» | «מי בריזורט?»",
    "«פתחי משימה — מגבות לחדר 8»",
    "«מה פתוח בתחזוקה?»",
    "«שלחי לאורח בחדר 7: ...»",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "🧠 למידה והסלמה",
    "━━━━━━━━━━━━━━━━━━━━",
    "«תזכרי שתמיד תציגי VIP ראשון»",
    "פיצוי / VIP מורכב → «תעדכני את אליעד — ...»",
    "",
    "⛔ אין צ'ק-אין/ביטול/שינוי תאריכים — רק במסך הניהול.",
    "",
    `📋 לוח בקשות: ${buildStaffAppDeepLink({ page: "requests_board" })}`,
    `💬 אינבוקס: ${buildStaffAppDeepLink({ page: "wa_inbox" })}`,
    "",
    "מוכנה. מה תרצה לבדוק קודם? 🙏",
  ].join("\n");
}
