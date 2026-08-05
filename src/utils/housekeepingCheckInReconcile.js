// Housekeeping group check-in ↔ GuestsPage reconcile (mirrors _shared/housekeepingCheckInReconcile.ts intent).
import { SUITE_REGISTRY, guestRoomMatchesSuiteId, resolveSuiteFromEzgoFields } from "../data/suiteRegistry";
import { resolveSuiteRoomDisplayLabel } from "./suiteRoomReady";
import { performSuiteCheckIn } from "./suiteCheckinSync";
import { israelTodayStr } from "./guestTiming";

export const HK_CHECKIN_SUCCESS_ACTIONS = new Set(["updated", "already_checked_in"]);
export const HK_CHECKIN_ELIGIBLE_STATUSES = new Set(["pending", "expected", "room_ready"]);

/** Canonical suite room_ids linked to a guest (guests.room + suite_rooms). */
export function collectGuestSuiteRoomIds(guest, suiteRoomRows = []) {
  const ids = new Set();
  const pushCanon = (label, suiteType) => {
    const canon = resolveSuiteFromEzgoFields(label, suiteType, false);
    if (canon && SUITE_REGISTRY.includes(canon)) ids.add(canon);
  };

  pushCanon(guest?.room, guest?.suite_name);
  for (const seg of String(guest?.room ?? "").split(/\s*·\s*/)) {
    if (seg.trim()) pushCanon(seg.trim(), null);
  }

  for (const row of suiteRoomRows) {
    pushCanon(resolveSuiteRoomDisplayLabel(row), row?.suite_type);
  }

  return [...ids];
}

/** Latest check_in event per room_id for a calendar day (Israel YMD). */
export function indexHousekeepingCheckInsByRoom(events = []) {
  const byRoom = {};
  const sorted = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const evt of sorted) {
    const roomId = String(evt?.room_id ?? "").trim();
    if (!roomId || byRoom[roomId]) continue;
    byRoom[roomId] = evt;
  }
  return byRoom;
}

export function resolveGuestHousekeepingSync(guest, suiteRoomRows, hkByRoom) {
  const roomIds = collectGuestSuiteRoomIds(guest, suiteRoomRows);
  let evt = null;
  let roomId = null;
  for (const rid of roomIds) {
    if (hkByRoom[rid]) {
      evt = hkByRoom[rid];
      roomId = rid;
      break;
    }
  }
  if (!evt) return { state: "none" };

  const action = evt.sync_action ?? null;
  const eventAt = evt.created_at ?? null;

  if (guest?.status === "checked_in") {
    return { state: "synced", roomId, eventAt, action, eventId: evt.id };
  }

  if (!HK_CHECKIN_ELIGIBLE_STATUSES.has(guest?.status)) {
    return {
      state: "failed",
      roomId,
      eventAt,
      action: action ?? "guest_not_eligible",
      error: evt.sync_error,
      eventId: evt.id,
    };
  }

  if (action && HK_CHECKIN_SUCCESS_ACTIONS.has(action)) {
    return {
      state: "pending",
      roomId,
      eventAt,
      action,
      error: evt.sync_error,
      eventId: evt.id,
      reason: "logged_success_guest_stale",
    };
  }

  return {
    state: "pending",
    roomId,
    eventAt,
    action,
    error: evt.sync_error,
    eventId: evt.id,
  };
}

export function buildHousekeepingSyncMap(guests, suiteRoomsByGuestId, hkByRoom) {
  const map = {};
  for (const guest of guests ?? []) {
    if (!guest?.id) continue;
    map[guest.id] = resolveGuestHousekeepingSync(
      guest,
      suiteRoomsByGuestId[guest.id] ?? [],
      hkByRoom,
    );
  }
  return map;
}

/**
 * FAIL VISIBLE (P0 2026-08-05): returns { rows, error } instead of swallowing
 * a query failure as an empty array — an empty array reads identically to
 * "the housekeeping group sent nothing today", which is a false all-clear
 * when the real story is "we don't know". Callers must check `error` before
 * trusting the sync chips they build from `rows`.
 * @returns {Promise<{ rows: Array, error: string|null }>}
 */
export async function fetchHousekeepingCheckInsForDate(supabase, dateYmd = israelTodayStr()) {
  if (!supabase || !dateYmd) return { rows: [], error: null };
  const dayStart = new Date(`${dateYmd}T00:00:00+03:00`).toISOString();
  const dayEnd = new Date(`${dateYmd}T23:59:59.999+03:00`).toISOString();
  const { data, error } = await supabase
    .from("housekeeping_wa_events")
    .select("id, room_id, room_number, created_at, sync_action, sync_error, guest_id, source_line")
    .eq("event_type", "check_in")
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[housekeepingCheckInReconcile] fetch failed:", error.message);
    return { rows: [], error: error.message };
  }
  return { rows: data ?? [], error: null };
}

export async function markHousekeepingEventSynced(supabase, eventId, guestId) {
  if (!supabase || !eventId) return { ok: false };
  const { error } = await supabase
    .from("housekeeping_wa_events")
    .update({
      sync_action: "updated",
      sync_error: null,
      guest_id: guestId ?? null,
    })
    .eq("id", eventId);
  if (error) {
    // FAIL VISIBLE: the guest check-in itself already succeeded (guests table
    // write happens before this call) — this only means the sync audit trail
    // (migration 286/287) didn't persist. Log loudly rather than pretend it worked.
    console.warn("[housekeepingCheckInReconcile] sync audit write failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Apply check-in for guests that have a group signal but are still eligible.
 * @returns {Promise<Array<{ guestId: number, guestPatch: object, roomId: string }>>}
 */
/** Single-guest HK reconcile — used after manual/Doc2 import (2026-08-05). */
export async function reconcileHousekeepingCheckInForGuest(supabase, guest, suiteRoomRows = []) {
  if (!supabase || !guest?.id || guest.status === "checked_in") {
    return { applied: false };
  }
  const { rows: hkEvents } = await fetchHousekeepingCheckInsForDate(supabase, israelTodayStr());
  const hkByRoom = indexHousekeepingCheckInsByRoom(hkEvents);
  const applied = await reconcileHousekeepingCheckIns(
    supabase,
    [guest],
    { [guest.id]: suiteRoomRows },
    hkByRoom,
    { auditSource: "צ'ק-אין מקבוצת ניקיון (סנכרון אחרי ייבוא)" },
  );
  if (!applied.length) return { applied: false };
  return {
    applied: true,
    guestPatch: applied[0].guestPatch,
    roomId: applied[0].roomId,
  };
}

export async function reconcileHousekeepingCheckIns(
  supabase,
  guests,
  suiteRoomsByGuestId,
  hkByRoom,
  { auditSource } = {},
) {
  if (!supabase) return [];
  const applied = [];
  const source = auditSource ?? "צ'ק-אין מקבוצת ניקיון (סנכרון אוטומטי)";

  for (const guest of guests ?? []) {
    if (!guest?.id || guest.status === "checked_in") continue;
    if (!HK_CHECKIN_ELIGIBLE_STATUSES.has(guest.status)) continue;

    const sync = resolveGuestHousekeepingSync(
      guest,
      suiteRoomsByGuestId[guest.id] ?? [],
      hkByRoom,
    );
    if (sync.state !== "pending" || !sync.roomId) continue;

    // QA P2 2026-08-05: "logged_success_guest_stale" means this room's HK
    // check-in signal already resolved successfully to a DIFFERENT guest —
    // genuinely ambiguous (two guests, same room, one already claimed by the
    // signal). Auto-applying here on an unattended page load/poll risked
    // silently checking in the wrong guest; require the explicit manual
    // "⚠️ סנכרן מקבוצה" click instead (same sync.state="pending" chip, just
    // not auto-applied).
    if (sync.reason === "logged_success_guest_stale") continue;

  // Require room assignment on guest before auto-sync (Fail Visible).
    const roomIds = collectGuestSuiteRoomIds(guest, suiteRoomsByGuestId[guest.id] ?? []);
    if (!roomIds.length) continue;

    const result = await performSuiteCheckIn(supabase, guest, {
      roomId: sync.roomId,
      auditSource: source,
    });
    if (!result.ok) {
      // P2 2026-08-05: this ran silently on every 60s background poll — a
      // persistently-failing auto-sync (e.g. a room the guest no longer
      // matches) never surfaced anywhere, and the guest just stayed stuck
      // pending with no visible reason.
      console.warn(`[housekeepingCheckInReconcile] auto check-in failed for guest ${guest.id}:`, result.error);
      continue;
    }

    if (sync.eventId) {
      const synced = await markHousekeepingEventSynced(supabase, sync.eventId, guest.id);
      if (!synced.ok) {
        console.warn(`[housekeepingCheckInReconcile] check-in applied but sync audit write failed for guest ${guest.id}:`, synced.error);
      }
    }

    applied.push({
      guestId: guest.id,
      guestPatch: result.guestPatch,
      roomId: sync.roomId,
    });
  }

  return applied;
}

/** Match guest to room for manual sync button — uses guestRoomMatchesSuiteId. */
export function guestMatchesHousekeepingRoom(guest, suiteRoomRows, roomId) {
  if (guestRoomMatchesSuiteId(guest, roomId)) return true;
  return (suiteRoomRows ?? []).some((row) =>
    guestRoomMatchesSuiteId(
      { room: resolveSuiteRoomDisplayLabel(row), suite_name: row?.suite_type },
      roomId,
    ),
  );
}
