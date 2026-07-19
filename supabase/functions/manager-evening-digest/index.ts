import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { composeSigalEveningActionPlan } from "../_shared/oritSigalBriefing.ts";
import { managerDigestEnabled } from "../_shared/oritAgentMail.ts";
import { resolveOritAlertPhone } from "../_shared/oritAgentWhapiAlert.ts";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import {
  buildSigalOpenComplaintRows,
  israelDigestYmd,
} from "../_shared/oritSigalDigestRows.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!managerDigestEnabled()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "MANAGER_DIGEST_ENABLED=false" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const digestDate = israelDigestYmd();
    const force = (await req.json().catch(() => ({}))).force === true;

    const { data: mailboxes } = await supabase
      .from("orit_agent_mailbox")
      .select("id, profile_id, digest_enabled, digest_whatsapp_phone, alert_enabled")
      .eq("digest_enabled", true);

    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    let sent = 0;
    for (const mailbox of mailboxes ?? []) {
      if (!force) {
        const { data: existing } = await supabase
          .from("orit_agent_digest_log")
          .select("id")
          .eq("mailbox_id", mailbox.id)
          .eq("digest_date", digestDate)
          .eq("digest_kind", "evening")
          .maybeSingle();
        if (existing) continue;
      }

      const phone = await resolveOritAlertPhone(supabase, mailbox);
      if (!phone) {
        console.warn("[manager-evening-digest] no phone for mailbox", mailbox.id);
        continue;
      }

      const { data: openThreads } = await supabase
        .from("orit_agent_threads")
        .select("id, subject, from_name, from_email, guest_contact_name, guest_contact_phone, guest_contact_email, category, urgency, ai_summary, sla_deadline_at, status, auto_ack_sent_at, orit_wa_contact_at")
        .eq("mailbox_id", mailbox.id)
        .in("status", ["awaiting_reply", "snoozed"])
        .eq("is_demo", false);

      const openComplaints = await buildSigalOpenComplaintRows(supabase, openThreads ?? [], now);
      const otherOpenCount = (openThreads ?? []).filter((t) => t.category !== "complaint").length;

      const { count: handledToday } = await supabase
        .from("orit_agent_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailbox.id)
        .eq("status", "handled")
        .gte("handled_at", todayStart.toISOString())
        .lte("handled_at", todayEnd.toISOString());

      const body = composeSigalEveningActionPlan({
        openComplaints,
        otherOpenCount,
        handledToday: handledToday ?? 0,
      });

      const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
      if (!whapiId) {
        console.warn("[manager-evening-digest] whapi send failed");
        continue;
      }

      await supabase.from("orit_agent_digest_log").upsert({
        mailbox_id: mailbox.id,
        digest_date: digestDate,
        digest_kind: "evening",
        body_sent: body,
        whapi_message_id: whapiId,
        sent_at: new Date().toISOString(),
      }, { onConflict: "mailbox_id,digest_date,digest_kind" });

      sent += 1;
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-evening-digest]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
