// Housekeeping group "Co N" / "N co" → guests.checked_out + room_status.לניקיון.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import { findDepartingGuestForSuite } from "./housekeepingGuestLookup.ts";

export type HousekeepingCheckOutAction =
  | "updated"
  | "already_checked_out"
  | "dedup"
  | "skipped_no_suite"
  | "no_guest"
  | "error";

export interface HousekeepingCheckOutResult {
  ok: boolean;
  roomNumber: number;
  roomId: string | null;
  guestId: number | null;
  guestName: string | null;
  action: HousekeepingCheckOutAction;
  error?: string;
}

function auditLine(text: string): string {
  const ts = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour12: false });
  return `[${ts}] ${text}`;
}

export function buildHousekeepingCheckOutAckLine(result: HousekeepingCheckOutResult): string | null {
  const { roomId, guestName, action } = result;
  if (!roomId) return null;
  switch (action) {
    case "updated":
      return `✅ חדר ${roomId} — צ'ק-אאוט נקלט${guestName ? ` (${guestName})` : ""} · חדר לניקיון`;
    case "already_checked_out":
      return `ℹ️ חדר ${roomId} — כבר מסומן כצ'ק-אאוט`;
    case "no_guest":
      return `⚠️ חדר ${roomId} — צ'ק-אאוט: לא נמצא אורח שעוזב היום בחדר`;
    default:
      return null;
  }
}

export async function applyHousekeepingCheckOutSignal(
  supabase: ReturnType<typeof createClient>,
  opts: { roomNumber: number; waMessageId: string; sourceLine?: string },
): Promise<HousekeepingCheckOutResult> {
  const { roomNumber, waMessageId, sourceLine } = opts;
  const roomId = resolveSuiteFromEzgoFields(String(roomNumber), "", false);

  if (!roomId) {
    return { ok: false, roomNumber, roomId: null, guestId: null, guestName: null, action: "skipped_no_suite" };
  }

  const { error: dedupErr } = await supabase.from("housekeeping_wa_events").insert({
    wa_message_id: waMessageId,
    room_number: roomNumber,
    room_id: roomId,
    event_type: "check_out",
    source_line: sourceLine?.slice(0, 500) ?? null,
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

  const guest = await findDepartingGuestForSuite(supabase, roomId);
  if (!guest) {
    return { ok: false, roomNumber, roomId, guestId: null, guestName: null, action: "no_guest" };
  }

  if (guest.status === "checked_out") {
    return {
      ok: true, roomNumber, roomId, guestId: guest.id, guestName: guest.name, action: "already_checked_out",
    };
  }

  const now = new Date().toISOString();
  const prevNotes = String(guest.guest_notes ?? "").trim();
  const note = prevNotes
    ? `${prevNotes}\n${auditLine("צ'ק-אאוט מקבוצת ניקיון (WhatsApp)")}`
    : auditLine("צ'ק-אאוט מקבוצת ניקיון (WhatsApp)");

  // Same guest patch as whatsapp-cron auto_checkout / GuestsPage reception sync.
  const { error: guestErr } = await supabase.from("guests").update({
    status: "checked_out",
    room_ready_notified: false,
    msg_room_ready_sent: false,
    room_ready_at: null,
    guest_notes: note,
  }).eq("id", guest.id);

  if (guestErr) {
    return {
      ok: false, roomNumber, roomId, guestId: guest.id, guestName: guest.name,
      action: "error", error: guestErr.message,
    };
  }

  // Release occupied → start turnover cycle (RoomBoard תפוס → לניקיון).
  const { error: roomErr } = await supabase.from("room_status").upsert(
    { room_id: roomId, status: "לניקיון", updated_at: now },
    { onConflict: "room_id" },
  );
  if (roomErr) {
    console.warn(`[housekeepingCheckOut] room_status upsert failed for ${roomId}:`, roomErr.message);
  }

  console.log(`[housekeepingCheckOut] ${roomId} (#${roomNumber}) guest=${guest.id} → checked_out + לניקיון`);

  return {
    ok: true, roomNumber, roomId, guestId: guest.id, guestName: guest.name, action: "updated",
  };
}
