// supabase/functions/room-clean-notify/index.ts
// Legacy tablet path: room בניקיון → פנוי. Uses shared guest lookup (multi-room safe).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findArrivingTodayGuestForSuite } from "../_shared/housekeepingGuestLookup.ts";

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
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const guest = await findArrivingTodayGuestForSuite(supabase, String(room_id).trim());
    if (!guest?.id) {
      return new Response(
        JSON.stringify({ ok: true, notified: false, reason: "no guest arriving today in room" }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const waResp = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
      body: JSON.stringify({
        trigger: "room_ready",
        guestId: guest.id,
        roomId: String(room_id).trim(),
      }),
    });

    const waResult = await waResp.json().catch(() => ({})) as Record<string, unknown>;
    const notified = waResp.ok || waResult?.ok === true;

    return new Response(
      JSON.stringify({ ok: true, notified, guest: { name: guest.name } }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
