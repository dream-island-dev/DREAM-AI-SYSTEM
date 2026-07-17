// supabase/functions/resort-digest-cron/index.ts
//
// Resort Ops Digest — daily morning pulse + weekly/monthly summaries to Eliad (CEO) via the
// Whapi Suites device. Same channel/pattern as the Executive Voice Assistant and
// manager-morning-digest: aggregates existing operational data, no new capture.
//
// Invoke: POST/GET .../resort-digest-cron?period=daily|weekly|monthly

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import { formatWhapiSuitesConversationLog } from "../_shared/outboundDispatchTag.ts";
import { CEO_PHONE_DIGITS } from "../_shared/executiveIdentity.ts";
import { israelYmd } from "../_shared/automationSchedule.ts";
import {
  composeExecutiveMorningPulse,
  composeResortDigestMessage,
  computeResortDigestStats,
  filterDigestRelevantRules,
  resolveDigestRange,
  type DigestGuestRow,
  type DigestPeriod,
  type DigestSurveyRow,
  type DigestTaskRow,
} from "../_shared/resortDigestStats.ts";
import { loadStaffNotifyTemplates } from "../_shared/staffNotifyTemplates.ts";
import { fetchExecutiveTodayOutlook } from "../_shared/resortPulseStats.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isDigestPeriod(value: string | null): value is DigestPeriod {
  return value === "daily" || value === "weekly" || value === "monthly";
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = new URL(req.url);
    const periodParam = url.searchParams.get("period");
    if (!isDigestPeriod(periodParam)) {
      return json({ ok: false, error: "invalid_period", hint: "?period=daily|weekly|monthly" }, 400);
    }
    const period = periodParam;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const range = resolveDigestRange(period, now);

    // Idempotency — one send per (period, period_date), same convention as orit_agent_digest_log.
    const { data: existing } = await supabase
      .from("resort_digest_log")
      .select("id")
      .eq("period", period)
      .eq("period_date", range.periodDate)
      .maybeSingle();
    if (existing) {
      return json({ ok: true, skipped: true, reason: "already_sent", period, period_date: range.periodDate });
    }

    const rangeStartIso = range.rangeStart.toISOString();
    const rangeEndIso = range.rangeEnd.toISOString();

    // guest_surveys.visit_date is a plain DATE (no time component) — bound it
    // by Israel-calendar Ymd, not the UTC instant range the other two queries use.
    const surveyStartYmd = israelYmd(range.rangeStart);
    const surveyEndYmd = israelYmd(range.rangeEnd);

    const [guestsRes, tasksRes, surveysRes] = await Promise.all([
      supabase
        .from("guests")
        .select("id, room, checkin_time, room_ready_at, room_ready_notified")
        .gte("checkin_time", rangeStartIso)
        .lt("checkin_time", rangeEndIso),
      supabase
        .from("tasks")
        .select("id, room_number, sla_category, status, created_at, resolved_at, sla_deadline")
        .gte("created_at", rangeStartIso)
        .lt("created_at", rangeEndIso),
      supabase
        .from("guest_surveys")
        .select("overall_experience, patio, live_kitchen, chestnut_restaurant, service_team, spa, cleaning_maintenance")
        .gte("visit_date", surveyStartYmd)
        .lt("visit_date", surveyEndYmd),
    ]);

    if (guestsRes.error || tasksRes.error) {
      const detail = guestsRes.error?.message ?? tasksRes.error?.message ?? "unknown";
      console.error("[resort-digest-cron] fetch failed:", detail);
      return json({ ok: false, error: "fetch_failed", detail });
    }
    if (surveysRes.error) {
      // Non-fatal — digest still sends without the survey section (FAIL VISIBLE
      // via the log, not a silent gap the reader can't tell happened).
      console.warn("[resort-digest-cron] guest_surveys fetch failed (non-blocking):", surveysRes.error.message);
    }

    const stats = computeResortDigestStats({
      guests: (guestsRes.data ?? []) as DigestGuestRow[],
      tasks: (tasksRes.data ?? []) as DigestTaskRow[],
      surveys: surveysRes.error ? undefined : ((surveysRes.data ?? []) as DigestSurveyRow[]),
      now,
    });

    const { data: ruleRows } = period === "daily" ? { data: [] } : await supabase
      .from("xos_ai_rules")
      .select("rule_text")
      .eq("module", "executive")
      .order("created_at", { ascending: true });
    const learnedDigestNotes = filterDigestRelevantRules(
      ((ruleRows ?? []) as Array<{ rule_text: string | null }>).map((r) => r.rule_text ?? ""),
    );

    const templates = await loadStaffNotifyTemplates(supabase);

    let body: string;
    if (period === "daily") {
      const todayOutlook = await fetchExecutiveTodayOutlook(supabase, now);

      body = composeExecutiveMorningPulse(stats, range.periodDate, todayOutlook, {
        assistantForName: "אליעד",
        templates,
      });
    } else {
      body = composeResortDigestMessage(stats, period, range.label, {
        assistantForName: "אליעד",
        learnedDigestNotes,
        templates,
      });
    }

    const wamid = await sendWhapiText(CEO_PHONE_DIGITS, body, { noLinkPreview: true });
    if (!wamid) {
      console.warn("[resort-digest-cron] whapi send returned no message id");
      return json({ ok: false, error: "whapi_send_failed" });
    }

    const { error: logError } = await supabase.from("resort_digest_log").insert({
      period,
      period_date: range.periodDate,
      body_sent: body,
      wa_message_id: wamid,
    });
    if (logError) console.warn("[resort-digest-cron] resort_digest_log insert failed:", logError.message);

    const { error: convError } = await supabase.from("whatsapp_conversations").insert({
      phone: CEO_PHONE_DIGITS,
      guest_id: null,
      direction: "outbound",
      message: formatWhapiSuitesConversationLog(body),
      wa_message_id: wamid,
      inbox_channel: "whapi",
      channel: "whapi",
    });
    if (convError) console.warn("[resort-digest-cron] conversation log insert failed:", convError.message);

    return json({ ok: true, sent: true, period, period_date: range.periodDate, stats });
  } catch (e) {
    console.error("[resort-digest-cron]", e);
    return json({ ok: false, error: (e as Error).message });
  }
});
