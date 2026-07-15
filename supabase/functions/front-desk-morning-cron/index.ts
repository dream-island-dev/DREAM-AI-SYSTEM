// supabase/functions/front-desk-morning-cron/index.ts
//
// Daily Hebrew morning brief to Adir (front desk) via Whapi Suites device.
// Arrivals today/tomorrow + open requests.
// First run ever: one-time capabilities guide, then the daily brief (no duplicate tips).
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
import {
  buildFrontDeskCapabilitiesOnboardingMessage,
  FRONT_DESK_ONBOARDING_CONFIG_KEY,
} from "../_shared/frontDeskOnboarding.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function isOnboardingSent(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const { data } = await supabase
    .from("bot_config")
    .select("config_value")
    .eq("config_key", FRONT_DESK_ONBOARDING_CONFIG_KEY)
    .maybeSingle();
  return String(data?.config_value ?? "").trim().toLowerCase() === "true";
}

async function markOnboardingSent(supabase: ReturnType<typeof createClient>): Promise<void> {
  const { error } = await supabase.from("bot_config").upsert(
    { config_key: FRONT_DESK_ONBOARDING_CONFIG_KEY, config_value: "true" },
    { onConflict: "config_key" },
  );
  if (error) console.warn("[front-desk-morning-cron] onboarding flag upsert failed:", error.message);
}

async function logOutbound(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  body: string,
  wamid: string | null,
): Promise<void> {
  if (!wamid) return;
  const { error } = await supabase.from("whatsapp_conversations").insert({
    phone,
    guest_id: null,
    direction: "outbound",
    message: formatWhapiSuitesConversationLog(body),
    wa_message_id: wamid,
    inbox_channel: "whapi",
    channel: "whapi",
  });
  if (error) console.warn("[front-desk-morning-cron] conversation log failed:", error.message);
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

    const phone = resolveAdirNotifyPhoneDigits();
    const onboardingAlreadySent = await isOnboardingSent(supabase);
    let onboardingSentNow = false;

    if (!onboardingAlreadySent) {
      const onboardingBody = buildFrontDeskCapabilitiesOnboardingMessage();
      const onboardingWamid = await sendWhapiText(phone, onboardingBody, { noLinkPreview: true });
      if (!onboardingWamid) {
        console.warn("[front-desk-morning-cron] onboarding whapi send failed — will retry next run");
        return json({ ok: false, error: "onboarding_whapi_send_failed" });
      }
      await logOutbound(supabase, phone, onboardingBody, onboardingWamid);
      await markOnboardingSent(supabase);
      onboardingSentNow = true;
      await new Promise((r) => setTimeout(r, 2500));
    }

    const stats = await fetchFrontDeskMorningStats(supabase);
    const body = buildFrontDeskMorningMessage(stats, { includePowerHints: !onboardingAlreadySent && !onboardingSentNow });
    const wamid = await sendWhapiText(phone, body, { noLinkPreview: true });
    if (!wamid) {
      console.warn("[front-desk-morning-cron] whapi send returned no message id");
      return json({ ok: false, error: "whapi_send_failed", onboarding_sent_now: onboardingSentNow });
    }

    if (!force) {
      const { error: logError } = await supabase.from("front_desk_morning_log").insert({
        digest_date: digestDate,
        body_sent: body,
        wa_message_id: wamid,
      });
      if (logError) console.warn("[front-desk-morning-cron] log insert failed:", logError.message);
    }

    await logOutbound(supabase, phone, body, wamid);

    return json({
      ok: true,
      sent: true,
      digest_date: digestDate,
      phone,
      today_arrivals: stats.brief.todayTotal,
      missing_time: stats.brief.todayMissingTime,
      onboarding_sent_now: onboardingSentNow,
      forced: force,
    });
  } catch (e) {
    console.error("[front-desk-morning-cron]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
