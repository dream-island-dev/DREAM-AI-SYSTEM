// Resort-wide operational counters — single source for ResortPulseBar + Dashboard hooks.
import {
  isGuestDeparted,
  israelTodayStr,
  isPreArrivalTodayGuest,
  isSuiteGuestProfile,
  isSuiteInResortToday,
  isDayPassRoomType,
  isPremiumDayRoom,
} from "./guestTiming";

/** Last-9-digit key — same convention as Inbox phone map. */
export function phoneLookupKey(raw) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length >= 9) return digits.slice(-9);
  return digits;
}

export function buildGuestsByPhoneKey(guests) {
  const map = new Map();
  for (const g of guests ?? []) {
    if (!g?.phone) continue;
    map.set(phoneLookupKey(g.phone), g);
  }
  return map;
}

/**
 * Match Inbox «🔴 התראות»: distinct active (non-departed) phones with
 * human_requested on an inbound whatsapp_conversations row — split by
 * suite/daypass audience using the SAME room helpers Inbox's
 * contactIsSuiteAudience / contactIsDaypassAudience are built on, so the two
 * counts never drift out of sync with what staff see in the Inbox tab.
 * Mixing suite + daypass reds into one ambiguous number caused wrong triage
 * (Mike, 2026-08-09) — Pulse/Dashboard must always show the split, not a
 * single combined figure. `unmatched` (no guest row / unrecognized room) is
 * kept separate rather than silently folded into either bucket — FAIL VISIBLE.
 */
export function countActiveInboxAlerts(alertPhones, guestsByPhoneKey) {
  const seen = new Set();
  let suite = 0;
  let daypass = 0;
  let unmatched = 0;
  for (const phone of alertPhones ?? []) {
    const key = phoneLookupKey(phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const guest = guestsByPhoneKey.get(key);
    if (isGuestDeparted(guest)) continue;
    if (isSuiteGuestProfile(guest)) suite += 1;
    else if (isDayPassRoomType(guest?.room_type) || isPremiumDayRoom(guest?.room)) daypass += 1;
    else unmatched += 1;
  }
  return { total: suite + daypass + unmatched, suite, daypass, unmatched };
}

/**
 * @param {Array<{status?:string,arrival_date?:string,departure_date?:string,phone?:string}>} guests
 * @param {{ inboxAlertsCount?: number, inboxAlertsCountSuite?: number, inboxAlertsCountDaypass?: number, blockedAutomation?: number, openOpsTasks?: number }} extras
 */
export function computeResortPulse(guests, extras = {}) {
  const today = israelTodayStr();
  let arrivalsToday = 0;
  let inResort = 0;
  let departingToday = 0;

  for (const g of guests ?? []) {
    if (!g || g.status === "cancelled") continue;
    if (isSuiteGuestProfile(g) && isPreArrivalTodayGuest(g)) arrivalsToday += 1;
    if (g.departure_date === today && g.status !== "checked_out") departingToday += 1;
    if (isSuiteInResortToday(g)) inResort += 1;
  }

  return {
    arrivalsToday,
    inResort,
    departingToday,
    needsAttention: extras.inboxAlertsCount ?? 0,
    needsAttentionSuite: extras.inboxAlertsCountSuite ?? 0,
    needsAttentionDaypass: extras.inboxAlertsCountDaypass ?? 0,
    needsAttentionUnmatched: extras.inboxAlertsCountUnmatched ?? 0,
    blockedAutomation: extras.blockedAutomation ?? 0,
    openOpsTasks: extras.openOpsTasks ?? 0,
  };
}
