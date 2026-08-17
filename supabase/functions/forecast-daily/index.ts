// Live occupancy forecast for reception — compute + optional Whapi ping to Yelena.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeForecastReport,
  dispatchForecastEveningIfDue,
  saveForecastConfig,
  sendForecastPing,
  type ForecastDailyConfig,
} from "../_shared/forecastDaily.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) return json({ ok: false, error: "unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "compute");
    const targetDate = typeof body.target_date === "string" ? body.target_date : undefined;

    if (action === "save_config") {
      const patch = (body.config && typeof body.config === "object")
        ? body.config as Partial<ForecastDailyConfig>
        : {};
      const config = await saveForecastConfig(admin, patch);
      return json({ ok: true, config });
    }

    const { report, config } = await computeForecastReport(admin, { targetDate });

    if (action === "send_now") {
      const phone = String(body.phone ?? config.yelena_phone);
      const sent = await sendForecastPing(admin, report, phone);
      return json({ ok: sent.sent, report, config, send: sent });
    }

    if (action === "dispatch_due") {
      const result = await dispatchForecastEveningIfDue(admin);
      return json({ ok: true, ...result, report, config });
    }

    return json({ ok: true, report, config });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
