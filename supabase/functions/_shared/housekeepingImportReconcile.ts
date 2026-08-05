// Apply pending housekeeping WA check-in signals after guest import (2026-08-05).
// Mirrors src/utils/housekeepingCheckInReconcile.js intent for Deno paths.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import { performSuiteCheckIn } from "./suiteCheckinSync.ts";

const HK_ELIGIBLE_STATUSES = new Set(["pending", "expected", "room_ready"]);
const HK_CHECKIN_SUCCESS_ACTIONS = new Set(["updated", "already_checked_in"]);

type SuiteRoomRow = {
  room_display?: string | null;
  room_name?: string | null;
  suite_type?: string | null;
};

function collectGuestSuiteRoomIds(
  guest: { room?: string | null; suite_name?: string | null },
  suiteRows: SuiteRoomRow[] = [],
): string[] {
  const ids = new Set<string>();
  const push = (label: string | null | undefined, suiteType: string | null | undefined) => {
    const canon = resolveSuiteFromEzgoFields(String(label ?? ""), String(suiteType ?? ""), false);
    if (canon) ids.add(canon);
  };

  push(guest.room, guest.suite_name);
  for (const seg of String(guest.room ?? "").split(/\s*·\s*/)) {
    if (seg.trim()) push(seg.trim(), null);
  }
  for (const row of suiteRows) {
    push(row.room_display ?? row.room_name, row.suite_type);
  }
  return [...ids];
}

function indexHkByRoom(
  events: Array<{ room_id?: string | null; created_at?: string | null; sync_action?: string | null; id?: string }>,
): Record<string, typeof events[0]> {
  const byRoom: Record<string, typeof events[0]> = {};
  const sorted = [...events].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );
  for (const evt of sorted) {
    const roomId = String(evt.room_id ?? "").trim();
    if (!roomId || byRoom[roomId]) continue;
    byRoom[roomId] = evt;
  }
  return byRoom;
}

async function fetchTodayCheckInEvents(
  supabase: ReturnType<typeof createClient>,
  dateYmd: string,
) {
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
    console.warn("[housekeepingImportReconcile] fetch failed:", error.message);
    return [];
  }
  return data ?? [];
}

export async function reconcileGuestHousekeepingCheckInAfterImport(
  supabase: ReturnType<typeof createClient>,
  guestId: number,
): Promise<{ applied: boolean; roomId?: string; guestPatch?: Record<string, unknown> }> {
  const { data: guest, error: gErr } = await supabase
    .from("guests")
    .select("id, name, phone, room, suite_name, status, guest_notes, arrival_date, departure_date")
    .eq("id", guestId)
    .maybeSingle();
  if (gErr || !guest) return { applied: false };

  if (guest.status === "checked_in") return { applied: false };
  if (!HK_ELIGIBLE_STATUSES.has(String(guest.status ?? ""))) return { applied: false };

  const { data: suiteRows } = await supabase
    .from("suite_rooms")
    .select("room_display, room_name, suite_type")
    .eq("guest_id", guestId);

  const roomIds = collectGuestSuiteRoomIds(guest, (suiteRows ?? []) as SuiteRoomRow[]);
  if (!roomIds.length) return { applied: false };

  const today = israelYmd(new Date());
  const hkEvents = await fetchTodayCheckInEvents(supabase, today);
  const hkByRoom = indexHkByRoom(hkEvents);

  let matchedRoomId: string | null = null;
  let matchedEvent: (typeof hkEvents)[0] | null = null;
  for (const rid of roomIds) {
    if (hkByRoom[rid]) {
      matchedRoomId = rid;
      matchedEvent = hkByRoom[rid];
      break;
    }
  }
  if (!matchedRoomId || !matchedEvent) return { applied: false };

  // QA P2 2026-08-05 (parity with src/utils/housekeepingCheckInReconcile.js's
  // "logged_success_guest_stale" guard): this room's HK check-in signal may
  // have already resolved successfully to a DIFFERENT guest_id — applying it
  // again here on a freshly-imported guest would silently check in the wrong
  // person. This whole function runs unattended (post-import hook, no staff
  // click at all), so skip rather than guess; the GuestsPage sync chip still
  // offers the guest a manual "⚠️ סנכרן מקבוצה" confirmation separately.
  if (
    matchedEvent.guest_id != null
    && matchedEvent.guest_id !== guestId
    && matchedEvent.sync_action
    && HK_CHECKIN_SUCCESS_ACTIONS.has(matchedEvent.sync_action)
  ) {
    return { applied: false };
  }

  const sync = await performSuiteCheckIn(supabase, guest, {
    roomId: matchedRoomId,
    auditSource: "צ'ק-אין מקבוצת ניקיון (סנכרון אחרי ייבוא)",
  });
  if (!sync.ok) return { applied: false };

  if (matchedEvent.id) {
    await supabase
      .from("housekeeping_wa_events")
      .update({
        sync_action: "updated",
        sync_error: null,
        guest_id: guestId,
      })
      .eq("id", matchedEvent.id);
  }

  return { applied: true, roomId: matchedRoomId, guestPatch: sync.guestPatch };
}
