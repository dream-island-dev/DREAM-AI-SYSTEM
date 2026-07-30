// Housekeeping group "צ'ק אין" → guests.checked_in + room_status.תפוס (§0.5).
// Same-day turnover: if outgoing guest is checked_in (departure ≤ today) and a new
// guest arrives today, auto check-out the old guest then check-in the new one.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import {
  findActiveGuestForSuite,
  findIncomingGuestForSuiteCheckIn,
  findInHouseDepartingGuestForSuite,
} from "./housekeepingGuestLookup.ts";
import { CHECKIN_ELIGIBLE_STATUSES, shouldHousekeepingTurnover } from "./housekeepingLifecycle.ts";
import { applyHousekeepingCheckOutSignal } from "./housekeepingCheckOutSignal.ts";
import { performSuiteCheckIn } from "./suiteCheckinSync.ts";

export type HousekeepingCheckInAction =
  | "updated"
  | "already_checked_in"
  | "dedup"
  | "skipped_no_suite"
  | "no_guest"
  | "guest_not_eligible"
  | "error";

export interface HousekeepingCheckInResult {
  ok: boolean;
  roomNumber: number;
  roomId: string | null;
  guestId: number | null;
  guestName: string | null;
  previousGuestId?: number | null;
  previousGuestName?: string | null;
  action: HousekeepingCheckInAction;
  error?: string;
}

export function buildHousekeepingCheckInAckLine(result: HousekeepingCheckInResult): string | null {
  const { roomId, guestName, action } = result;
  if (!roomId) return null;
  switch (action) {
    case "updated":
      return `✅ חדר ${roomId} — צ'ק-אין נקלט${guestName ? ` (${guestName})` : ""}`;
    case "already_checked_in":
      return `ℹ️ חדר ${roomId} — כבר מסומן כצ'ק-אין${guestName ? ` (${guestName})` : ""}`;
    case "no_guest":
      return `⚠️ חדר ${roomId} — צ'ק-אין: לא נמצא אורח פעיל בחדר`;
    case "guest_not_eligible":
      return `⚠️ חדר ${roomId} — אורח${guestName ? ` ${guestName}` : ""} לא במצב צ'ק-אין (סטטוס לא מתאים)`;
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

  const today = israelYmd(new Date());
  const [incoming, outgoing] = await Promise.all([
    findIncomingGuestForSuiteCheckIn(supabase, roomId),
    findInHouseDepartingGuestForSuite(supabase, roomId),
  ]);

  if (shouldHousekeepingTurnover(incoming, outgoing, today)) {
    const senderOpts = {
      fromPhone: opts.fromPhone ?? null,
      fromName: opts.fromName ?? null,
      profileId: opts.profileId ?? null,
    };

    // Implicit Co — same pipeline as explicit checkout (audit row, checkout, survey queue).
    const coResult = await applyHousekeepingCheckOutSignal(supabase, {
      roomNumber,
      waMessageId,
      sourceLine: sourceLine?.slice(0, 500) ?? null,
      ...senderOpts,
    });
    if (
      !coResult.ok &&
      coResult.action !== "already_checked_out"
    ) {
      return {
        ok: false,
        roomNumber,
        roomId,
        guestId: incoming!.id,
        guestName: incoming!.name,
        previousGuestId: outgoing!.id,
        previousGuestName: outgoing!.name,
        action: "error",
        error: coResult.error ?? `checkout_failed:${coResult.action}`,
      };
    }

    const ciSync = await performSuiteCheckIn(supabase, incoming!, {
      roomId,
      auditSource: "צ'ק-אין מקבוצת ניקיון (WhatsApp)",
    });
    if (!ciSync.ok) {
      return {
        ok: false,
        roomNumber,
        roomId,
        guestId: incoming!.id,
        guestName: incoming!.name,
        previousGuestId: outgoing!.id,
        previousGuestName: outgoing!.name,
        action: "error",
        error: ciSync.error,
      };
    }

    console.log(
      `[housekeepingCheckIn] ${roomId} (#${roomNumber}) implicit_co out=${outgoing!.id} ` +
      `(${outgoing!.name}) in=${incoming!.id} (${incoming!.name}) co_action=${coResult.action}`,
    );

    return {
      ok: true,
      roomNumber,
      roomId,
      guestId: incoming!.id,
      guestName: incoming!.name,
      previousGuestId: outgoing!.id,
      previousGuestName: outgoing!.name,
      action: "updated",
    };
  }

  const guest = incoming ?? await findActiveGuestForSuite(supabase, roomId);
  if (!guest) {
    return { ok: false, roomNumber, roomId, guestId: null, guestName: null, action: "no_guest" };
  }

  if (guest.status === "checked_in") {
    const now = new Date().toISOString();
    const { error: roomErr } = await supabase.from("room_status").upsert(
      { room_id: roomId, status: "תפוס", updated_at: now },
      { onConflict: "room_id" },
    );
    if (roomErr) {
      console.warn(
        `[housekeepingCheckIn] already_checked_in — room_status sync failed for ${roomId}:`,
        roomErr.message,
      );
    } else {
      console.log(
        `[housekeepingCheckIn] ${roomId} (#${roomNumber}) guest=${guest.id} — already_checked_in, room_status→תפוס`,
      );
    }
    return {
      ok: true, roomNumber, roomId, guestId: guest.id, guestName: guest.name, action: "already_checked_in",
    };
  }

  if (!CHECKIN_ELIGIBLE_STATUSES.has(guest.status)) {
    return {
      ok: false,
      roomNumber,
      roomId,
      guestId: guest.id,
      guestName: guest.name,
      action: "guest_not_eligible",
    };
  }

  const sync = await performSuiteCheckIn(supabase, guest, {
    roomId,
    auditSource: "צ'ק-אין מקבוצת ניקיון (WhatsApp)",
  });

  if (!sync.ok) {
    return {
      ok: false, roomNumber, roomId, guestId: guest.id, guestName: guest.name,
      action: "error", error: sync.error,
    };
  }

  console.log(`[housekeepingCheckIn] ${roomId} (#${roomNumber}) guest=${guest.id} → checked_in`);

  return {
    ok: true, roomNumber, roomId, guestId: guest.id, guestName: guest.name, action: "updated",
  };
}
