// supabase/functions/staff-notify-preview/index.ts
// Live preview for staff_message_templates (Executive Playbook UI).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStaffAppDeepLink } from "../_shared/guestAlertWhapiNotify.ts";
import {
  buildFrontDeskMorningMessage,
  fetchFrontDeskMorningStats,
} from "../_shared/frontDeskMorningBrief.ts";
import { buildFrontDeskCapabilitiesOnboardingMessage } from "../_shared/frontDeskOnboarding.ts";
import {
  buildGuestAlertSlaEscalationText,
  buildInventorySubmitAdirText,
  buildPortalOrderAdirText,
  buildPreCheckinGuestRequestAdirText,
} from "../_shared/adirNotifyMessages.ts";
import { buildArrivalEtaAdirMessage } from "../_shared/arrivalEtaAdirNotify.ts";
import { buildSoftHandoffManagerText } from "../_shared/handoffEscalation.ts";
import {
  composeExecutiveMorningPulse,
  composeResortDigestMessage,
  computeResortDigestStats,
  filterDigestRelevantRules,
  resolveDigestRange,
  type DigestGuestRow,
  type DigestPeriod,
  type DigestTaskRow,
} from "../_shared/resortDigestStats.ts";
import { fetchExecutiveTodayOutlook } from "../_shared/resortPulseStats.ts";
import { israelYmd } from "../_shared/automationSchedule.ts";
import {
  buildPreviewTemplateMap,
  loadStaffNotifyTemplates,
  STAFF_TEMPLATE_KEYS,
} from "../_shared/staffNotifyTemplates.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function isDigestPeriod(v: unknown): v is DigestPeriod {
  return v === "daily" || v === "weekly" || v === "monthly";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = req.method === "POST" ? await req.json() : {};
    const templateKey = String(body.template_key ?? "").trim();
    if (!templateKey) return json({ ok: false, error: "template_key_required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const baseTemplates = await loadStaffNotifyTemplates(supabase, true);
    const templates = buildPreviewTemplateMap(baseTemplates, templateKey, {
      message_text: body.message_text ?? undefined,
      digest_config: body.digest_config ?? undefined,
    });

    const now = new Date();

    if (templateKey === STAFF_TEMPLATE_KEYS.ADIR_MORNING_BRIEF) {
      const stats = await fetchFrontDeskMorningStats(supabase, now);
      const preview = buildFrontDeskMorningMessage(stats, { includePowerHints: true, templates });
      return json({ ok: true, preview_body: preview, data_source: "live" });
    }

    if (templateKey === STAFF_TEMPLATE_KEYS.ADIR_ONBOARDING) {
      const preview = buildFrontDeskCapabilitiesOnboardingMessage(templates);
      return json({ ok: true, preview_body: preview, data_source: "template" });
    }

    if (templateKey === STAFF_TEMPLATE_KEYS.ELIAD_DIGEST_SHELL) {
      const period: DigestPeriod = isDigestPeriod(body.period) ? body.period : "daily";
      const range = resolveDigestRange(period, now);
      const [guestsRes, tasksRes, ruleRows] = await Promise.all([
        supabase
          .from("guests")
          .select("id, room, checkin_time, room_ready_at, room_ready_notified")
          .gte("checkin_time", range.rangeStart.toISOString())
          .lt("checkin_time", range.rangeEnd.toISOString()),
        supabase
          .from("tasks")
          .select("id, room_number, sla_category, status, created_at, resolved_at, sla_deadline")
          .gte("created_at", range.rangeStart.toISOString())
          .lt("created_at", range.rangeEnd.toISOString()),
        supabase.from("xos_ai_rules").select("rule_text").eq("module", "executive").order("created_at", { ascending: true }),
      ]);
      const stats = computeResortDigestStats({
        guests: (guestsRes.data ?? []) as DigestGuestRow[],
        tasks: (tasksRes.data ?? []) as DigestTaskRow[],
        now,
      });

      if (period === "daily") {
        const todayOutlook = await fetchExecutiveTodayOutlook(supabase, now);
        const preview = composeExecutiveMorningPulse(stats, range.periodDate, todayOutlook, {
          assistantForName: "אליעד",
          templates,
        });
        return json({ ok: true, preview_body: preview, data_source: "live", period });
      }

      const learnedDigestNotes = filterDigestRelevantRules(
        ((ruleRows.data ?? []) as Array<{ rule_text: string | null }>).map((r) => r.rule_text ?? ""),
      );

      const preview = composeResortDigestMessage(stats, period, range.label, {
        assistantForName: "אליעד",
        learnedDigestNotes,
        templates,
      });
      return json({ ok: true, preview_body: preview, data_source: "live", period });
    }

    const samplePreviews: Record<string, string> = {
      [STAFF_TEMPLATE_KEYS.ADIR_ARRIVAL_ETA]: buildArrivalEtaAdirMessage({
        guestName: "ישראל ישראלי",
        room: "אמטיסט 5",
        arrivalDate: israelYmd(now),
        timeHhMm: "16:30",
        channel: "meta",
        phone: "972501234567",
        guestQuote: "נגיע בסביבות ארבע וחצי",
        templates,
      }),
      [STAFF_TEMPLATE_KEYS.ADIR_GUEST_ALERT_SLA]: buildGuestAlertSlaEscalationText({
        ageMinutes: 12,
        thresholdMinutes: 10,
        guestLabel: "דנה כהן (אמטיסט 3)",
        alertType: "request",
        message: "אפשר מגבות נוספות?",
        phone: "972501234567",
        guestName: "דנה כהן",
        templates,
      }),
      [STAFF_TEMPLATE_KEYS.ADIR_PRE_CHECKIN]: buildPreCheckinGuestRequestAdirText({
        room: "אמטיסט 7",
        guestName: "משפחת לוי",
        summary: "מיטת תינוק + עריסה",
        arrivingToday: true,
        templates,
      }),
      [STAFF_TEMPLATE_KEYS.ADIR_PORTAL_ORDER]: buildPortalOrderAdirText({
        guestName: "רון אברהם",
        room: "אמטיסט 2",
        itemLines: "  • שמפניה ×1\n  • פירות העונה ×1",
        templates,
      }),
      [STAFF_TEMPLATE_KEYS.ADIR_INVENTORY]: buildInventorySubmitAdirText({
        locationName: "מחסן ראשי",
        itemCount: 14,
        templates,
      }),
      [STAFF_TEMPLATE_KEYS.ADIR_SOFT_HANDOFF]: buildSoftHandoffManagerText({
        phone: "972501234567",
        requestType: "spa_request",
        guestLabel: "מיכל (אמטיסט 4)",
        ageMinutes: 22,
        preview: "רציתי לדעת אם אפשר לשנות את שעת הטיפול בספא",
        templates,
      }),
    };

    const preview = samplePreviews[templateKey];
    if (preview) {
      return json({ ok: true, preview_body: preview, data_source: "sample" });
    }

    return json({ ok: false, error: "unknown_template_key" }, 400);
  } catch (e) {
    console.error("[staff-notify-preview]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
