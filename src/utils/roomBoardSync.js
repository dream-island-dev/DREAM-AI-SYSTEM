// room_status ↔ guests.status consistency for RoomBoard (§0.5 FAIL VISIBLE).

import { isGuestInStay } from "./roomBoardGuestResolve";
import { israelTodayStr } from "./guestTiming";

const CLEANING_STATUSES = new Set(["לניקיון", "בניקיון", "ממתין לג'קוזי", "מוכן לפיניש"]);

/** Physical ops states — never overridden by guest profile for display. */
const OPS_OVERRIDE_STATUSES = new Set([
  "לניקיון", "בניקיון", "ממתין לג'קוזי", "מוכן לפיניש", "ממתין לאישור", "תחזוקה",
]);

/**
 * Live display status — guest golden profile wins over stale room_status,
 * except during active cleaning / approval / maintenance workflows.
 */
export function resolveEffectiveRoomStatus(dbStatus, guest, today = israelTodayStr()) {
  const st = String(dbStatus ?? "פנוי").trim();

  if (OPS_OVERRIDE_STATUSES.has(st)) return st;

  if (guest?.status === "checked_in" && isGuestInStay(guest, today)) {
    return "תפוס";
  }

  if (st === "תפוס") {
    return "פנוי";
  }

  return st;
}

/**
 * Detect mismatch between physical room_status and golden guest profile.
 * @returns {"occupied_without_checkin"|"checkin_without_occupied"|null}
 */
export function detectRoomSyncMismatch(roomStatus, guest, today) {
  const st = String(roomStatus ?? "פנוי").trim();

  if (st === "תפוס") {
    if (!guest || guest.status !== "checked_in" || !isGuestInStay(guest, today)) {
      return "occupied_without_checkin";
    }
  }

  if (guest?.status === "checked_in" && isGuestInStay(guest, today)) {
    if (st === "פנוי" || st === "ממתין לאישור") {
      return "checkin_without_occupied";
    }
  }

  return null;
}

/** Plan DB fixes after WHAPI outage / stale room_status. */
export function planRoomBoardReconcile(rooms) {
  const fixes = [];
  for (const room of rooms ?? []) {
    const mismatch = room.syncMismatch;
    if (!mismatch) continue;

    if (mismatch === "occupied_without_checkin") {
      if (CLEANING_STATUSES.has(room.status)) continue;
      fixes.push({
        roomId: room.id,
        from: room.status,
        to: "פנוי",
        reason: "occupied_without_checkin",
      });
    }

    if (mismatch === "checkin_without_occupied") {
      if (room.status !== "פנוי" && room.status !== "ממתין לאישור") continue;
      fixes.push({
        roomId: room.id,
        from: room.status,
        to: "תפוס",
        reason: "checkin_without_occupied",
      });
    }
  }
  return fixes;
}

export async function applyRoomBoardReconcile(supabase, fixes) {
  if (!supabase || !fixes?.length) return { ok: true, applied: 0, errors: [] };

  const now = new Date().toISOString();
  let applied = 0;
  const errors = [];

  for (const fix of fixes) {
    const { error } = await supabase.from("room_status").upsert(
      { room_id: fix.roomId, status: fix.to, updated_at: now },
      { onConflict: "room_id" },
    );
    if (error) {
      errors.push({ roomId: fix.roomId, message: error.message });
    } else {
      applied += 1;
    }
  }

  return { ok: errors.length === 0, applied, errors };
}
