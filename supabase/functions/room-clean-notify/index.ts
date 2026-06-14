// supabase/functions/room-clean-notify/index.ts
// Called after a room transitions from "בניקיון" → "פנוי".
// Looks up the room's current or arriving guest and fires a room_ready WA notification.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { room_id } = (await req.json()) as { room_id: string };
    if (!room_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "room_id required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase    = createClient(supabaseUrl, serviceKey);

    // Find the current checked-in guest, or today's arriving guest in this room
    const today = new Date().toISOString().split("T")[0];
    const { data: guest } = await supabase
      .from("guests")
      .select("id, name, phone")
      .eq("room", String(room_id))
      .or(`status.eq.checked_in,status.eq.room_ready,and(status.eq.upcoming,arrival_date.eq.${today})`)
      .maybeSingle();

    if (!guest) {
      return new Response(
        JSON.stringify({ ok: true, notified: false, reason: "no current guest in room" }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Trigger the room_ready WhatsApp template via whatsapp-send
    const waResp = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey":        serviceKey,
      },
      body: JSON.stringify({ trigger: "room_ready", guestId: guest.id }),
    });

    const waResult = await waResp.json().catch(() => ({})) as Record<string, unknown>;
    const notified = waResp.ok || waResult?.ok === true;

    return new Response(
      JSON.stringify({ ok: true, notified, guest: { name: guest.name } }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
