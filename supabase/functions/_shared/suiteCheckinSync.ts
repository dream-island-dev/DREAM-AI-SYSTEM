// Unified check-in/check-out sync — guests.status + room_status (mirrors src/utils/suiteCheckinSync.js).

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function resolveGuestRoomId(guest: {
  room?: string | null;
  suite_name?: string | null;
}): string {
  return String(guest?.room ?? guest?.suite_name ?? "").trim();
}

function auditLine(text: string): string {
  const ts = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour12: false });
  return `[${ts}] ${text}`;
}

async function upsertRoomStatus(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = String(roomId ?? "").trim();
  if (!trimmed) return { ok: false, error: "missing room_id" };
  const now = new Date().toISOString();
  const { error } = await supabase.from("room_status").upsert(
    { room_id: trimmed, status, updated_at: now },
    { onConflict: "room_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface PerformSuiteCheckInResult {
  ok: boolean;
  guestPatch?: Record<string, unknown>;
  roomId?: string | null;
  roomStatus?: string | null;
  noRoomLinked?: boolean;
  error?: string;
  partial?: boolean;
}

/** Synced check-in: guests.checked_in + room_status.תפוס */
export async function performSuiteCheckIn(
  supabase: ReturnType<typeof createClient>,
  guest: {
    id: number;
    guest_notes?: string | null;
    room?: string | null;
    suite_name?: string | null;
    status?: string | null;
  },
  opts: {
    roomId?: string;
    auditSource?: string;
    skipRoomReadyMessage?: boolean;
  } = {},
): Promise<PerformSuiteCheckInResult> {
  if (!guest?.id) return { ok: false, error: "missing guest" };

  const roomId = opts.roomId ?? resolveGuestRoomId(guest);
  const now = new Date().toISOString();
  const guestPatch: Record<string, unknown> = {
    status: "checked_in",
    checkin_time: now,
  };

  if (opts.skipRoomReadyMessage) {
    guestPatch.room_ready_notified = true;
  }

  const auditSource = opts.auditSource ?? "צ'ק-אין מסונכרן";
  const prevNotes = String(guest.guest_notes ?? "").trim();
  guestPatch.guest_notes = prevNotes
    ? `${prevNotes}\n${auditLine(auditSource)}`
    : auditLine(auditSource);

  const { error: guestErr } = await supabase.from("guests").update(guestPatch).eq("id", guest.id);
  if (guestErr) return { ok: false, error: guestErr.message };

  if (!roomId) {
    return { ok: true, guestPatch, roomId: null, roomStatus: null, noRoomLinked: true };
  }

  const roomResult = await upsertRoomStatus(supabase, roomId, "תפוס");
  if (!roomResult.ok) {
    return { ok: false, error: roomResult.error, partial: true, guestPatch, roomId };
  }

  return {
    ok: true,
    guestPatch,
    roomId,
    roomStatus: "תפוס",
    noRoomLinked: false,
  };
}

export interface PerformSuiteCheckOutResult {
  ok: boolean;
  guestPatch?: Record<string, unknown>;
  roomId?: string | null;
  roomStatus?: string | null;
  noRoomLinked?: boolean;
  error?: string;
  partial?: boolean;
}

/** Room only — idempotent housekeeping Co when guest already checked_out. */
export async function syncRoomToCleaning(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<{ ok: boolean; error?: string }> {
  return upsertRoomStatus(supabase, roomId, "לניקיון");
}

/** Synced check-out: guests.checked_out + room_status.לניקיון */
export async function performSuiteCheckOut(
  supabase: ReturnType<typeof createClient>,
  guest: {
    id: number;
    guest_notes?: string | null;
    room?: string | null;
    suite_name?: string | null;
  },
  opts: {
    roomId?: string;
    auditSource?: string;
  } = {},
): Promise<PerformSuiteCheckOutResult> {
  if (!guest?.id) return { ok: false, error: "missing guest" };

  const roomId = opts.roomId ?? resolveGuestRoomId(guest);
  const now = new Date().toISOString();
  const auditSource = opts.auditSource ?? "צ'ק-אאוט מסונכרן";
  const prevNotes = String(guest.guest_notes ?? "").trim();
  const guestPatch: Record<string, unknown> = {
    status: "checked_out",
    checked_out_at: now,
    room_ready_notified: false,
    msg_room_ready_sent: false,
    room_ready_at: null,
    guest_notes: prevNotes
      ? `${prevNotes}\n${auditLine(auditSource)}`
      : auditLine(auditSource),
  };

  const { error: guestErr } = await supabase.from("guests").update(guestPatch).eq("id", guest.id);
  if (guestErr) return { ok: false, error: guestErr.message };

  if (!roomId) {
    return { ok: true, guestPatch, roomId: null, roomStatus: null, noRoomLinked: true };
  }

  const roomResult = await upsertRoomStatus(supabase, roomId, "לניקיון");
  if (!roomResult.ok) {
    return { ok: false, error: roomResult.error, partial: true, guestPatch, roomId };
  }

  return {
    ok: true,
    guestPatch,
    roomId,
    roomStatus: "לניקיון",
    noRoomLinked: false,
  };
}
