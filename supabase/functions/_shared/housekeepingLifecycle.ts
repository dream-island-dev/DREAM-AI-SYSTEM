// Housekeeping WA lifecycle scoring — mirrors resort turnover:
// Co → לניקיון | ✅ → ממתין לאישור | manager approve → room_ready + פנוי | צק אין → checked_in + תפוס

import type { SuiteGuestRow } from "./housekeepingGuestLookup.ts";

export const CHECKIN_ELIGIBLE_STATUSES = new Set(["pending", "expected", "room_ready"]);
export const READY_GUEST_STATUSES = new Set(["pending", "expected", "room_ready"]);

/** Prefer room_ready (approved) > expected > pending for physical check-in. */
export function scoreGuestForCheckIn(g: SuiteGuestRow): number {
  if (g.status === "room_ready") return 0;
  if (g.status === "expected") return 1;
  if (g.status === "pending") return 2;
  if (g.status === "checked_in") return 3;
  return 9;
}

/** Prefer in-house guest for Co N before archived rows on same room. */
export function scoreGuestForCheckout(g: SuiteGuestRow): number {
  if (g.status === "checked_in") return 0;
  if (g.status === "room_ready") return 1;
  if (g.status === "expected") return 2;
  if (g.status === "pending") return 3;
  if (g.status === "checked_out") return 4;
  return 9;
}

/** Arriving today for ready bell — room_ready first (re-clean edge). */
export function scoreGuestForReadyBell(g: SuiteGuestRow): number {
  if (g.status === "room_ready") return 0;
  if (g.status === "expected") return 1;
  if (g.status === "pending") return 2;
  return 9;
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
  return true;
}
