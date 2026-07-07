// supabase/functions/inbox-route-request/index.ts
// Receptionist routes a guest conversation from DREAM BOT Inbox → Requests Board
// (guest_alerts) + immediate Whapi ping to the "בקשות אורחים" group (routing_config
// alert_inbox_routed) + personal DM to SLA_GUEST_ALERT_PHONE (duty manager).
//
// Mirrors notify-manual-task (ops/tasks) but for the Requests channel — staff
// judgment happens in the Inbox picker before dispatch; no LLM, no pending_approval.

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import { triggerInboxRedAlert } from "../_shared/inboxRedAlert.ts";
import { resolveRouting, alertIntentType } from "../_shared/routingConfig.ts";
import { containsHebrew, translateTextForFieldOps } from "../_shared/fieldOpsTranslation.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildRequestCard(
  room: string | null,
  guestName: string | null,
  message: string,
  reporterName: string | null,
): string {
  return [
    `🛎️ [GUEST REQUEST — Inbox] Suite ${room ?? "—"} (${guestName ?? "Guest"})`,
    message,
    ...(reporterName ? [`Routed by: ${reporterName}`] : []),
    `Please check the Requests Board.`,
  ].join("\n");
}

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

    await triggerInboxRedAlert(supabase, {
      guestId:        body.guestId ?? null,
      phone,
      conversationId: body.conversationId ?? null,
      summary:        context,
    }).catch((e: Error) => console.warn("[inbox-route-request] red-alert failed:", e.message));

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

    const routing = await resolveRouting(supabase, alertIntentType("inbox_routed"), {
      destination_board: "requests",
      whatsapp_group_id: null,
      enable_sla: true,
    });
  // alert_inbox_routed seed (migration 152); fall back to alert_request if unconfigured.
    const routingFallback = await resolveRouting(supabase, alertIntentType("request"), {
      destination_board: "requests",
      whatsapp_group_id: null,
      enable_sla: false,
    });
    const groupId = (
      routing.whatsapp_group_id
      || routingFallback.whatsapp_group_id
      || (Deno.env.get("WHAPI_REQUESTS_GROUP_ID") ?? "").trim()
      || ""
    );

    let whapiMessage = alertMessage;
    if (containsHebrew(whapiMessage)) {
      whapiMessage = await translateTextForFieldOps(whapiMessage, {
        room: body.room ?? null,
        style: "description_only",
      });
    }
    const card = buildRequestCard(body.room ?? null, body.guestName ?? null, whapiMessage, reporterName);

    let groupNotified = false;
    if (groupId) {
      try {
        await sendWhapiText(groupId, card, { noLinkPreview: true });
        groupNotified = true;
      } catch (e) {
        console.error("[inbox-route-request] Whapi group send failed:", (e as Error).message);
      }
    } else {
      console.warn("[inbox-route-request] no requests Whapi group configured — card not sent.");
    }

    const personalPhone = (Deno.env.get("SLA_GUEST_ALERT_PHONE") ?? "").trim();
    let personalNotified = false;
    if (personalPhone) {
      try {
        await sendWhapiText(personalPhone, card, { noLinkPreview: true });
        personalNotified = true;
      } catch (e) {
        console.warn("[inbox-route-request] personal DM failed:", (e as Error).message);
      }
    }

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
