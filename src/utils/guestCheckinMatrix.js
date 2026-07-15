// src/utils/guestCheckinMatrix.js
// Reception check-in matrix — stay window + 15:00 Israel auto check-in (mirrors
// automationSchedule.ts / whatsapp-cron). Pure functions, no Supabase calls.

import { israelDateOffsetStr, israelTodayStr, isPreArrivalTodayGuest } from "./guestTiming";

/** PMS timeline scopes for צ'ק-אין tab filter bar. */
export const CHECKIN_TIMELINE_TODAY = "today";
export const CHECKIN_TIMELINE_TOMORROW = "tomorrow";
export const CHECKIN_TIMELINE_WEEK7 = "week7";
export const CHECKIN_TIMELINE_ARCHIVE = "archive";

export const CHECKIN_TIMELINE_SCOPES = [
  CHECKIN_TIMELINE_TODAY,
  CHECKIN_TIMELINE_TOMORROW,
  CHECKIN_TIMELINE_WEEK7,
  CHECKIN_TIMELINE_ARCHIVE,
];

export const CHECKIN_TIMELINE_LABELS = {
  [CHECKIN_TIMELINE_TODAY]: "היום",
  [CHECKIN_TIMELINE_TOMORROW]: "מחר",
  [CHECKIN_TIMELINE_WEEK7]: "7 ימים קרובים",
  [CHECKIN_TIMELINE_ARCHIVE]: "אורחים לאחר שהות",
};

const STATUS_SORT_ORDER = {
  checked_in: 0,
  room_ready: 1,
  expected: 2,
  pending: 3,
  checked_out: 9,
  cancelled: 10,
};

export const AUTO_CHECKIN_LOCAL_HOUR = 15;
export const AUTO_CHECKOUT_LOCAL_HOUR = 11;
const AUTO_CHECKIN_ELIGIBLE = new Set(["pending", "expected", "room_ready"]);
const AUTO_CHECKOUT_ELIGIBLE = new Set(["checked_in", "room_ready", "expected", "pending"]);

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

export function isPastAutoCheckoutGateway(now = new Date()) {
  return israelLocalHour(now) >= AUTO_CHECKOUT_LOCAL_HOUR;
}

/** DISABLED (2026-07-11) — always false. Housekeeping WA group is the sole
 * check-in source for suites now; see automationSchedule.ts's mirror doc. */
export function shouldAutoPromoteToCheckedIn(_guest, _now = new Date()) {
  return false;
}

/** Effective status for UI/routing — 11:00 auto checkout on departure day.
 * Auto check-in promotion is disabled — see shouldAutoPromoteToCheckedIn. */
export function resolveEffectiveGuestStatus(guest, now = new Date()) {
  if (shouldAutoCheckoutGuest(guest, now)) return "checked_out";
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

  if (effective === "checked_out") return false;
  if (guest.departure_date && guest.departure_date < today) return false;

  if (effective === "checked_in") {
    return isWithinStayWindow(guest, today);
  }

  if (guest.arrival_date === today && AUTO_CHECKIN_ELIGIBLE.has(guest.status)) {
    return true;
  }

  return false;
}

/** Post-stay archive tab — departed or past 11:00 on departure day. */
export function isPostStayArchiveGuest(guest, today = israelTodayStr(), now = new Date()) {
  if (!guest) return false;
  if (guest.status === "checked_out") return true;
  if (shouldAutoCheckoutGuest(guest, now)) return true;
  if (guest.departure_date && guest.departure_date < today) return true;
  return false;
}

export function shouldAutoCheckoutGuest(guest, now = new Date()) {
  if (!guest?.departure_date) return false;
  if (guest.status === "checked_out" || guest.status === "cancelled") return false;
  if (!AUTO_CHECKOUT_ELIGIBLE.has(guest.status)) return false;
  const today = israelTodayStr();
  if (guest.departure_date < today) return true;
  if (guest.departure_date === today) return isPastAutoCheckoutGateway(now);
  return false;
}

/** Map arrival_date → best צ'ק-אין timeline scope (GuestDashboard → GuestsPage). */
export function resolveTimelineScopeForArrival(arrivalDate, today = israelTodayStr()) {
  if (!arrivalDate || arrivalDate <= today) return CHECKIN_TIMELINE_TODAY;
  const tomorrow = israelDateOffsetStr(1, today);
  if (arrivalDate === tomorrow) return CHECKIN_TIMELINE_TOMORROW;
  return CHECKIN_TIMELINE_WEEK7;
}

/** Exact arrival_date match (excludes cancelled). */
export function matchesCustomArrivalDate(guest, ymd) {
  if (!guest || !ymd || guest.status === "cancelled") return false;
  return guest.arrival_date === ymd;
}

/**
 * Unified roster filter — custom arrival date wins over timeline scope chip.
 */
export function applyCheckinRosterFilter(guests, { scope, customArrivalDate, now = new Date() } = {}) {
  if (!Array.isArray(guests)) return [];
  if (customArrivalDate) {
    return guests.filter((g) => matchesCustomArrivalDate(g, customArrivalDate));
  }
  return guests.filter((g) => matchesCheckinTimelineScope(g, scope, now));
}

/** Per-scope counts for filter bar badges. */
export function countCheckinScopeTotals(guests, now = new Date()) {
  return Object.fromEntries(
    CHECKIN_TIMELINE_SCOPES.map((scope) => [
      scope,
      (guests || []).filter((g) => matchesCheckinTimelineScope(g, scope, now)).length,
    ]),
  );
}

/** PMS timeline filter — today / tomorrow / 7-day forward / post-stay archive. */
export function matchesCheckinTimelineScope(guest, scope, now = new Date()) {
  if (!guest || guest.status === "cancelled") return false;
  const today = israelTodayStr();

  if (scope === CHECKIN_TIMELINE_ARCHIVE) {
    return isPostStayArchiveGuest(guest, today);
  }
  if (scope === CHECKIN_TIMELINE_TODAY) {
    return isActiveCheckinRosterGuest(guest, now);
  }
  if (scope === CHECKIN_TIMELINE_TOMORROW) {
    const tomorrow = israelDateOffsetStr(1, today);
    if (guest.arrival_date !== tomorrow) return false;
    return guest.status !== "checked_out";
  }
  if (scope === CHECKIN_TIMELINE_WEEK7) {
    const weekEnd = israelDateOffsetStr(6, today);
    if (!guest.arrival_date || guest.arrival_date < today || guest.arrival_date > weekEnd) {
      return false;
    }
    return guest.status !== "checked_out";
  }
  return false;
}

/** Display arrival_date + optional ETA for צ'ק-אין roster cells. */
export function formatCheckinArrivalDisplay(guest) {
  return {
    date: guest?.arrival_date ?? "—",
    eta: (guest?.arrival_time ?? "").trim() || null,
  };
}

const PRE_ARRIVAL_STATUSES = new Set(["pending", "expected", "room_ready"]);

export { isPreArrivalTodayGuest };

/** Shared roster sort — status → (ETA|room by scope) → name. */
export function sortCheckinRosterGuests(guests, now = new Date(), roomResolver, options = {}) {
  const { prioritizeEta = false } = options;
  const today = israelTodayStr();
  const eff = (g) => resolveEffectiveGuestStatus(g, now) ?? g.status ?? "";
  const roomOf = (g) => (g.room || roomResolver?.(g) || "").toString();
  const etaOf = (g) => (g.arrival_time && /^\d{2}:\d{2}$/.test(g.arrival_time) ? g.arrival_time : "99:99");

  return [...guests].sort((a, b) => {
    const sa = STATUS_SORT_ORDER[eff(a)] ?? 5;
    const sb = STATUS_SORT_ORDER[eff(b)] ?? 5;
    if (sa !== sb) return sa - sb;

    const etaFirst = prioritizeEta && isPreArrivalTodayGuest(a, today) && isPreArrivalTodayGuest(b, today);
    if (etaFirst) {
      const etaCmp = etaOf(a).localeCompare(etaOf(b));
      if (etaCmp !== 0) return etaCmp;
      const roomCmp = roomOf(a).localeCompare(roomOf(b), "he");
      if (roomCmp !== 0) return roomCmp;
    } else {
      const roomCmp = roomOf(a).localeCompare(roomOf(b), "he");
      if (roomCmp !== 0) return roomCmp;
      const etaCmp = etaOf(a).localeCompare(etaOf(b));
      if (etaCmp !== 0) return etaCmp;
    }

    const arrCmp = (a.arrival_date || "").localeCompare(b.arrival_date || "");
    if (arrCmp !== 0) return arrCmp;
    return (a.name || "").localeCompare(b.name || "", "he");
  });
}

/** Row highlight class for in-house vs upcoming reservation. */
export function getCheckinRowHighlight(guest, now = new Date()) {
  const effective = resolveEffectiveGuestStatus(guest, now);
  if (effective === "checked_in") {
    return { bg: "rgba(26,122,74,0.07)", dot: "#1A7A4A", title: "אורח בחדר" };
  }
  if (["expected", "pending"].includes(guest?.status)) {
    return { bg: "rgba(201,169,110,0.09)", dot: "#C9A96E", title: "הגעה מתוכננת" };
  }
  if (guest?.status === "room_ready") {
    return { bg: "rgba(41,82,163,0.06)", dot: "#2952A3", title: "חדר מוכן — ממתין לצ'ק-אין" };
  }
  return { bg: undefined, dot: null, title: null };
}
