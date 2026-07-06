// supabase/functions/_shared/suiteNames.ts
//
// Deno-side mirror of src/data/suiteRegistry.js — the 26 canonical physical
// suites. Duplicated across the front/back boundary by repo convention (same
// as guestTiming.js's live-status check); when a suite is added/renamed,
// update BOTH files.
//
// Why this exists (P0, session 125): automation routing (checkEligibility +
// whatsapp-send's day-pass gates) trusted guests.room_type alone, while the
// UI's isSuite()/isSuiteGuestProfile() also recognises a canonical suite room
// name. A guest synced with room="אמטיסט 8" but room_type='day_guest' (import
// classification slip in sync_suite_arrivals' isDayGuest/hasSuite flags) was
// therefore routed to DAY-PASS content (morning_daypass) despite occupying a
// real suite. These helpers are the single server-side truth for "is this
// guest effectively a suite guest" — room_type OR canonical suite room.

export const CANONICAL_SUITE_NAMES = [
  "ג׳ספר 1",  "ג׳ספר 2",  "ג׳ספר 3",  "ג׳ספר 4",  "ג׳ספר 5",  "ג׳ספר 6",
  "אוניקס 7",  "אמטיסט 8",  "אמטיסט 9",  "אמטיסט 10", "אמטיסט 11", "אוניקס 12",
  "רובי 13",   "רובי 14",   "רובי 15",   "רובי 16",
  "אמרלד 17",  "אמרלד 18",  "אמרלד 19",  "אמרלד 20",
  "אקווה מרין 21", "אקווה מרין 22", "אקווה מרין 23",
  "אקווה מרין 24", "אקווה מרין 25", "אקווה מרין 26",
];

const DAY_PASS_ROOM_TYPES = new Set(["day_guest", "premium_day_guest"]);

/** Unify geresh/apostrophe variants + strip optional "סוויטת" prefix so
 * "ג'ספר 3" / "סוויטת ג׳ספר 3" both match the canonical "ג׳ספר 3". */
function normalizeRoomName(room: unknown): string {
  return String(room ?? "")
    .trim()
    .replace(/^סוויטת\s+/, "")
    .replace(/['‘’׳]/g, "׳")
    .replace(/\s+/g, " ");
}

const CANONICAL_SET = new Set(CANONICAL_SUITE_NAMES.map(normalizeRoomName));

export function isCanonicalSuiteRoom(room: unknown): boolean {
  const n = normalizeRoomName(room);
  return n !== "" && CANONICAL_SET.has(n);
}

export interface GuestRoomFields {
  room?: unknown;
  room_type?: unknown;
}

/** Effective suite classification — room_type says suite OR the assigned room
 * is a real suite. Mirrors the UI's isSuiteGuestProfile() exactly. */
export function isEffectiveSuiteGuest(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!guest) return false;
  if (guest.room_type === "suite") return true;
  return isCanonicalSuiteRoom(guest.room);
}

/** Effective day-pass classification — day-pass room_type AND NOT occupying a
 * real suite. A conflicted row (suite room + day_guest room_type) is NOT a
 * day-pass guest for routing purposes. */
export function isEffectiveDayPassGuest(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!guest) return false;
  if (!DAY_PASS_ROOM_TYPES.has(String(guest.room_type ?? ""))) return false;
  return !isCanonicalSuiteRoom(guest.room);
}

/** FAIL VISIBLE (§0.3): true when room says suite but room_type says day-pass —
 * the exact split-brain that misrouted suite guests to day-pass content.
 * Surfaced as a ⚠ badge in ACC Live Queue + GuestsPage/GuestDashboard and as a
 * console.warn in whatsapp-send; routing treats the guest as SUITE. */
export function hasSuiteRoomTypeConflict(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!guest) return false;
  return (
    DAY_PASS_ROOM_TYPES.has(String(guest.room_type ?? "")) &&
    isCanonicalSuiteRoom(guest.room)
  );
}
