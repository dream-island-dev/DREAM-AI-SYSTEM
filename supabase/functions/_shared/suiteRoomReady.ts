// Per-room room_ready idempotency on suite_rooms (multi-room same guest/phone).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { guestRoomMatchesSuiteId, resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";

export interface SuiteRoomReadyRow {
  id: number;
  guest_id: number | null;
  order_number: string | null;
  room_display: string | null;
  room_name: string | null;
  suite_type: string | null;
  room_ready_notified: boolean | null;
  msg_room_ready_sent: boolean | null;
}

function normalizeRoomLabel(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function rowCanonicalLabel(r: SuiteRoomReadyRow): string {
  const display = normalizeRoomLabel(r.room_display);
  if (display) return display;
  const resolved = normalizeRoomLabel(
    resolveSuiteFromEzgoFields(r.room_name, r.suite_type),
  );
  return resolved || normalizeRoomLabel(r.room_name) || normalizeRoomLabel(r.suite_type);
}

/** Resolve the suite_rooms row for a room_ready send (by canonical room label). */
export async function findSuiteRoomForGuestRoom(
  supabase: SupabaseClient,
  guestId: number,
  roomLabel: string,
): Promise<SuiteRoomReadyRow | null> {
  const target = normalizeRoomLabel(roomLabel);
  if (!target) return null;

  const { data, error } = await supabase
    .from("suite_rooms")
    .select(
      "id, guest_id, order_number, room_display, room_name, suite_type, room_ready_notified, msg_room_ready_sent",
    )
    .eq("guest_id", guestId);

  if (error) {
    console.warn("[suiteRoomReady] lookup failed:", error.message);
    return null;
  }

  const rows = (data ?? []) as SuiteRoomReadyRow[];
  const exact = rows.find((r) => rowCanonicalLabel(r) === target);
  if (exact) return exact;

  const fuzzy = rows.find((r) =>
    guestRoomMatchesSuiteId(
      { room: rowCanonicalLabel(r), suite_name: r.suite_type },
      target,
    )
  );
  return fuzzy ?? null;
}

export async function isSuiteRoomReadyAlreadySent(
  supabase: SupabaseClient,
  guestId: number,
  roomLabel: string,
): Promise<boolean> {
  const row = await findSuiteRoomForGuestRoom(supabase, guestId, roomLabel);
  if (!row) return false;
  return !!(row.room_ready_notified || row.msg_room_ready_sent);
}

export async function markSuiteRoomReadySent(
  supabase: SupabaseClient,
  guestId: number,
  roomLabel: string,
): Promise<void> {
  const row = await findSuiteRoomForGuestRoom(supabase, guestId, roomLabel);
  if (row?.id) {
    const canonical = rowCanonicalLabel(row);
    const patch: Record<string, unknown> = {
      room_ready_notified: true,
      msg_room_ready_sent: true,
    };
    if (canonical && !normalizeRoomLabel(row.room_display)) {
      patch.room_display = canonical;
    }
    const { error } = await supabase
      .from("suite_rooms")
      .update(patch)
      .eq("id", row.id);
    if (error) console.warn("[suiteRoomReady] suite_rooms update failed:", error.message);
    return;
  }

  console.warn(
    `[suiteRoomReady] no suite_rooms row for guest ${guestId} room "${roomLabel}" — guests flags only`,
  );
}

/** After any room_ready send, set guest aggregate flag only when all linked rooms are done. */
export async function syncGuestRoomReadyAggregate(
  supabase: SupabaseClient,
  guestId: number,
): Promise<void> {
  const { data: rows, error } = await supabase
    .from("suite_rooms")
    .select("room_ready_notified, msg_room_ready_sent")
    .eq("guest_id", guestId);

  if (error || !rows?.length) return;

  const allDone = rows.every(
    (r) => r.room_ready_notified === true || r.msg_room_ready_sent === true,
  );
  if (!allDone) return;

  await supabase
    .from("guests")
    .update({ room_ready_notified: true, msg_room_ready_sent: true, room_ready_at: new Date().toISOString() })
    .eq("id", guestId);
}
