// supabase/functions/inventory-portal-data/index.ts
// Inventory Smart-Intake Module — public, password-less data fetch for the
// daily-fill phone screen (InventoryPortal.js, /inv/:token).
//
// Looks a link up by `token` (migration 090, inventory_portal_links — the
// magic-link credential, same security model as guests.portal_token /
// migration 083: the token itself IS the auth, not a guessable id) using the
// SERVICE ROLE key, and returns only what the employee's screen needs.
// Deliberately never returns par_level or restock_suggested — the employee
// only ever enters counts, she never sees (and can't be influenced by) the
// calculated target.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");

    // token is a UUID column — a malformed token (typo, truncated link) throws
    // a Postgres type error at query time, not a clean "0 rows". Validate the
    // shape first so that case returns the same link_not_found an employee
    // sees for a well-formed-but-unknown/rotated token, instead of leaking a
    // raw DB error message to the client.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "link_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Only an active link resolves — a rotated ("צור קישור חדש") or otherwise
    // deactivated token behaves exactly like an unknown one, never a special
    // "expired" leak.
    const { data: link, error: linkErr } = await supabase
      .from("inventory_portal_links")
      .select("location_name")
      .eq("token", token)
      .eq("is_active", true)
      .maybeSingle();

    if (linkErr) throw new Error(`lookup_error: ${linkErr.message}`);
    if (!link) {
      return new Response(
        JSON.stringify({ ok: false, error: "link_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: items, error: itemsErr } = await supabase
      .from("inventory_items")
      .select("id, item_name, unit")
      .eq("location_name", link.location_name)
      .eq("is_active", true)
      .order("item_name", { ascending: true });

    if (itemsErr) throw new Error(`items_lookup_error: ${itemsErr.message}`);

    return new Response(
      JSON.stringify({ ok: true, location_name: link.location_name, items: items ?? [] }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[inventory-portal-data] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
