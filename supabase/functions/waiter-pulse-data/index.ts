// supabase/functions/waiter-pulse-data/index.ts
// Public fetch — survey UI config for /pulse/:token (no login).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BOT_CONFIG_WAITER_PULSE_UI_KEY,
  normalizeWaiterPulseUi,
} from "../_shared/waiterPulseUi.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");

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
      .select("id, label")
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

    return new Response(
      JSON.stringify({ ok: true, label: link.label, ui }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[waiter-pulse-data] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
