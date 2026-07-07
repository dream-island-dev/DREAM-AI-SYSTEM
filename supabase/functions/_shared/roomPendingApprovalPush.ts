// Shared push when room_status → ממתין לאישור (tablet OR housekeeping WA).
// Includes live guest name from guests table at notify time.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findArrivingTodayGuestForSuite } from "./housekeepingGuestLookup.ts";

export async function notifyRoomPendingApproval(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  opts: { source?: string } = {},
): Promise<{ notified: boolean; guestName: string | null; reason?: string }> {
  const trimmed = String(roomId ?? "").trim();
  if (!trimmed) return { notified: false, guestName: null, reason: "no_room_id" };

  const { data: room } = await supabase
    .from("room_status")
    .select("status, room_clean_status, jacuzzi_status")
    .eq("room_id", trimmed)
    .maybeSingle();

  if (!room || room.status !== "ממתין לאישור") {
    return { notified: false, guestName: null, reason: "not_pending_approval" };
  }

  const guest = await findArrivingTodayGuestForSuite(supabase, trimmed);
  const guestName = guest?.name?.trim() || null;
  const guestLabel = guestName ? `${trimmed} — ${guestName}` : trimmed;
  const sourceNote = opts.source === "housekeeping_wa"
    ? "אות מקבוצת ניקיון"
    : "חדר וג'קוזי נקיים";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { notified: false, guestName, reason: "missing_secrets" };
  }

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
        body: `${guestLabel} — ${sourceNote}. אשר שליחת הודעה לאורח וצ'ק-אין.`,
        url: "/",
        tag: `room-pending-${trimmed}`,
      }),
    });
    if (!pushResp.ok) {
      console.warn(`[roomPendingApprovalPush] HTTP ${pushResp.status} for ${trimmed}`);
      return { notified: false, guestName, reason: `push_http_${pushResp.status}` };
    }
    return { notified: true, guestName };
  } catch (e) {
    console.warn(`[roomPendingApprovalPush] failed for ${trimmed}:`, (e as Error).message);
    return { notified: false, guestName, reason: "push_error" };
  }
}
