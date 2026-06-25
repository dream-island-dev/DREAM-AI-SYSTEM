// supabase/functions/guest-portal-ops-request/index.ts
// Pre-Arrival Guest Portal — in-scroll OPERATIONAL request dispatch.
//
// Sibling of guest-portal-upsell, but for the OTHER half of the "Enterprise
// Routing" split (CLAUDE.md): a guest tapping "הזמנת שירות לחדר" on the
// Armonim Restaurant scene is asking for a physical, actionable task (food to
// the room), NOT a sales lead. guest-portal-upsell's destination
// (guest_alerts → Requests Board, picked up at staff's own pace) is the wrong
// home for this — it needs to land on the Operations & Maintenance Board
// (tasks table) where it's claimable and SLA-tracked, exactly like a
// maintenance/housekeeping report, plus a direct heads-up to the duty manager
// (Adir) so a kitchen/delivery coordination call doesn't wait for someone to
// happen to open the dashboard.
//
// Same token-validation contract as guest-portal-upsell (UUID-shape guard +
// service-role guest lookup by portal_token) — see that function for why.
//
// Resolution path is deliberately the in-app Operations Board claim/done
// buttons, NOT a 👍🏼 reaction: whapi-webhook's reaction sweep only matches
// reactions posted inside the ops GROUP chat (chatId ending "@g.us") — a
// reaction on Adir's personal 1:1 alert would be silently ignored by that
// filter. So this function does NOT post a group card; it (a) creates the
// task so the in-app board's claim/done flow — already documented as "the
// RELIABLE primary path" in OperationsBoard.js's header comment — can resolve
// it, and (b) sends Adir a personal notify-only DM. Wiring the personal DM
// into the reaction-sweep too would mean widening that filter's scope, which
// is a bigger, riskier change than this session asked for.

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Same number as task-action/index.ts's ACTOR_PHONES.Adir and whapi-webhook's
// reverse lookup map — duplicated, not imported (Deno functions don't share
// modules across function boundaries in this repo; same convention as the
// SLA_CATEGORY_MINUTES duplication in sla-escalation-cron).
const ADIR_PHONE = "972546294885";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, upsellLabel } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");
    if (!upsellLabel || typeof upsellLabel !== "string") throw new Error("upsellLabel required");

    // portal_token is a UUID column — guard malformed tokens before they hit
    // Postgres as a raw type error (same fix as guest-portal-data/-upsell).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, room")
      .eq("portal_token", token)
      .maybeSingle();
    if (guestErr) throw new Error(`lookup_error: ${guestErr.message}`);
    if (!guest) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const roomLabel = guest.room ?? "—";

    const { data: task, error: insertErr } = await supabase
      .from("tasks")
      .insert({
        room_number: guest.room,
        // Room service is F&B's job, not general "תפעול" — same exact
        // literal string as OperationsBoard.js's HOTEL_DEPARTMENTS so an
        // F&B-scoped manager's department filter picks this task up.
        department:  'מזמ"ש (F&B)',
        description: `${upsellLabel}${guest.name ? " — " + guest.name : ""}`,
        priority:    "normal",
        status:      "open",
        source:      "portal_room_service",
        guest_id:    guest.id,
        action_token: crypto.randomUUID(),
      })
      .select("id")
      .maybeSingle();
    if (insertErr) throw new Error(`task_insert_error: ${insertErr.message}`);

    // Best-effort personal alert to Adir — a Whapi failure must never block
    // the guest's success toast, the task row already exists and is visible
    // on the Operations Board regardless.
    try {
      const text =
        `🍽️ ROOM SERVICE REQUEST — Suite ${roomLabel} (${guest.name ?? "Guest"})\n` +
        `${upsellLabel}\n` +
        `Please check the Operations Board to claim it.`;
      await sendWhapiText(ADIR_PHONE, text, { noLinkPreview: true });
    } catch (e) {
      console.warn(`[guest-portal-ops-request] task ${task?.id} created but Adir alert failed:`, (e as Error).message);
    }

    return new Response(
      JSON.stringify({ ok: true, taskId: task?.id ?? null }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-ops-request] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
