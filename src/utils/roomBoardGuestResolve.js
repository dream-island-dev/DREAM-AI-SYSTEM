// Room board guest ↔ suite matching (mirrors AICopilot.enrichRoom priority).
// Single source for RoomBoard display + reconcile planning.

import { guestRoomMatchesSuiteId } from "../data/suiteRegistry";
import { israelTodayStr, israelDateOffsetStr } from "./guestTiming";

const BOARD_STATUSES = new Set(["checked_in", "room_ready", "pending", "expected"]);

/** In-house checked_in guest (arrival ≤ today, departure not passed). */
export function isGuestInStay(guest, today = israelTodayStr()) {
  if (!guest || guest.status !== "checked_in") return false;
  if (guest.arrival_date && guest.arrival_date > today) return false;
  if (guest.departure_date && guest.departure_date < today) return false;
  return true;
}

/** Guest row worth showing on the room board card. */
export function isRelevantBoardGuest(guest, today = israelTodayStr()) {
  if (!guest || guest.status === "cancelled" || !BOARD_STATUSES.has(guest.status)) return false;
  if (isGuestInStay(guest, today)) return true;
  if (!guest.arrival_date) return false;
  const tomorrow = israelDateOffsetStr(1, today);
  return guest.arrival_date >= today && guest.arrival_date <= tomorrow;
}

function guestPickScore(guest, today) {
  if (isGuestInStay(guest, today)) return 0;
  if (guest.arrival_date === today) return 1;
  if (guest.arrival_date === israelDateOffsetStr(1, today)) return 2;
  return 9;
}

function collectMatches(roomId, guests, suiteRows, guestById) {
  const seen = new Set();
  const out = [];

  const push = (g) => {
    if (!g?.id || seen.has(g.id)) return;
    seen.add(g.id);
    out.push(g);
  };

  for (const g of guests) {
    if (guestRoomMatchesSuiteId(g, roomId)) push(g);
  }

  for (const sr of suiteRows) {
    if (!sr?.guest_id) continue;
    if (!guestRoomMatchesSuiteId(
      { room: sr.room_display ?? sr.room_name, suite_name: sr.suite_type },
      roomId,
    )) continue;
    const linked = guestById.get(Number(sr.guest_id));
    if (linked) push(linked);
  }

  return out;
}

/** Best guest for a suite card — checked_in > today > tomorrow. */
export function pickGuestForSuite(roomId, guests, suiteRows = [], today = israelTodayStr()) {
  const guestById = new Map((guests ?? []).map((g) => [Number(g.id), g]));
  const matches = collectMatches(roomId, guests ?? [], suiteRows ?? [], guestById)
    .filter((g) => isRelevantBoardGuest(g, today));

  if (!matches.length) return null;

  matches.sort((a, b) => {
    const sa = guestPickScore(a, today);
    const sb = guestPickScore(b, today);
    if (sa !== sb) return sa - sb;
    return (a.arrival_date || "").localeCompare(b.arrival_date || "");
  });

  return matches[0];
}

/** Map SUITE_REGISTRY id → best guest (batch). */
export function buildRoomGuestMap(suiteIds, guests, suiteRows, today = israelTodayStr()) {
  const map = {};
  for (const roomId of suiteIds) {
    map[roomId] = pickGuestForSuite(roomId, guests, suiteRows, today);
  }
  return map;
}

export function isArrivalTodayGuest(guest, today = israelTodayStr()) {
  return !!guest && guest.arrival_date === today && guest.status !== "checked_in";
}

export function isArrivalTomorrowGuest(guest, today = israelTodayStr()) {
  return !!guest && guest.arrival_date === israelDateOffsetStr(1, today);
}
