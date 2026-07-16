// Guest Experience Survey — portal read/write eligibility (day-pass+spa + suite post-checkout).

import { isEffectiveSuiteGuest } from "./suiteNames.ts";

export type GuestSurveyEligibilityRow = {
  room?: string | null;
  room_type?: string | null;
  status?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  spa_date?: string | null;
};

/** Day-pass cohort with spa on visit day (original MVP). */
export function isDayPassSpaSurveyEligible(guest: GuestSurveyEligibilityRow | null | undefined): boolean {
  if (!guest) return false;
  const isDayPass = guest.room_type === "day_guest" || guest.room_type === "premium_day_guest";
  const spaDate = String(guest.spa_date ?? "").trim().slice(0, 10);
  const arrival = String(guest.arrival_date ?? "").trim().slice(0, 10);
  return isDayPass && !!spaDate && spaDate === arrival;
}

/** Suite guest after checkout — post-stay portal survey (#survey link from checkout_fb). */
export function isSuitePostCheckoutSurveyEligible(
  guest: GuestSurveyEligibilityRow | null | undefined,
): boolean {
  if (!guest) return false;
  if (!isEffectiveSuiteGuest(guest)) return false;
  if (guest.status !== "checked_out") return false;
  return !!String(guest.departure_date ?? "").trim().slice(0, 10);
}

export function isGuestPortalSurveyEligible(guest: GuestSurveyEligibilityRow | null | undefined): boolean {
  return isDayPassSpaSurveyEligible(guest) || isSuitePostCheckoutSurveyEligible(guest);
}

/** visit_date for guest_surveys UNIQUE(guest_id, visit_date). */
export function resolveSurveyVisitDate(guest: GuestSurveyEligibilityRow | null | undefined): string | null {
  if (isSuitePostCheckoutSurveyEligible(guest)) {
    return String(guest!.departure_date).trim().slice(0, 10);
  }
  if (isDayPassSpaSurveyEligible(guest)) {
    return String(guest!.arrival_date).trim().slice(0, 10);
  }
  return null;
}
