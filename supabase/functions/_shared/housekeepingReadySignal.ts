// Apply a housekeeping "room ready" signal → room_status gate that AICopilot listens on.
// Turnover lifecycle (WA group + UI):
//   Co N        → guests.checked_out + room_status.לניקיון
//   N✅ / מוכן  → ממתין לאישור only when a guest arrives TODAY; else פנוי (no bell)
//   AICopilot   → room_ready WA + guests.room_ready + room_status.פנוי
//   N צק אין    → guests.checked_in + room_status.תפוס
// Does NOT set guests.room_ready — manager approval is the guest-profile step.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";
import { findArrivingTodayGuestForSuite, findActiveGuestForSuite } from "./housekeepingGuestLookup.ts";
import { notifyRoomPendingApproval } from "./roomPendingApprovalPush.ts";

export type HousekeepingReadyAction =
  | "updated"
  | "already_pending"
  | "skipped_occupied"
  | "skipped_future_arrival"
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

/** Genuine failure/uncertainty actions. As of 2026-08-05 these no longer bypass
 * HOUSEKEEPING_WA_GROUP_REPLY to post in the group (Mike: the HK group is
 * receive-only, zero exceptions) — whapi-webhook uses this set only to decide what
 * gets a console.warn when the group stays silent. See housekeepingAckSelect.ts. */
export const HOUSEKEEPING_READY_PROBLEM_ACTIONS: ReadonlySet<HousekeepingReadyAction> = new Set([
  "skipped_no_suite",
  "error",
]);

/** Per-room in-group ack after ready signal — short, all sync outcomes. */
export function buildHousekeepingReadyAckLine(result: HousekeepingReadyResult): string | null {
  const { roomNumber, roomId, guestName, action } = result;
  if (action === "skipped_no_suite") {
    return `⚠️ מספר חדר #${roomNumber} לא מוכר במערכת — סטטוס "מוכן" לא נקלט, בדקו את המספר`;
  }
  if (!roomId) return null;
  const guestPart = guestName?.trim() ? ` — אורח: ${guestName.trim()}` : "";
  switch (action) {
    case "updated":
      return `✅ ${roomId} מוכן${guestPart} — ממתין לאישור מנהל 🔔`;
    case "already_pending":
      return `ℹ️ ${roomId} — כבר ממתין לאישור`;
    case "skipped_occupied":
      const name = guestName?.trim();
      return `ℹ️ ${roomId} — אורח במשך שהות${name ? ` (${name})` : ""}`;
    case "skipped_future_arrival":
      return `ℹ️ ${roomId} — נקי ופנוי · אין אורח עם הגעה היום (הודעת מוכן תישלח ביום ההגעה)`;
    case "error":
      return `🚨 ${roomId} — שגיאת מערכת בסימון "מוכן". בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.`;
    case "dedup":
      // Duplicate WhatsApp delivery of an already-processed message — the first
      // attempt already handled it, not a drop. Intentionally silent.
      return null;
    default:
      return null;
  }
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

  const inStayPick = await findActiveGuestForSuite(supabase, roomId);
  const occupant = inStayPick.guest?.status === "checked_in" ? inStayPick.guest : null;

  // Same-day turnover: an occupant due out today (or overdue) who hasn't had
  // an explicit Co yet must not block today's arriving guest's ready bell —
  // mirrors the outgoing-guest check in shouldHousekeepingTurnover
  // (housekeepingLifecycle.ts), used by the check-in signal for the same gap.
  const today = israelYmd(new Date());
  const occupantLeavingToday = !!occupant?.departure_date && occupant.departure_date <= today;

  if (occupant && !occupantLeavingToday) {
    return {
      ok: true,
      roomNumber,
      roomId,
      guestId: occupant.id,
      guestName: occupant.name,
      action: "skipped_occupied",
    };
  }

  const arrivingPick = await findArrivingTodayGuestForSuite(supabase, roomId);

  if (occupant && !arrivingPick.guest) {
    // Leaving today but nobody arriving into this room today — nothing to
    // notify; same outcome as the old unconditional occupied-skip.
    return {
      ok: true,
      roomNumber,
      roomId,
      guestId: occupant.id,
      guestName: occupant.name,
      action: "skipped_occupied",
    };
  }
  const guest = arrivingPick.guest;
  const guestId = guest?.id ?? null;
  const guestName = guest?.name ?? null;

  const now = new Date().toISOString();
  const cleanRow = {
    room_id: roomId,
    room_clean_status: "clean" as const,
    jacuzzi_status: "clean" as const,
    cleaning_started_at: null,
    cleaning_ended_at: now,
    updated_at: now,
  };

  // Turnover before tomorrow's arrival — room is clean; no manager bell / room_ready WA.
  if (!guest) {
    const { error: vacantErr } = await supabase.from("room_status").upsert(
      { ...cleanRow, status: "פנוי" },
      { onConflict: "room_id" },
    );
    if (vacantErr) {
      console.error(`[housekeepingReadySignal] vacant upsert failed for ${roomId}:`, vacantErr.message);
      return {
        ok: false, roomNumber, roomId, guestId: null, guestName: null,
        action: "error", error: vacantErr.message,
      };
    }
    console.log(
      `[housekeepingReadySignal] ${roomId} (#${roomNumber}) → פנוי (no arriving-today guest, wa=${waMessageId})`,
    );
    return {
      ok: true, roomNumber, roomId, guestId: null, guestName: null, action: "skipped_future_arrival",
    };
  }

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

  const { error: upsertErr } = await supabase.from("room_status").upsert(
    {
      ...cleanRow,
      status: "ממתין לאישור",
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
    (guestName ? ` guest=${guestName}` : "") +
    ` (wa=${waMessageId})`,
  );

  return {
    ok: true, roomNumber, roomId, guestId, guestName, action: "updated",
  };
}
