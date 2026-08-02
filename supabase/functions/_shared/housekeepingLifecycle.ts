// Housekeeping WA lifecycle scoring — mirrors resort turnover:
// Co → לניקיון | ✅ → ממתין לאישור | manager approve → room_ready + פנוי | צק אין → checked_in + תפוס
// Date window (arrival_date / departure_date) is the primary gate — status alone is never enough.

import type { SuiteGuestRow } from "./housekeepingGuestLookup.ts";

export const CHECKIN_ELIGIBLE_STATUSES = new Set(["pending", "expected", "room_ready"]);
export const READY_GUEST_STATUSES = new Set(["pending", "expected", "room_ready"]);

/** Score ≥ this → guest is excluded from WA room matching. */
export const HOUSEKEEPING_SCORE_OUT_OF_RANGE = 100;

/**
 * Guest is physically eligible for this calendar day.
 * Open-ended stay (no departure_date) counts only on arrival day — blocks stale ghosts.
 */
export function isGuestInStayWindow(g: SuiteGuestRow, today: string): boolean {
  if (!g.arrival_date || g.arrival_date > today) return false;
  if (g.departure_date) return g.departure_date >= today;
  return g.arrival_date === today;
}

/** CI candidate: in stay window + not already past departure. */
export function isGuestEligibleForHousekeepingCheckIn(g: SuiteGuestRow, today: string): boolean {
  if (!isGuestInStayWindow(g, today)) return false;
  if (CHECKIN_ELIGIBLE_STATUSES.has(g.status)) return true;
  return g.status === "checked_in";
}

/** Co candidate: arrived on/before today and departure is today or overdue. */
export function isGuestEligibleForHousekeepingCheckOut(g: SuiteGuestRow, today: string): boolean {
  if (!g.arrival_date || g.arrival_date > today) return false;
  if (!g.departure_date) return false;
  return g.departure_date <= today;
}

/** Arriving today — eligible for physical check-in from WA group. Lower = better. */
export function scoreGuestForCheckIn(g: SuiteGuestRow, today: string): number {
  if (!isGuestEligibleForHousekeepingCheckIn(g, today)) return HOUSEKEEPING_SCORE_OUT_OF_RANGE;

  if (g.arrival_date === today) {
    if (g.status === "room_ready") return 0;
    if (g.status === "expected") return 1;
    if (g.status === "pending") return 2;
    if (g.status === "checked_in") return 3;
    return 10;
  }

  // Late check-in: arrived before today, still in stay, never checked in.
  if (g.arrival_date && g.arrival_date < today && CHECKIN_ELIGIBLE_STATUSES.has(g.status)) {
    if (g.status === "room_ready") return 20;
    if (g.status === "expected") return 21;
    return 22;
  }

  return HOUSEKEEPING_SCORE_OUT_OF_RANGE;
}

/** Co N — prefer departing today, then overdue in-house. Lower = better. */
export function scoreGuestForCheckout(g: SuiteGuestRow, today: string): number {
  if (!isGuestEligibleForHousekeepingCheckOut(g, today)) return HOUSEKEEPING_SCORE_OUT_OF_RANGE;

  if (g.departure_date === today) {
    if (g.status === "checked_in") return 0;
    if (g.status === "room_ready") return 1;
    if (g.status === "expected") return 2;
    if (g.status === "pending") return 3;
    if (g.status === "checked_out") return 4;
    return 10;
  }

  if (g.departure_date && g.departure_date < today) {
    if (g.status === "checked_in") return 5;
    if (g.status === "checked_out") return 6;
    return 15;
  }

  return HOUSEKEEPING_SCORE_OUT_OF_RANGE;
}

/** Arriving today for ready bell — room_ready first (re-clean edge). */
export function scoreGuestForReadyBell(g: SuiteGuestRow, today: string): number {
  if (!isGuestInStayWindow(g, today)) return HOUSEKEEPING_SCORE_OUT_OF_RANGE;
  if (g.arrival_date !== today) return HOUSEKEEPING_SCORE_OUT_OF_RANGE;
  if (!READY_GUEST_STATUSES.has(g.status)) return HOUSEKEEPING_SCORE_OUT_OF_RANGE;
  if (g.status === "room_ready") return 0;
  if (g.status === "expected") return 1;
  if (g.status === "pending") return 2;
  return 9;
}

/** In-house checked_in for occupied-room skip on ready signal. */
export function scoreGuestForInHouseStay(g: SuiteGuestRow, today: string): number {
  if (g.status !== "checked_in") return HOUSEKEEPING_SCORE_OUT_OF_RANGE;
  if (!isGuestInStayWindow(g, today)) return HOUSEKEEPING_SCORE_OUT_OF_RANGE;
  return 0;
}

/** Same-day turnover: outgoing checked_in (departure ≤ today) + incoming arriving today. */
export function shouldHousekeepingTurnover(
  incoming: SuiteGuestRow | null,
  outgoing: SuiteGuestRow | null,
  today: string,
): boolean {
  if (!incoming || !outgoing) return false;
  if (incoming.id === outgoing.id) return false;
  if (incoming.arrival_date !== today) return false;
  if (!CHECKIN_ELIGIBLE_STATUSES.has(incoming.status)) return false;
  if (outgoing.status !== "checked_in") return false;
  if (!outgoing.departure_date || outgoing.departure_date > today) return false;
  if (!isGuestInStayWindow(incoming, today)) return false;
  return true;
}
