// supabase/functions/room-pending-approval-notify/index.ts
// Called when Housekeeping Tablet marks both room + jacuzzi clean → status
// "ממתין לאישור". Validates DB state, then Web Push to הנהלה managers so
// AICopilot approval is not missed when no manager has the app open.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { room_id } = (await req.json()) as { room_id?: string };
    if (!room_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "room_id required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: room } = await supabase
      .from("room_status")
      .select("status, room_clean_status, jacuzzi_status")
      .eq("room_id", room_id)
      .maybeSingle();

    if (!room || room.status !== "ממתין לאישור") {
      return new Response(
        JSON.stringify({ ok: true, notified: false, reason: "not_pending_approval" }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

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
        body: `${room_id} — חדר וג'קוזי נקיים. אשר שליחת הודעה לאורח וצ'ק-אין.`,
        url: "/",
        tag: `room-pending-${room_id}`,
      }),
    });

    const pushResult = await pushResp.json().catch(() => ({}));
    console.log(`[room-pending-approval-notify] ${room_id} push:`, pushResult);

    return new Response(
      JSON.stringify({ ok: true, notified: true, push: pushResult }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
