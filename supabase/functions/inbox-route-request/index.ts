// supabase/functions/inbox-route-request/index.ts
// Receptionist routes a guest conversation from DREAM BOT Inbox → Requests Board
// (guest_alerts) + immediate Whapi ping to the "בקשות אורחים" group (routing_config
// alert_inbox_routed) + personal DM to SLA_GUEST_ALERT_PHONE (duty manager).
//
// Mirrors notify-manual-task (ops/tasks) but for the Requests channel — staff
// judgment happens in the Inbox picker before dispatch; no LLM, no pending_approval.

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { onGuestAlertInserted } from "../_shared/guestAlertWhapiNotify.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      phone?: string;
      guestId?: number | null;
      guestName?: string | null;
      room?: string | null;
      subCategoryLabel?: string | null;
      note?: string | null;
      conversationId?: number | null;
      reporterProfileId?: string | null;
      rawGuestMessage?: string | null;
    };

    const phone = (body.phone ?? "").trim();
    if (!phone) {
      return new Response(JSON.stringify({ ok: false, error: "phone required" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const guestLabel = (body.guestName ?? "").trim() || "אורח";
    const definedText = [body.subCategoryLabel, body.note?.trim()].filter(Boolean).join(" — ");
    const context = definedText || (body.rawGuestMessage ?? "").slice(0, 280) || "בקשת אורח";
    const alertMessage = `[מתיבת וואטסאפ — ${guestLabel}] ${context}`.trim();

    const { data: alert, error: insErr } = await supabase
      .from("guest_alerts")
      .insert({
        guest_id:        body.guestId ?? null,
        phone,
        alert_type:      "request",
        message:         alertMessage,
        conversation_id: body.conversationId ?? null,
        resolved:        false,
      })
      .select("id")
      .maybeSingle();
    if (insErr) throw new Error(`alert_insert_error: ${insErr.message}`);

    if (body.guestId) {
      const { error: guestErr } = await supabase
        .from("guests")
        .update({
          requires_attention:       true,
          requires_attention_since: new Date().toISOString(),
          attention_reason:         "request",
        })
        .eq("id", body.guestId);
      if (guestErr) console.warn("[inbox-route-request] guest flag update failed:", guestErr.message);
    }

    let reporterName: string | null = null;
    const reporterId = body.reporterProfileId ?? authData.user.id;
    if (reporterId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", reporterId)
        .maybeSingle();
      reporterName = (profile?.name as string | undefined) ?? null;
    }

    const notifyMessage = reporterName
      ? `${alertMessage}\nRouted by: ${reporterName}`
      : alertMessage;

    const { groupNotified, personalNotified } = await onGuestAlertInserted(supabase, {
      phone,
      guestId:        body.guestId ?? null,
      conversationId: body.conversationId ?? null,
      message:        notifyMessage,
      alertType:      "request",
      guestName:      body.guestName ?? null,
      room:           body.room ?? null,
      sourceLabel:    "Inbox",
      alsoPersonalDm: true,
    }).catch((e: Error) => {
      console.warn("[inbox-route-request] staff notify failed:", e.message);
      return { groupNotified: false, personalNotified: false };
    });

    return new Response(JSON.stringify({
      ok: true,
      alertId: alert?.id ?? null,
      notified: groupNotified || personalNotified,
      groupNotified,
      personalNotified,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[inbox-route-request] error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
