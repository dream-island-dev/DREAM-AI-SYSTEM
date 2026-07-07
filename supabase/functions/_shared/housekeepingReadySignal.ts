// Apply a housekeeping "room ready" signal → room_status gate that AICopilot listens on.
// Mirrors HousekeepingTabletView finishRoomClean/markClean. whapi-webhook sends a
// short in-group ack only when status actually advances to ממתין לאישור (action=updated).

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSuiteFromEzgoFields } from "./guestRoomResolve.ts";

export type HousekeepingReadyAction =
  | "updated"
  | "already_pending"
  | "dedup"
  | "skipped_no_suite"
  | "error";

export interface HousekeepingReadyResult {
  ok: boolean;
  roomNumber: number;
  roomId: string | null;
  action: HousekeepingReadyAction;
  error?: string;
}

/** One line per suite — sent to the housekeeping group after a fresh bell trigger. */
export function buildHousekeepingGroupAckMessage(roomIds: string[]): string {
  const unique = [...new Set(roomIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  return unique
    .map((id) => `✅ חדר ${id} מוכן — נשלחה התראה לשליחת הודעה לאורח 🔔`)
    .join("\n");
}

async function notifyManagerPendingApproval(roomId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;

  try {
    const pushResp = await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        department: "הנהלה",
        title: "🔔 סוויטה מוכנה לאישור",
        body: `${roomId} — אות מוכנות מקבוצת ניקיון. אשר שליחת הודעה לאורח וצ'ק-אין.`,
        url: "/",
        tag: `room-pending-${roomId}`,
      }),
    });
    if (!pushResp.ok) {
      console.warn(`[housekeepingReadySignal] push-notify HTTP ${pushResp.status} for ${roomId}`);
    }
  } catch (e) {
    console.warn(`[housekeepingReadySignal] push-notify failed for ${roomId}:`, (e as Error).message);
  }
}

export async function applyHousekeepingReadySignal(
  supabase: ReturnType<typeof createClient>,
  opts: { roomNumber: number; waMessageId: string; sourceLine?: string },
): Promise<HousekeepingReadyResult> {
  const { roomNumber, waMessageId, sourceLine } = opts;
  const roomId = resolveSuiteFromEzgoFields(String(roomNumber), "", false);

  if (!roomId) {
    console.warn(`[housekeepingReadySignal] no suite mapping for room number ${roomNumber}`);
    return { ok: false, roomNumber, roomId: null, action: "skipped_no_suite" };
  }

  const { error: dedupErr } = await supabase.from("housekeeping_wa_events").insert({
    wa_message_id: waMessageId,
    room_number: roomNumber,
    room_id: roomId,
    event_type: "ready",
    source_line: sourceLine?.slice(0, 500) ?? null,
  });

  if (dedupErr) {
    if (dedupErr.code === "23505") {
      return { ok: true, roomNumber, roomId, action: "dedup" };
    }
    console.error("[housekeepingReadySignal] dedup insert failed:", dedupErr.message);
    return { ok: false, roomNumber, roomId, action: "error", error: dedupErr.message };
  }

  const { data: existing } = await supabase
    .from("room_status")
    .select("status")
    .eq("room_id", roomId)
    .maybeSingle();

  if (existing?.status === "ממתין לאישור") {
    return { ok: true, roomNumber, roomId, action: "already_pending" };
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
    return { ok: false, roomNumber, roomId, action: "error", error: upsertErr.message };
  }

  await notifyManagerPendingApproval(roomId);
  console.log(`[housekeepingReadySignal] ${roomId} (#${roomNumber}) → ממתין לאישור (wa=${waMessageId})`);

  return { ok: true, roomNumber, roomId, action: "updated" };
}
