// Apply a housekeeping "room ready" signal → room_status gate that AICopilot listens on.
// Turnover lifecycle (WA group + UI):
//   Co N        → guests.checked_out + room_status.לניקיון
//   N✅ / מוכן  → room_status.ממתין לאישור (bell only — guests stays pending/expected)
//   AICopilot   → room_ready WA + guests.room_ready + room_status.פנוי
//   N צק אין    → guests.checked_in + room_status.תפוס
// Does NOT set guests.room_ready — manager approval is the guest-profile step.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import { findArrivingTodayGuestForSuite, findActiveGuestForSuite } from "./housekeepingGuestLookup.ts";
import { notifyRoomPendingApproval } from "./roomPendingApprovalPush.ts";

export type HousekeepingReadyAction =
  | "updated"
  | "already_pending"
  | "skipped_occupied"
  | "dedup"
  | "skipped_no_suite"
  | "error";

export interface HousekeepingReadyResult {
  ok: boolean;
  roomNumber: number;
  roomId: string | null;
  guestId: number | null;
  guestName: string | null;
  action: HousekeepingReadyAction;
  error?: string;
}

export interface HousekeepingReadyAckItem {
  roomId: string;
  guestName?: string | null;
}

/** One line per suite — in-group ack after ממתין לאישור fires. */
export function buildHousekeepingGroupAckMessage(items: HousekeepingReadyAckItem[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const { roomId, guestName } of items) {
    const id = String(roomId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const guestPart = guestName?.trim() ? ` — אורח: ${guestName.trim()}` : "";
    lines.push(`✅ ${id} מוכן${guestPart} — ממתין לאישור מנהל לשליחת הודעה 🔔`);
  }
  return lines.join("\n");
}

/** In-group ack when room is occupied by a continuing-stay guest — skip bell. */
export function buildHousekeepingReadySkippedOccupiedLine(result: HousekeepingReadyResult): string | null {
  if (result.action !== "skipped_occupied" || !result.roomId) return null;
  const name = result.guestName?.trim();
  return `ℹ️ חדר ${result.roomId} — אורח במשך שהות${name ? ` (${name})` : ""} · לא נדרש מוכן מחדש`;
}

export async function applyHousekeepingReadySignal(
  supabase: ReturnType<typeof createClient>,
  opts: {
    roomNumber: number;
    waMessageId: string;
    sourceLine?: string;
    fromPhone?: string | null;
    fromName?: string | null;
    profileId?: string | null;
  },
): Promise<HousekeepingReadyResult> {
  const { roomNumber, waMessageId, sourceLine } = opts;
  const roomId = resolveSuiteFromEzgoFields(String(roomNumber), "", false);

  if (!roomId) {
    console.warn(`[housekeepingReadySignal] no suite mapping for room number ${roomNumber}`);
    return {
      ok: false, roomNumber, roomId: null, guestId: null, guestName: null,
      action: "skipped_no_suite",
    };
  }

  const { error: dedupErr } = await supabase.from("housekeeping_wa_events").insert({
    wa_message_id: waMessageId,
    room_number: roomNumber,
    room_id: roomId,
    event_type: "ready",
    source_line: sourceLine?.slice(0, 500) ?? null,
    from_phone: opts.fromPhone ?? null,
    from_name: opts.fromName ?? null,
    profile_id: opts.profileId ?? null,
  });

  if (dedupErr) {
    if (dedupErr.code === "23505") {
      return {
        ok: true, roomNumber, roomId, guestId: null, guestName: null, action: "dedup",
      };
    }
    console.error("[housekeepingReadySignal] dedup insert failed:", dedupErr.message);
    return {
      ok: false, roomNumber, roomId, guestId: null, guestName: null,
      action: "error", error: dedupErr.message,
    };
  }

  const inStay = await findActiveGuestForSuite(supabase, roomId);
  if (inStay?.status === "checked_in") {
    return {
      ok: true,
      roomNumber,
      roomId,
      guestId: inStay.id,
      guestName: inStay.name,
      action: "skipped_occupied",
    };
  }

  const guest = await findArrivingTodayGuestForSuite(supabase, roomId);
  const guestId = guest?.id ?? null;
  const guestName = guest?.name ?? null;

  const { data: existing } = await supabase
    .from("room_status")
    .select("status")
    .eq("room_id", roomId)
    .maybeSingle();

  if (existing?.status === "ממתין לאישור") {
    return {
      ok: true, roomNumber, roomId, guestId, guestName, action: "already_pending",
    };
  }

  const now = new Date().toISOString();
  const { error: upsertErr } = await supabase.from("room_status").upsert(
    {
      room_id: roomId,
      status: "ממתין לאישור",
      room_clean_status: "clean",
      jacuzzi_status: "clean",
      cleaning_started_at: null,
      cleaning_ended_at: now,
      updated_at: now,
    },
    { onConflict: "room_id" },
  );

  if (upsertErr) {
    console.error(`[housekeepingReadySignal] room_status upsert failed for ${roomId}:`, upsertErr.message);
    return {
      ok: false, roomNumber, roomId, guestId, guestName,
      action: "error", error: upsertErr.message,
    };
  }

  await notifyRoomPendingApproval(supabase, roomId, { source: "housekeeping_wa" });
  console.log(
    `[housekeepingReadySignal] ${roomId} (#${roomNumber}) → ממתין לאישור` +
    (guestName ? ` guest=${guestName}` : " no_guest_today") +
    ` (wa=${waMessageId})`,
  );

  return {
    ok: true, roomNumber, roomId, guestId, guestName, action: "updated",
  };
}
