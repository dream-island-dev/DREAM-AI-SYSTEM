// Staff manual spa upsell lead from Inbox — insert guest_alerts + Whapi group notify.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createManualSpaUpsellLead } from "../_shared/spaUpsellAcceptance.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const body = await req.json() as Record<string, unknown>;
    const guestId = Number(body.guest_id);
    const phone = String(body.phone ?? "").trim();
    const message = String(body.message ?? "").trim();
    const conversationId = body.conversation_id != null ? Number(body.conversation_id) : null;
    const alertTypeRaw = String(body.alert_type ?? "spa_upsell_accept").trim();
    const alertType = alertTypeRaw === "spa_request" ? "spa_request" : "spa_upsell_accept";

    if (!guestId || !phone) throw new Error("guest_id and phone are required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: guest, error: guestErr } = await admin
      .from("guests")
      .select("id, name, phone, room, arrival_date")
      .eq("id", guestId)
      .maybeSingle();
    if (guestErr) throw guestErr;
    if (!guest) throw new Error("guest_not_found");

    const result = await createManualSpaUpsellLead(admin, {
      guestId,
      phone: String(guest.phone ?? phone),
      guestName: guest.name,
      room: guest.room,
      arrivalDate: guest.arrival_date,
      message,
      conversationId: Number.isFinite(conversationId) ? conversationId : null,
      sourceLabel: "Inbox (ידני)",
      alertType,
    });

    if (!result.ok) {
      return new Response(JSON.stringify(result), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, alreadyExists: result.alreadyExists ?? false }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
