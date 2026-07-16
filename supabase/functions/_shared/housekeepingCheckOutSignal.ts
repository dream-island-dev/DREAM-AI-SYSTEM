// Housekeeping group "Co N" / "N co" → guests.checked_out + room_status.לניקיון.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import {
  findActiveGuestForSuite,
  findDepartingGuestForSuite,
} from "./housekeepingGuestLookup.ts";
import { enqueueSuitePostCheckoutSurvey } from "./postCheckoutSurvey.ts";

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
  noGuestHint?: string;
  surveyQueued?: boolean;
  error?: string;
}

function auditLine(text: string): string {
  const ts = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour12: false });
  return `[${ts}] ${text}`;
}

async function upsertRoomToCleaning(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  now: string,
): Promise<void> {
  const { error: roomErr } = await supabase.from("room_status").upsert(
    { room_id: roomId, status: "לניקיון", updated_at: now },
    { onConflict: "room_id" },
  );
  if (roomErr) {
    console.warn(`[housekeepingCheckOut] room_status upsert failed for ${roomId}:`, roomErr.message);
  }
}

export function buildHousekeepingCheckOutAckLine(result: HousekeepingCheckOutResult): string | null {
  const { roomId, guestName, action, noGuestHint } = result;
  if (!roomId) return null;
  switch (action) {
    case "updated":
      return `✅ חדר ${roomId} — צ'ק-אאוט נקלט${guestName ? ` (${guestName})` : ""} · חדר לניקיון`;
    case "already_checked_out":
      return `ℹ️ חדר ${roomId} — כבר מסומן כצ'ק-אאוט · חדר לניקיון`;
    case "no_guest":
      return noGuestHint
        ? `⚠️ חדר ${roomId} — לא נמצא אורח שעוזב היום. ${noGuestHint}`
        : `⚠️ חדר ${roomId} — צ'ק-אאוט: לא נמצא אורח שעוזב היום בחדר`;
    default:
      return null;
  }
}

export async function applyHousekeepingCheckOutSignal(
  supabase: ReturnType<typeof createClient>,
  opts: {
    roomNumber: number;
    waMessageId: string;
    sourceLine?: string;
    fromPhone?: string | null;
    fromName?: string | null;
    profileId?: string | null;
  },
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

  const guest = await findDepartingGuestForSuite(supabase, roomId);
  if (!guest) {
    const active = await findActiveGuestForSuite(supabase, roomId);
    const noGuestHint = active
      ? `בחדר: ${active.name ?? "—"} (סטטוס ${active.status}, עזיבה ${active.departure_date ?? "לא מוגדרת"})`
      : undefined;
    return {
      ok: false, roomNumber, roomId, guestId: null, guestName: null,
      action: "no_guest", noGuestHint,
    };
  }

  const now = new Date().toISOString();

  if (guest.status === "checked_out") {
    await upsertRoomToCleaning(supabase, roomId, now);
    const survey = await enqueueSuitePostCheckoutSurvey(supabase, {
      guestId: guest.id,
      roomId,
      source: "housekeeping_wa",
    });
    return {
      ok: true,
      roomNumber,
      roomId,
      guestId: guest.id,
      guestName: guest.name,
      action: "already_checked_out",
      surveyQueued: survey.queued,
    };
  }

  const prevNotes = String(guest.guest_notes ?? "").trim();
  const note = prevNotes
    ? `${prevNotes}\n${auditLine("צ'ק-אאוט מקבוצת ניקיון (WhatsApp)")}`
    : auditLine("צ'ק-אאוט מקבוצת ניקיון (WhatsApp)");

  const { error: guestErr } = await supabase.from("guests").update({
    status: "checked_out",
    checked_out_at: now,
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

  await upsertRoomToCleaning(supabase, roomId, now);

  const survey = await enqueueSuitePostCheckoutSurvey(supabase, {
    guestId: guest.id,
    roomId,
    source: "housekeeping_wa",
  });

  console.log(
    `[housekeepingCheckOut] ${roomId} (#${roomNumber}) guest=${guest.id} → checked_out + לניקיון survey=${survey.queued}`,
  );

  return {
    ok: true,
    roomNumber,
    roomId,
    guestId: guest.id,
    guestName: guest.name,
    action: "updated",
    surveyQueued: survey.queued,
  };
}
