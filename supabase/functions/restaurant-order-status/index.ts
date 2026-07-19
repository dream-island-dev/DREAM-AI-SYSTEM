// Kitchen Display — update order status via magic-link token.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertActiveKdsToken } from "../_shared/restaurantKdsAuth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  submitted: ["in_kitchen", "cancelled"],
  in_kitchen: ["ready", "cancelled"],
  ready: ["served", "cancelled"],
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, order_id, status, cancel_reason } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");
    if (!order_id || typeof order_id !== "string") throw new Error("order_id required");
    if (!status || typeof status !== "string") throw new Error("status required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await assertActiveKdsToken(supabase, token);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: auth.error }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const { data: order, error: fetchErr } = await supabase
      .from("restaurant_orders")
      .select("id, status")
      .eq("id", order_id)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!order) {
      return new Response(
        JSON.stringify({ ok: false, error: "order_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const current = order.status as string;
    const allowed = VALID_TRANSITIONS[current] ?? [];
    if (!allowed.includes(status)) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_transition", from: current, to: status }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status };
    if (status === "in_kitchen") patch.in_kitchen_at = now;
    if (status === "ready") patch.ready_at = now;
    if (status === "served") patch.served_at = now;
    if (status === "cancelled") {
      patch.cancelled_at = now;
      patch.cancel_reason = typeof cancel_reason === "string" ? cancel_reason.slice(0, 300) : null;
    }

    const { error: updErr } = await supabase
      .from("restaurant_orders")
      .update(patch)
      .eq("id", order_id);

    if (updErr) throw new Error(updErr.message);

    await supabase.from("restaurant_order_events").insert({
      order_id,
      event_type: status,
      payload: { via: "kds" },
    });

    return new Response(
      JSON.stringify({ ok: true, order_id, status }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restaurant-order-status] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
