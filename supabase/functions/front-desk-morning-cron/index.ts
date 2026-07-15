// supabase/functions/front-desk-morning-cron/index.ts
//
// Daily Hebrew morning brief to Adir (front desk) via Whapi Suites device.
// Arrivals today/tomorrow + open requests + onboarding «כוח בידיים».
//
// Invoke: GET/POST .../front-desk-morning-cron
// Manual re-send: ?force=1 (bypasses idempotency for today)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import { formatWhapiSuitesConversationLog } from "../_shared/outboundDispatchTag.ts";
import { resolveAdirNotifyPhoneDigits } from "../_shared/arrivalEtaAdirNotify.ts";
import { israelYmd } from "../_shared/automationSchedule.ts";
import {
  buildFrontDeskMorningMessage,
  fetchFrontDeskMorningStats,
  frontDeskMorningEnabled,
} from "../_shared/frontDeskMorningBrief.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!frontDeskMorningEnabled()) {
      return json({ ok: true, skipped: true, reason: "FRONT_DESK_MORNING_ENABLED=false" });
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const digestDate = israelYmd();

    if (!force) {
      const { data: existing } = await supabase
        .from("front_desk_morning_log")
        .select("id")
        .eq("digest_date", digestDate)
        .maybeSingle();
      if (existing) {
        return json({ ok: true, skipped: true, reason: "already_sent", digest_date: digestDate });
      }
    }

    const stats = await fetchFrontDeskMorningStats(supabase);
    const body = buildFrontDeskMorningMessage(stats);
    const phone = resolveAdirNotifyPhoneDigits();

    const wamid = await sendWhapiText(phone, body, { noLinkPreview: true });
    if (!wamid) {
      console.warn("[front-desk-morning-cron] whapi send returned no message id");
      return json({ ok: false, error: "whapi_send_failed" });
    }

    if (!force) {
      const { error: logError } = await supabase.from("front_desk_morning_log").insert({
        digest_date: digestDate,
        body_sent: body,
        wa_message_id: wamid,
      });
      if (logError) console.warn("[front-desk-morning-cron] log insert failed:", logError.message);
    }

    const { error: convError } = await supabase.from("whatsapp_conversations").insert({
      phone,
      guest_id: null,
      direction: "outbound",
      message: formatWhapiSuitesConversationLog(body),
      wa_message_id: wamid,
      inbox_channel: "whapi",
      channel: "whapi",
    });
    if (convError) console.warn("[front-desk-morning-cron] conversation log failed:", convError.message);

    return json({
      ok: true,
      sent: true,
      digest_date: digestDate,
      phone,
      today_arrivals: stats.brief.todayTotal,
      missing_time: stats.brief.todayMissingTime,
      forced: force,
    });
  } catch (e) {
    console.error("[front-desk-morning-cron]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
