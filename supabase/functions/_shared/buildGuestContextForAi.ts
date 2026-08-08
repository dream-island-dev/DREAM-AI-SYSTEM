// supabase/functions/_shared/buildGuestContextForAi.ts
// Single guest-awareness context line for Meta + Whapi LLM prompts.

import {
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
} from "./suiteNames.ts";
import { formatGuestProfileForAi } from "./guestProfile.ts";
import { formatSpaScheduleDisplay } from "./spaSchedule.ts";
import { formatDoc1SpaSlotsForAi } from "./doc1SpaSlots.ts";
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
    // FAIL VISIBLE (2026-08-08): arrival date has passed but the guest never
    // actually reached checked_in (housekeeping check-in signal missed/never
    // sent) — must not claim "בתוך השהות" (in-house) to the LLM, or it will
    // talk to the guest as if they're already at the resort. Reuses the same
    // isCheckedIn the room-number gate below already relies on, so the two
    // can no longer disagree with each other.
    else if (isCheckedIn) stage = "בתוך השהות";
    else stage = "הגעה עברה — טרם נקלט צ'ק-אין בפועל (אל תניח שהאורח כבר בחדר או בריזורט)";
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
  } else if (room && !isEffectiveDayPassGuest(guest)) {
    parts.push(
      "חדר: ייחשף בצ'ק-אין — לפני אז אסור לחשוף/להמציא שם חדר ספציפי, רק לציין שזו סוויטת יוקרה",
    );
  }
  if (isEffectiveSuiteGuest(guest)) parts.push("סוג: סוויטה");
  else if (isEffectiveDayPassGuest(guest)) parts.push("סוג: בילוי יומי");
  if (status) parts.push(`סטטוס: ${status}`);
  if (confirmed) parts.push("אישר הגעה: כן");
  const profileSpa = (guest.guest_profile as Record<string, unknown> | null)?.spa as Record<string, unknown> | undefined;
  const doc1Slots = Array.isArray(profileSpa?.doc1_slots)
    ? (profileSpa.doc1_slots as Array<{ time?: string; count?: number }>)
    : null;
  const multiSpaLine = formatDoc1SpaSlotsForAi(
    doc1Slots,
    spaDate,
    spaTime,
    typeof guest.treatment_count === "number" ? guest.treatment_count : null,
  );
  if (multiSpaLine) {
    parts.push(`טיפולי ספא: ${multiSpaLine}`);
  } else if (spaTime || spaDate) {
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
