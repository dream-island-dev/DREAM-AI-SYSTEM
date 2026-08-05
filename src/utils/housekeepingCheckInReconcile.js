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

export async function fetchHousekeepingCheckInsForDate(supabase, dateYmd = israelTodayStr()) {
  if (!supabase || !dateYmd) return [];
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
    return [];
  }
  return data ?? [];
}

export async function markHousekeepingEventSynced(supabase, eventId, guestId) {
  if (!supabase || !eventId) return;
  await supabase
    .from("housekeeping_wa_events")
    .update({
      sync_action: "updated",
      sync_error: null,
      guest_id: guestId ?? null,
    })
    .eq("id", eventId);
}

/**
 * Apply check-in for guests that have a group signal but are still eligible.
 * @returns {Promise<Array<{ guestId: number, guestPatch: object, roomId: string }>>}
 */
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

  // Require room assignment on guest before auto-sync (Fail Visible).
    const roomIds = collectGuestSuiteRoomIds(guest, suiteRoomsByGuestId[guest.id] ?? []);
    if (!roomIds.length) continue;

    const result = await performSuiteCheckIn(supabase, guest, {
      roomId: sync.roomId,
      auditSource: source,
    });
    if (!result.ok) continue;

    if (sync.eventId) {
      await markHousekeepingEventSynced(supabase, sync.eventId, guest.id);
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
