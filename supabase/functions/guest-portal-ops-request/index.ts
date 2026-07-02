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
// it, and (b) sends a personal notify-only DM — future suite room-service
// requests go to the dedicated Suites management Whapi group, not Adir and
// never the general ops Whapi group. In-house requests still go to Adir.

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import {
  futureArrivalTag,
  shouldRouteFutureSuiteRoomServiceToDedicatedPhone,
  SUITES_ROOM_SERVICE_GROUP_ID,
} from "../_shared/futureSuiteRoomServiceRouting.ts";
import { resolveRouting } from "../_shared/routingConfig.ts";

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

    // arrival_date/status feed the future-arrival check below — a guest can
    // open the portal and request room service days before they check in
    // (the portal link works pre-arrival, see GuestPortal.js), so Adir's alert
    // needs to say so rather than implying someone is on-site right now.
    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, room, room_type, arrival_date, status")
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
    const tag = futureArrivalTag(guest.arrival_date as string | null, guest.status as string | null);

    const { data: task, error: insertErr } = await supabase
      .from("tasks")
      .insert({
        room_number: guest.room,
        // Room service is F&B's job, not general "תפעול" — same exact
        // literal string as OperationsBoard.js's HOTEL_DEPARTMENTS so an
        // F&B-scoped manager's department filter picks this task up.
        department:  'מזמ"ש (F&B)',
        // Future-arrival tag embedded directly in the description (not just
        // the live frontend badge) so it's visible to the receptionist
        // wherever the raw text is read — board, export, or Adir's DM below.
        description: `${tag ? tag + " — " : ""}${upsellLabel}${guest.name ? " — " + guest.name : ""}`,
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
    // Future suite room-service → dedicated Suites line; in-house / other → Adir.
    const routeToSuites = shouldRouteFutureSuiteRoomServiceToDedicatedPhone({
      arrivalDateStr: guest.arrival_date as string | null,
      status:         guest.status as string | null,
      department:     'מזמ"ש (F&B)',
      labelOrDescription: upsellLabel,
      roomType:       guest.room_type as string | null,
      source:         "portal_room_service",
    });
    // routing_config (migration 121) — Room Service is a GUEST REQUESTS-channel
    // intent (enable_sla=false by seed default). If an admin has configured a
    // dedicated group for 'portal_room_service' via RoutingControlCenter.js,
    // that wins over the future/in-house Suites-vs-Adir split below — the whole
    // point of the dedicated "בקשות אורחים" channel is that Room Service always
    // lands there, regardless of arrival timing. Unconfigured (null) falls back
    // to the exact pre-existing behavior.
    const routing = await resolveRouting(supabase, "portal_room_service", {
      destination_board: "requests",
      whatsapp_group_id: null,
      enable_sla: false,
    });
    const notifyTo = routing.whatsapp_group_id || (routeToSuites ? SUITES_ROOM_SERVICE_GROUP_ID : ADIR_PHONE);

    try {
      const text =
        `🍽️ ROOM SERVICE REQUEST — Suite ${roomLabel} (${guest.name ?? "Guest"})\n` +
        `${upsellLabel}` +
        (tag ? `\n${tag}` : "") +
        `\nPlease check the Operations Board to claim it.`;
      await sendWhapiText(notifyTo, text, { noLinkPreview: true });
    } catch (e) {
      console.warn(`[guest-portal-ops-request] task ${task?.id} created but alert failed (${routeToSuites ? "suites" : "adir"}):`, (e as Error).message);
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
