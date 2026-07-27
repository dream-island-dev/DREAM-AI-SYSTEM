import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { composeSigalMorningActionPlan } from "../_shared/oritSigalBriefing.ts";
import { managerDigestEnabled } from "../_shared/oritAgentMail.ts";
import { resolveOritAlertPhone } from "../_shared/oritAgentWhapiAlert.ts";
import {
  composeFeedbackDashboardLinkUrl,
  isIsraelSunday,
  messageExpectsFeedbackDashboardLinkFollowUp,
} from "../_shared/feedbackDashboardLink.ts";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import { israelYmd } from "../_shared/automationSchedule.ts";
import { addDaysYmd } from "../_shared/resortPulseStats.ts";
import {
  composeSundayFeedbackNudge,
  computeSurveyDigestStats,
  type DigestSurveyRow,
} from "../_shared/resortDigestStats.ts";
import { fetchOritDraftText } from "../_shared/oritAgentWorkflow.ts";
import {
  persistOritThreadAnalysis,
  runOritThreadAnalysis,
} from "../_shared/oritThreadAnalysis.ts";
import {
  buildSigalOpenComplaintRows,
  israelDigestYmd,
} from "../_shared/oritSigalDigestRows.ts";
import {
  composeSigalGuestFeedbackMorningNudge,
  fetchGuestFeedbackDigestStats,
} from "../_shared/guestFeedbackDigest.ts";

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
    const since24h = new Date(now - 24 * 3_600_000).toISOString();

    const yesterdayStart = new Date();
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const guestFeedbackStats = await fetchGuestFeedbackDigestStats(supabase);
    const guestFeedbackMorningNudge = composeSigalGuestFeedbackMorningNudge(guestFeedbackStats);

    let sent = 0;
    for (const mailbox of mailboxes ?? []) {
      if (!force) {
        const { data: existing } = await supabase
          .from("orit_agent_digest_log")
          .select("id")
          .eq("mailbox_id", mailbox.id)
          .eq("digest_date", digestDate)
          .eq("digest_kind", "morning")
          .maybeSingle();
        if (existing) continue;
      }

      const phone = await resolveOritAlertPhone(supabase, mailbox);
      if (!phone) {
        console.warn("[manager-morning-digest] no phone for mailbox", mailbox.id);
        continue;
      }

      const { data: openThreads } = await supabase
        .from("orit_agent_threads")
        .select("id, subject, from_name, from_email, guest_contact_name, guest_contact_phone, guest_contact_email, category, urgency, ai_summary, sla_deadline_at, status, received_at, snippet, auto_ack_sent_at, orit_wa_contact_at, full_reply_sent_at")
        .eq("mailbox_id", mailbox.id)
        .in("status", ["awaiting_reply", "snoozed"])
        .eq("is_demo", false);

      const complaintThreads = (openThreads ?? []).filter((t) => t.category === "complaint");

      for (const t of complaintThreads) {
        try {
          const ack = await fetchOritDraftText(supabase, t.id, "ack");
          const full = await fetchOritDraftText(supabase, t.id, "full_reply");
          if (!ack?.text || !full?.text) {
            const analysis = await runOritThreadAnalysis(supabase, mailbox.id, t, { forceLlm: true });
            await persistOritThreadAnalysis(supabase, t.id, analysis, undefined, {
              from_name: t.from_name,
              auto_ack_sent_at: t.auto_ack_sent_at,
              workflow_step: null,
            });
          }
        } catch (prepErr) {
          console.warn("[manager-morning-digest] prep analyze failed:", t.id, (prepErr as Error).message);
        }
      }

      const openComplaints = await buildSigalOpenComplaintRows(supabase, openThreads ?? [], now);
      const otherOpenCount = (openThreads ?? []).filter((t) => t.category !== "complaint").length;

      const { count: leadsLast24h } = await supabase
        .from("orit_agent_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailbox.id)
        .eq("is_demo", false)
        .eq("category", "lead")
        .gte("received_at", since24h);

      const { count: handledYesterday } = await supabase
        .from("orit_agent_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailbox.id)
        .eq("status", "handled")
        .gte("handled_at", yesterdayStart.toISOString())
        .lte("handled_at", yesterdayEnd.toISOString());

      let body = composeSigalMorningActionPlan({
        openComplaints,
        leadsLast24h: leadsLast24h ?? 0,
        otherOpenCount,
        handledYesterday: handledYesterday ?? 0,
      });

      if (isIsraelSunday(new Date())) {
        const yesterdayYmd = addDaysYmd(israelYmd(), -1);
        const { data: surveyRows, error: surveyErr } = await supabase
          .from("guest_surveys")
          .select("overall_experience, patio, live_kitchen, chestnut_restaurant, service_team, spa, cleaning_maintenance")
          .eq("visit_date", yesterdayYmd);
        if (surveyErr) {
          console.warn("[manager-morning-digest] guest_surveys fetch failed (non-blocking):", surveyErr.message);
        }
        const surveyStats = computeSurveyDigestStats(
          (surveyRows ?? []) as DigestSurveyRow[],
        );
        body += composeSundayFeedbackNudge(surveyStats, { inlineUrl: false });
      }

      body += guestFeedbackMorningNudge;

      const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
      if (!whapiId) {
        console.warn("[manager-morning-digest] whapi send failed");
        continue;
      }
      if (messageExpectsFeedbackDashboardLinkFollowUp(body)) {
        await sendWhapiText(phone, composeFeedbackDashboardLinkUrl(), { noLinkPreview: true });
      }

      await supabase.from("orit_agent_digest_log").upsert({
        mailbox_id: mailbox.id,
        digest_date: digestDate,
        digest_kind: "morning",
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
    console.error("[manager-morning-digest]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
