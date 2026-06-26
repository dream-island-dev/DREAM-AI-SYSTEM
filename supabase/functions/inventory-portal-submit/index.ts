// supabase/functions/inventory-portal-submit/index.ts
// Inventory Smart-Intake Module — public, password-less daily submit from the
// employee's phone screen (InventoryPortal.js, /inv/:token).
//
// Same token-validation contract as guest-portal-data/guest-portal-ops-request
// (UUID-shape guard + service-role lookup) — see those functions for why.
//
// Nothing this writes is "live" — it creates one inventory_submissions row
// (status:'pending') + its inventory_counts line items, and a manager must
// Approve / Edit-before-approve / Reject it from InventoryApprovalQueue.js
// before it counts as anything. restock_suggested is computed HERE, from
// inventory_items.par_level — never trusted from the client request body.

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same number as guest-portal-ops-request's ADIR_PHONE — duplicated, not
// imported (Deno functions don't share modules across function boundaries in
// this repo; same convention as the SLA_CATEGORY_MINUTES duplication in
// sla-escalation-cron).
const ADIR_PHONE = "972546294885";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, counts } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");
    if (!Array.isArray(counts) || counts.length === 0) throw new Error("counts[] required");

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

    const itemIds = counts
      .map((c: { itemId?: unknown }) => c?.itemId)
      .filter((id: unknown): id is number => typeof id === "number");

    const { data: items, error: itemsErr } = await supabase
      .from("inventory_items")
      .select("id, par_level")
      .in("id", itemIds.length > 0 ? itemIds : [-1]);
    if (itemsErr) throw new Error(`items_lookup_error: ${itemsErr.message}`);

    const parLevelById = new Map((items ?? []).map((it) => [it.id as number, it.par_level as number | null]));

    const { data: submission, error: subErr } = await supabase
      .from("inventory_submissions")
      .insert({ location_name: link.location_name, status: "pending" })
      .select("id")
      .maybeSingle();
    if (subErr) throw new Error(`submission_insert_error: ${subErr.message}`);
    if (!submission) throw new Error("submission_insert_returned_nothing");

    const countRows = counts
      .filter((c: { itemId?: unknown; quantity?: unknown }) =>
        typeof c?.itemId === "number" && typeof c?.quantity === "number")
      .map((c: { itemId: number; quantity: number }) => {
        const parLevel = parLevelById.get(c.itemId) ?? null;
        return {
          submission_id:     submission.id,
          item_id:            c.itemId,
          counted_quantity:   c.quantity,
          restock_suggested: parLevel === null ? null : parLevel - c.quantity,
        };
      });

    if (countRows.length === 0) throw new Error("no_valid_counts_in_request");

    const { error: countsErr } = await supabase.from("inventory_counts").insert(countRows);
    if (countsErr) throw new Error(`counts_insert_error: ${countsErr.message}`);

    // Best-effort manager alert — a Whapi failure must never block the
    // employee's success screen, the submission row already exists and is
    // visible in the approval queue regardless.
    try {
      const text =
        `📦 INVENTORY SUBMITTED — ${link.location_name}\n` +
        `${countRows.length} items reported, awaiting your approval.\n` +
        `Please check the inventory approval queue.`;
      await sendWhapiText(ADIR_PHONE, text, { noLinkPreview: true });
    } catch (e) {
      console.warn(`[inventory-portal-submit] submission ${submission.id} created but manager alert failed:`, (e as Error).message);
    }

    return new Response(
      JSON.stringify({ ok: true, submissionId: submission.id }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[inventory-portal-submit] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
