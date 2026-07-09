// supabase/functions/guest-portal-ops-request/index.ts
// Pre-Arrival Guest Portal — in-scroll room-service request dispatch.
//
// Guest tapping "הזמנת שירות לחדר" (Armonim scene) lands on the Requests Board
// (guest_alerts) + Whapi "בקשות אורחים" group — same channel as portal upsells,
// spa requests, and reception/financial guest asks. routing_config
// (migration 121) already marks portal_room_service → destination_board=requests.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onGuestAlertInserted } from "../_shared/guestAlertWhapiNotify.ts";

function futureArrivalTag(arrivalDateStr: string | null, status: string | null): string | null {
  if (!arrivalDateStr || status === "checked_in") return null;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const arrival = new Date(`${arrivalDateStr}T00:00:00Z`);
  const daysAway = Math.round((arrival.getTime() - today.getTime()) / 86400000);
  if (daysAway <= 0) return null;
  return `⚠️ בקשה עתידית לתאריך ${arrivalDateStr} - בעוד ${daysAway} ימים`;
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, upsellLabel } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");
    if (!upsellLabel || typeof upsellLabel !== "string") throw new Error("upsellLabel required");

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, room, arrival_date, status")
      .eq("portal_token", token)
      .maybeSingle();
    if (guestErr) throw new Error(`lookup_error: ${guestErr.message}`);
    if (!guest) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (!guest.phone) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_has_no_phone" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const tag = futureArrivalTag(guest.arrival_date as string | null, guest.status as string | null);
    const message = `[פורטל אורח — שירות לחדר${guest.room ? " — " + guest.room : ""}]${tag ? " [" + tag + "]" : ""} ${upsellLabel}${guest.name ? " — " + guest.name : ""}`.trim();

    const { data: alert, error: insErr } = await supabase
      .from("guest_alerts")
      .insert({
        guest_id:   guest.id,
        phone:      guest.phone,
        alert_type: "portal_room_service",
        message,
        resolved:   false,
      })
      .select("id")
      .maybeSingle();
    if (insErr) throw new Error(`alert_insert_error: ${insErr.message}`);

    onGuestAlertInserted(supabase, {
      guestId: guest.id as number,
      phone: guest.phone as string,
      message,
      alertType: "portal_room_service",
      guestName: guest.name as string | null,
      room: guest.room as string | null,
      sourceLabel: "Guest Portal",
      alsoPersonalDm: false,
    }).catch((e: Error) => console.warn("[guest-portal-ops-request] staff notify failed:", e.message));

    return new Response(
      JSON.stringify({ ok: true, alertId: alert?.id ?? null }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-ops-request] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
