// supabase/functions/guest-portal-order/index.ts
// Dynamic Experience Hub — Pre-Order submission from Guest Portal.
//
// Receives a cart (array of { item_id, quantity, notes }) from the portal UI,
// validates the guest by portal_token (service-role, no RLS), inserts rows into
// guest_orders, and fires a real-time Whapi alert to the duty manager.
//
// Security notes:
//   • guest_type (room_type) enforcement is server-side only — the client sends
//     item_id references; this function cross-checks each item's target_audience
//     against the guest's actual room_type from DB. A spoofed item_id for a
//     suite-only item submitted by a day_use guest is silently dropped (not an
//     error — the item simply wasn't available to them).
//   • Quantity is capped at 10 per item — prevents runaway cart from a buggy
//     client.
//   • portal_token UUID format is validated before any DB query (same guard as
//     guest-portal-data / guest-portal-upsell).

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same number as guest-portal-upsell / guest-portal-ops-request / task-action
// ACTOR_PHONES.Adir — duplicated per Deno function-boundary convention.
const ADIR_PHONE = "972546294885";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CartItem {
  item_id:  string;
  quantity: number;
  notes?:   string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, cart } = await req.json() as { token: unknown; cart: unknown };

    if (!token || typeof token !== "string") throw new Error("token required");
    if (!Array.isArray(cart) || cart.length === 0) throw new Error("cart must be a non-empty array");

    // UUID shape guard — same as guest-portal-data/upsell to prevent raw Postgres
    // type errors leaking to the public-facing client.
    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Validate guest ──────────────────────────────────────────────────────
    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, room, room_type, arrival_date, status")
      .eq("portal_token", token)
      .maybeSingle();
    if (guestErr) throw new Error(`lookup_error: ${guestErr.message}`);
    if (!guest) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Validate & resolve cart items (server-side authoritative) ───────────
    // Fetch only the item_ids referenced in the cart — no full table scan.
    const rawItemIds = (cart as CartItem[])
      .map((c) => c?.item_id)
      .filter((id) => typeof id === "string" && UUID_RE.test(id));

    if (rawItemIds.length === 0) throw new Error("no valid item_ids in cart");

    const { data: itemRows, error: itemsErr } = await supabase
      .from("upsell_items")
      .select("id, name, price, target_audience, is_active")
      .in("id", rawItemIds);
    if (itemsErr) throw new Error(`items_lookup_error: ${itemsErr.message}`);

    // Build a map for O(1) lookup
    const itemMap = new Map(
      (itemRows ?? []).map((r: Record<string, unknown>) => [r.id as string, r]),
    );

    // Determine which audiences are valid for this guest's room_type
    const guestRoomType = (guest.room_type as string | null) ?? "";
    const validAudiences = new Set<string>(["all"]);
    if (guestRoomType === "suite")     validAudiences.add("suite");
    if (guestRoomType === "day_guest") validAudiences.add("day_use");

    // Filter cart to only items that exist, are active, and target this guest
    const validCartItems: CartItem[] = [];
    const droppedItems: string[] = [];

    for (const entry of cart as CartItem[]) {
      const item = itemMap.get(entry?.item_id);
      if (!item) { droppedItems.push(entry?.item_id ?? "?"); continue; }
      if (!item.is_active) { droppedItems.push(item.id as string); continue; }
      if (!validAudiences.has(item.target_audience as string)) {
        // Server-side authoritative: drop silently (not an error — the item
        // wasn't shown to this guest type to begin with; this guards against
        // a manipulated request from a day_use guest asking for suite-only items)
        droppedItems.push(item.id as string);
        continue;
      }
      validCartItems.push({
        item_id:  entry.item_id,
        quantity: Math.min(Math.max(1, Number(entry.quantity) || 1), 10), // cap 1–10
        notes:    typeof entry.notes === "string" ? entry.notes.slice(0, 300) : undefined,
      });
    }

    if (validCartItems.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "no_valid_items", droppedItems }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Insert guest_orders rows ────────────────────────────────────────────
    const orderInserts = validCartItems.map((item) => ({
      guest_id: guest.id as number,
      item_id:  item.item_id,
      quantity: item.quantity,
      status:   "pending",
      notes:    item.notes ?? null,
    }));

    const { data: insertedOrders, error: ordersErr } = await supabase
      .from("guest_orders")
      .insert(orderInserts)
      .select("id");
    if (ordersErr) throw new Error(`orders_insert_error: ${ordersErr.message}`);

    const orderIds = (insertedOrders ?? []).map((r: Record<string, unknown>) => r.id as string);

    // ── Whapi alert to duty manager (best-effort, non-blocking) ────────────
    // Mirrors guest-portal-upsell's pattern: immediate 1:1 DM to Adir, not
    // a group blast. sla-escalation-cron's 10-min-unresolved → Meta personal
    // ping still applies via any guest_alerts rows created downstream if staff
    // choose to route there; for now order notification is purely Whapi-based.
    try {
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const arrival = guest.arrival_date
        ? new Date(`${guest.arrival_date as string}T00:00:00Z`)
        : null;
      const daysAway = arrival
        ? Math.round((arrival.getTime() - today.getTime()) / 86400000)
        : null;
      const arrivalTag = daysAway !== null && daysAway > 0
        ? `📅 הגעה בעוד ${daysAway} ימים (${guest.arrival_date as string})`
        : null;

      const itemLines = validCartItems
        .map((c) => {
          const item = itemMap.get(c.item_id);
          const price = item?.price ? ` — ₪${item.price}` : "";
          const qty   = c.quantity > 1 ? ` × ${c.quantity}` : "";
          const note  = c.notes ? ` (${c.notes})` : "";
          return `  • ${(item?.name as string) ?? c.item_id}${price}${qty}${note}`;
        })
        .join("\n");

      const msg =
        `🛎️ ORDER from Portal — ${guest.name ?? "Guest"}` +
        (guest.room ? ` | ${guest.room as string}` : "") +
        `\n${itemLines}` +
        (arrivalTag ? `\n${arrivalTag}` : "") +
        `\nCheck the Operations Board or Orders tab.`;

      await sendWhapiText(ADIR_PHONE, msg, { noLinkPreview: true });
    } catch (e) {
      console.warn(
        `[guest-portal-order] orders ${orderIds.join(",")} created but Adir notify failed:`,
        (e as Error).message,
      );
    }

    return new Response(
      JSON.stringify({
        ok:       true,
        orderIds,
        accepted: validCartItems.length,
        dropped:  droppedItems.length,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-order] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
