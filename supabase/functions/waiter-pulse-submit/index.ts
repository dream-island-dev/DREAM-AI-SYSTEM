// supabase/functions/waiter-pulse-submit/index.ts
// Public submit — waiter service improvement pulse (/pulse/:token).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BOT_CONFIG_WAITER_PULSE_UI_KEY,
  extractSubmitterName,
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
} from "../_shared/waiterPulseUi.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const token = body?.token;
    const answers = body?.answers;

    if (!token || typeof token !== "string") throw new Error("token required");
    if (!answers || typeof answers !== "object") throw new Error("answers required");

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "link_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: link, error: linkErr } = await supabase
      .from("waiter_pulse_links")
      .select("id")
      .eq("token", token)
      .eq("is_active", true)
      .maybeSingle();

    if (linkErr) throw new Error(`lookup_error: ${linkErr.message}`);
    if (!link) {
      return new Response(
        JSON.stringify({ ok: false, error: "link_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const { data: cfgRow } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", BOT_CONFIG_WAITER_PULSE_UI_KEY)
      .maybeSingle();

    let uiRaw = cfgRow?.config_value;
    if (typeof uiRaw === "string") {
      try {
        uiRaw = JSON.parse(uiRaw);
      } catch {
        uiRaw = null;
      }
    }
    const ui = normalizeWaiterPulseUi(uiRaw);

    const validationErr = validateWaiterPulseAnswers(ui, answers as Record<string, unknown>);
    if (validationErr) {
      return new Response(
        JSON.stringify({ ok: false, error: "validation", message: validationErr }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const submitterName = extractSubmitterName(ui, answers as Record<string, unknown>);

    const { error: insertErr } = await supabase.from("waiter_pulse_responses").insert({
      link_id: link.id,
      answers,
      submitter_name: submitterName,
      management_status: "new",
    });

    if (insertErr) throw new Error(`insert_error: ${insertErr.message}`);

    return new Response(
      JSON.stringify({
        ok: true,
        thank_you_title: ui.thank_you_title,
        thank_you_body: ui.thank_you_body,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[waiter-pulse-submit] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
