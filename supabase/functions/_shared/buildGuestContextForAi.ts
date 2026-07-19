// supabase/functions/_shared/buildGuestContextForAi.ts
// Single guest-awareness context line for Meta + Whapi LLM prompts.

import { formatGuestProfileForAi } from "./guestProfile.ts";
import { formatSpaScheduleDisplay } from "./spaSchedule.ts";
import { formatGuestMealsForAi } from "./stayMeals.ts";
import { formatIsraelClockLabel, getIsraelTimeGreeting } from "./guestTimeGreeting.ts";

const PORTAL_SPA_ATTENTION_REASON = "בקשת טיפול בספא";

export function isPendingPortalSpaRequest(guest: Record<string, unknown> | null): boolean {
  if (!guest || guest.requires_attention !== true) return false;
  const reason = String(guest.attention_reason ?? "").trim();
  return reason === PORTAL_SPA_ATTENTION_REASON || /טיפול בספא/.test(reason);
}

export const PENDING_PORTAL_SPA_LLM_SUFFIX = [
  "חשוב — בקשת ספא פעילה מהפורטל האישי: הצוות כבר קיבל את הבקשה.",
  "אל תשלח קישורי הזמנת ספא, תפריט ספא, או אישורי תור.",
  "אם האורח שואל על הספא, ציין בקצרה שהבקשה אצל הצוות ושאפשר להתקשר ל-08-6705600.",
  "אל תפתח תהליך הזמנה חדש.",
].join(" ");

export type GuestContextHistoryTurn = { direction: string; message: string };

export type BuildGuestContextOpts = {
  forceInHouse?: boolean;
};

/**
 * Builds the "פרטי האורח הנוכחי" line injected into both channel brains.
 * Meta and Whapi must stay in sync — one function, one shape.
 */
export function buildGuestContextForAi(
  guest: Record<string, unknown> | null,
  conversationHistory: GuestContextHistoryTurn[] = [],
  opts?: BuildGuestContextOpts,
): string {
  if (!guest) return "";

  const today = new Date().toISOString().split("T")[0];
  const arrDate = guest.arrival_date as string | null;
  const depDate = guest.departure_date as string | null;
  const room = guest.room as string | null;
  const roomType = guest.room_type as string | null;
  const status = guest.status as string | null;
  const name = guest.name as string | null;
  const confirmed = guest.arrival_confirmed as boolean | null;
  const spaTime = guest.spa_time as string | null;
  const spaDate = guest.spa_date as string | null;
  const forceInHouse = opts?.forceInHouse === true;
  const isCheckedIn = forceInHouse || status === "checked_in";

  let stage = "";
  if (forceInHouse) {
    stage = "בתוך השהות — האורח בחדר (זוהה לפי בקשת חדר/שירות)";
  } else if (arrDate) {
    if (arrDate > today) stage = "טרם הגעה";
    else if (arrDate === today) stage = "יום הגעה — האורח מגיע היום";
    else stage = "בתוך השהות";
  }

  const hasStage2 = conversationHistory.some(
    (h) => h.direction === "outbound" && h.message.includes("איזה כיף"),
  );
  const hasStage3 = conversationHistory.some(
    (h) => h.direction === "outbound" && h.message.includes("בוקר אור"),
  );

  const parts: string[] = [];
  parts.push(`שעה בישראל: ${formatIsraelClockLabel()} | ברכת זמן מתאימה: ${getIsraelTimeGreeting()}`);
  if (name?.trim()) parts.push(`שם: ${name.trim()}`);
  if (stage) parts.push(`שלב האורח: ${stage}`);
  if (arrDate) parts.push(`תאריך הגעה: ${arrDate}`);
  if (depDate) parts.push(`תאריך עזיבה: ${depDate}`);
  if (room && isCheckedIn) {
    parts.push(`חדר: ${room}`);
  } else if (room) {
    parts.push(
      "חדר: ייחשף בצ'ק-אין — לפני אז אסור לחשוף/להמציא שם חדר ספציפי, רק לציין שזו סוויטת יוקרה",
    );
  }
  if (roomType === "suite") parts.push("סוג: סוויטה");
  if (status) parts.push(`סטטוס: ${status}`);
  if (confirmed) parts.push("אישר הגעה: כן");
  if (spaTime || spaDate) {
    const sched = formatSpaScheduleDisplay(spaDate, spaTime);
    if (sched) parts.push(`טיפול ספא: ${sched}`);
  }
  if (isPendingPortalSpaRequest(guest)) {
    parts.push("בקשת טיפול ספא מהפורטל — ממתין לטיפול צוות (לא לשלוח קישורי הזמנה)");
  }
  if (hasStage2) parts.push("כבר קיבל הודעת אישור+ספא");
  if (hasStage3) parts.push("כבר קיבל הודעת בוקר הגעה");

  const mealsLine = formatGuestMealsForAi({
    meal_plan: guest.meal_plan as string | null,
    meal_location: guest.meal_location as string | null,
    meal_time: guest.meal_time as string | null,
    breakfast_time: guest.breakfast_time as string | null,
    lunch_time: guest.lunch_time as string | null,
    dinner_time: guest.dinner_time as string | null,
  });
  if (mealsLine) parts.push(mealsLine);

  const profileLine = formatGuestProfileForAi(
    guest.guest_profile as Record<string, unknown> | null,
    guest.arrival_time as string | null,
  );
  if (profileLine) parts.push(profileLine);

  return parts.length > 0 ? parts.join(" | ") : "";
}

/** Wraps buildGuestContextForAi for assembleGuestBrainPrompt's guestContextLine opt. */
export function formatGuestContextLine(
  guest: Record<string, unknown> | null,
  conversationHistory: GuestContextHistoryTurn[] = [],
  opts?: BuildGuestContextOpts,
): string {
  const inner = buildGuestContextForAi(guest, conversationHistory, opts);
  return inner ? `\n\nפרטי האורח הנוכחי: ${inner}` : "";
}
