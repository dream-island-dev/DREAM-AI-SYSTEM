// Waiter tablet — submit order to kitchen (service role for display # + snapshots).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LineInput {
  item_id: string;
  quantity: number;
  line_notes?: string;
}

function israelTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function dietaryFromProfile(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  const parts: string[] = [];
  const diet = p.dietary_restrictions;
  if (typeof diet === "string" && diet.trim()) parts.push(diet.trim());
  const allergies = p.allergies;
  if (Array.isArray(allergies)) {
    for (const a of allergies) {
      if (typeof a === "string" && a.trim()) parts.push(a.trim());
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json() as {
      guest_id?: number | null;
      table_label?: string | null;
      meal_period?: string;
      kitchen_notes?: string | null;
      lines?: LineInput[];
    };

    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) {
      return new Response(
        JSON.stringify({ ok: false, error: "empty_cart" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const mealPeriod = ["lunch", "dinner", "other"].includes(body.meal_period ?? "")
      ? body.meal_period!
      : "dinner";

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: staffProfile } = await supabase
      .from("profiles")
      .select("id, role, restaurant_access")
      .eq("id", user.id)
      .maybeSingle();

    const canSubmit = staffProfile && (
      staffProfile.role === "restaurant"
      || staffProfile.restaurant_access === true
      || ["manager", "admin", "super_admin"].includes(staffProfile.role as string)
    );
    if (!canSubmit) {
      return new Response(
        JSON.stringify({ ok: false, error: "forbidden" }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    let guestName: string | null = null;
    let roomSnap: string | null = null;
    let dietarySnap: string | null = null;
    let vipSnap = false;
    const guestId = body.guest_id ?? null;

    if (guestId) {
      const { data: guest, error: gErr } = await supabase
        .from("guests")
        .select("id, name, room, guest_profile")
        .eq("id", guestId)
        .maybeSingle();
      if (gErr) throw new Error(gErr.message);
      if (!guest) {
        return new Response(
          JSON.stringify({ ok: false, error: "guest_not_found" }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      guestName = guest.name as string;
      roomSnap = (guest.room as string) ?? null;
      dietarySnap = dietaryFromProfile(guest.guest_profile);
      const gp = guest.guest_profile as Record<string, unknown> | null;
      vipSnap = gp?.vip_status === "vip";
    } else {
      const tbl = String(body.table_label ?? "").trim();
      if (!tbl) {
        return new Response(
          JSON.stringify({ ok: false, error: "guest_or_table_required" }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      guestName = tbl;
      roomSnap = tbl;
    }

    const itemIds = lines.map((l) => l.item_id).filter(Boolean);
    const { data: menuItems, error: mErr } = await supabase
      .from("restaurant_menu_items")
      .select("id, name, price, course, is_available, section_id")
      .in("id", itemIds);
    if (mErr) throw new Error(mErr.message);

    const itemMap = new Map((menuItems ?? []).map((r) => [r.id as string, r]));
    const orderLines: Record<string, unknown>[] = [];
    let sort = 10;

    for (const line of lines) {
      const item = itemMap.get(line.item_id);
      if (!item || !item.is_available) continue;
      const qty = Math.min(20, Math.max(1, Number(line.quantity) || 1));
      orderLines.push({
        item_id: item.id,
        item_name: item.name,
        unit_price: item.price,
        quantity: qty,
        line_notes: typeof line.line_notes === "string" ? line.line_notes.slice(0, 300) : null,
        course: item.course,
        sort_order: sort,
      });
      sort += 10;
    }

    if (!orderLines.length) {
      return new Response(
        JSON.stringify({ ok: false, error: "no_valid_items" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const dayYmd = israelTodayYmd();
    const { data: displayNum, error: numErr } = await supabase.rpc(
      "next_restaurant_order_display_number",
      { p_day: dayYmd },
    );
    if (numErr) throw new Error(numErr.message);

    const { data: order, error: orderErr } = await supabase
      .from("restaurant_orders")
      .insert({
        display_number: displayNum as number,
        day_ymd: dayYmd,
        meal_period: mealPeriod,
        status: "submitted",
        guest_id: guestId,
        table_label: body.table_label?.trim() || null,
        guest_name_snap: guestName,
        room_snap: roomSnap,
        dietary_snap: dietarySnap,
        vip_snap: vipSnap,
        waiter_id: user.id,
        kitchen_notes: body.kitchen_notes?.trim()?.slice(0, 500) || null,
      })
      .select("id, display_number, day_ymd, status, submitted_at")
      .maybeSingle();

    if (orderErr) throw new Error(orderErr.message);
    if (!order) throw new Error("order_insert_failed");

    const linesWithOrder = orderLines.map((l) => ({ ...l, order_id: order.id }));
    const { error: linesErr } = await supabase.from("restaurant_order_lines").insert(linesWithOrder);
    if (linesErr) throw new Error(linesErr.message);

    await supabase.from("restaurant_order_events").insert({
      order_id: order.id,
      event_type: "submitted",
      actor_id: user.id,
      payload: { line_count: orderLines.length },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        order: {
          id: order.id,
          display_number: order.display_number,
          status: order.status,
          submitted_at: order.submitted_at,
        },
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restaurant-order-submit] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
