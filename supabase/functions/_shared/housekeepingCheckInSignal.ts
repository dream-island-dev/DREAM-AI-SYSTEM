// Housekeeping group "צ'ק אין" → guests.checked_in + room_status.תפוס (§0.5).

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import { findActiveGuestForSuite } from "./housekeepingGuestLookup.ts";

export type HousekeepingCheckInAction =
  | "updated"
  | "already_checked_in"
  | "dedup"
  | "skipped_no_suite"
  | "no_guest"
  | "error";

export interface HousekeepingCheckInResult {
  ok: boolean;
  roomNumber: number;
  roomId: string | null;
  guestId: number | null;
  guestName: string | null;
  action: HousekeepingCheckInAction;
  error?: string;
}

function auditLine(text: string): string {
  const ts = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour12: false });
  return `[${ts}] ${text}`;
}

export function buildHousekeepingCheckInAckLine(result: HousekeepingCheckInResult): string | null {
  const { roomId, guestName, action } = result;
  if (!roomId) return null;
  switch (action) {
    case "updated":
      return `✅ חדר ${roomId} — צ'ק-אין נקלט${guestName ? ` (${guestName})` : ""}`;
    case "already_checked_in":
      return `ℹ️ חדר ${roomId} — כבר מסומן כצ'ק-אין`;
    case "no_guest":
      return `⚠️ חדר ${roomId} — צ'ק-אין: לא נמצא אורח פעיל בחדר`;
    default:
      return null;
  }
}

export async function applyHousekeepingCheckInSignal(
  supabase: ReturnType<typeof createClient>,
  opts: {
    roomNumber: number;
    waMessageId: string;
    sourceLine?: string;
    fromPhone?: string | null;
    fromName?: string | null;
    profileId?: string | null;
  },
): Promise<HousekeepingCheckInResult> {
  const { roomNumber, waMessageId, sourceLine } = opts;
  const roomId = resolveSuiteFromEzgoFields(String(roomNumber), "", false);

  if (!roomId) {
    return { ok: false, roomNumber, roomId: null, guestId: null, guestName: null, action: "skipped_no_suite" };
  }

  const { error: dedupErr } = await supabase.from("housekeeping_wa_events").insert({
    wa_message_id: waMessageId,
    room_number: roomNumber,
    room_id: roomId,
    event_type: "check_in",
    source_line: sourceLine?.slice(0, 500) ?? null,
    from_phone: opts.fromPhone ?? null,
    from_name: opts.fromName ?? null,
    profile_id: opts.profileId ?? null,
  });

  if (dedupErr) {
    if (dedupErr.code === "23505") {
      return { ok: true, roomNumber, roomId, guestId: null, guestName: null, action: "dedup" };
    }
    return {
      ok: false, roomNumber, roomId, guestId: null, guestName: null,
      action: "error", error: dedupErr.message,
    };
  }

  const guest = await findActiveGuestForSuite(supabase, roomId);
  if (!guest) {
    return { ok: false, roomNumber, roomId, guestId: null, guestName: null, action: "no_guest" };
  }

  if (guest.status === "checked_in") {
    return {
      ok: true, roomNumber, roomId, guestId: guest.id, guestName: guest.name, action: "already_checked_in",
    };
  }

  const now = new Date().toISOString();
  const prevNotes = String(guest.guest_notes ?? "").trim();
  const note = prevNotes
    ? `${prevNotes}\n${auditLine("צ'ק-אין מקבוצת ניקיון (WhatsApp)")}`
    : auditLine("צ'ק-אין מקבוצת ניקיון (WhatsApp)");

  const { error: guestErr } = await supabase.from("guests").update({
    status: "checked_in",
    checkin_time: now,
    guest_notes: note,
  }).eq("id", guest.id);

  if (guestErr) {
    return {
      ok: false, roomNumber, roomId, guestId: guest.id, guestName: guest.name,
      action: "error", error: guestErr.message,
    };
  }

  const { error: roomErr } = await supabase.from("room_status").upsert(
    { room_id: roomId, status: "תפוס", updated_at: now },
    { onConflict: "room_id" },
  );
  if (roomErr) {
    console.warn(`[housekeepingCheckIn] room_status upsert failed for ${roomId}:`, roomErr.message);
  }

  console.log(`[housekeepingCheckIn] ${roomId} (#${roomNumber}) guest=${guest.id} → checked_in`);

  return {
    ok: true, roomNumber, roomId, guestId: guest.id, guestName: guest.name, action: "updated",
  };
}
