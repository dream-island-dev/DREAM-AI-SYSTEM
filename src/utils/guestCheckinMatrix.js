// src/utils/guestCheckinMatrix.js
// Reception check-in matrix — stay window + 15:00 Israel auto check-in (mirrors
// automationSchedule.ts / whatsapp-cron). Pure functions, no Supabase calls.

import { israelTodayStr } from "./guestTiming";

export const AUTO_CHECKIN_LOCAL_HOUR = 15;
const AUTO_CHECKIN_ELIGIBLE = new Set(["pending", "expected", "room_ready"]);

export function israelLocalHour(now = new Date()) {
  return Number(
    now.toLocaleString("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "numeric",
      hour12: false,
    }),
  );
}

export function isPastAutoCheckinGateway(now = new Date()) {
  return israelLocalHour(now) >= AUTO_CHECKIN_LOCAL_HOUR;
}

export function shouldAutoPromoteToCheckedIn(guest, now = new Date()) {
  if (!guest?.arrival_date) return false;
  if (!isPastAutoCheckinGateway(now)) return false;
  if (guest.arrival_date !== israelTodayStr()) return false;
  return AUTO_CHECKIN_ELIGIBLE.has(guest.status);
}

/** Effective status for UI/routing — 15:00 gateway without waiting for cron. */
export function resolveEffectiveGuestStatus(guest, now = new Date()) {
  if (shouldAutoPromoteToCheckedIn(guest, now)) return "checked_in";
  return guest?.status ?? null;
}

/** Guest is still within arrival_date..departure_date window (inclusive start). */
export function isWithinStayWindow(guest, today = israelTodayStr()) {
  if (!guest?.arrival_date) return false;
  if (guest.arrival_date > today) return false;
  if (guest.departure_date && guest.departure_date < today) return false;
  return true;
}

/** Active צ'ק-אין roster: arriving today (pre check-in) OR in-house for full stay. */
export function isActiveCheckinRosterGuest(guest, now = new Date()) {
  if (!guest || guest.status === "cancelled" || guest.status === "checked_out") return false;

  const today = israelTodayStr();
  const effective = resolveEffectiveGuestStatus(guest, now);

  if (guest.departure_date && guest.departure_date < today) return false;

  if (effective === "checked_in") {
    return isWithinStayWindow(guest, today);
  }

  if (guest.arrival_date === today && AUTO_CHECKIN_ELIGIBLE.has(guest.status)) {
    return true;
  }

  return false;
}

/** Post-stay archive tab — departed or checkout date passed. */
export function isPostStayArchiveGuest(guest, today = israelTodayStr()) {
  if (!guest) return false;
  if (guest.status === "checked_out") return true;
  if (guest.departure_date && guest.departure_date < today) return true;
  return false;
}

export function shouldAutoCheckoutGuest(guest, today = israelTodayStr()) {
  if (!guest?.departure_date || guest.departure_date >= today) return false;
  if (guest.status === "checked_out" || guest.status === "cancelled") return false;
  return ["checked_in", "room_ready", "expected", "pending"].includes(guest.status);
}
