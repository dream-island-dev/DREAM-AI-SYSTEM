// Kitchen Display — fetch open orders by magic-link token (no login).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertActiveKdsToken } from "../_shared/restaurantKdsAuth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function israelTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, day_ymd: dayOverride } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");

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

    const dayYmd = typeof dayOverride === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayOverride)
      ? dayOverride
      : israelTodayYmd();

    const { data: orders, error: ordErr } = await supabase
      .from("restaurant_orders")
      .select(
        "id, display_number, status, meal_period, guest_name_snap, room_snap, dietary_snap, " +
        "vip_snap, kitchen_notes, submitted_at, in_kitchen_at, ready_at",
      )
      .eq("day_ymd", dayYmd)
      .in("status", ["submitted", "in_kitchen", "ready"])
      .order("submitted_at", { ascending: true });

    if (ordErr) throw new Error(ordErr.message);

    const orderIds = (orders ?? []).map((o) => o.id);
    let lines: Record<string, unknown>[] = [];
    if (orderIds.length) {
      const { data: lineRows, error: lineErr } = await supabase
        .from("restaurant_order_lines")
        .select("id, order_id, item_name, quantity, line_notes, course, sort_order")
        .in("order_id", orderIds)
        .order("sort_order", { ascending: true });
      if (lineErr) throw new Error(lineErr.message);
      lines = lineRows ?? [];
    }

    const linesByOrder: Record<string, unknown[]> = {};
    for (const line of lines) {
      const oid = line.order_id as string;
      if (!linesByOrder[oid]) linesByOrder[oid] = [];
      linesByOrder[oid].push(line);
    }

    const enriched = (orders ?? []).map((o) => ({
      ...o,
      lines: linesByOrder[o.id as string] ?? [],
    }));

    return new Response(
      JSON.stringify({
        ok: true,
        label: auth.label,
        day_ymd: dayYmd,
        orders: enriched,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restaurant-kds-data] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
