// supabase/functions/guest-portal-upsell/index.ts
// Pre-Arrival Guest Portal — in-scroll one-click upsell dispatch.
//
// Validates the guest by `portal_token` (same credential as
// guest-portal-data, service-role lookup) and inserts a row into
// `guest_alerts` with alert_type='upsell_opportunity' (migration 012 already
// defined this exact type — never wired to a writer until now).
//
// REDESIGNED (was: tasks insert + Whapi group card) — a guest clicking
// "order a wine workshop" is a sales lead for staff to act on at their own
// pace, not an operational ticket that needs claiming/SLA-escalation into
// the staff WhatsApp group the moment it's clicked. guest_alerts is the
// right home: it already surfaces in-app via RequestsAlertWidget.js's 📋 FAB
// (realtime badge + toast, visible from anywhere in the app) and
// RequestsBoard.js's resolve-with-note flow — no WhatsApp group ping at all.
// sla-escalation-cron's existing 10-min-unresolved → personal 1:1 ping to
// the duty manager (SLA_GUEST_ALERT_PHONE, Meta) still applies here exactly
// as it already does for every other guest_alerts row — that's a measured
// "nobody looked at this in 10 minutes" nudge, not a group blast, so it's
// kept as-is rather than suppressed.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, upsellLabel } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");
    if (!upsellLabel || typeof upsellLabel !== "string") throw new Error("upsellLabel required");

    // portal_token is a UUID column — a malformed token (typo, truncated
    // link) throws a Postgres type error at query time, not a clean "0
    // rows". Validate the shape first so that case returns the same
    // guest_not_found a guest sees for a well-formed-but-unknown token,
    // instead of leaking a raw DB error message to the client.
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

    // guest_alerts.phone is NOT NULL (migration 012) — a guest row with no
    // phone on file can't be alerted against; surface that clearly instead
    // of a constraint-violation error from the insert below.
    if (!guest.phone) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_has_no_phone" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: alert, error: insErr } = await supabase
      .from("guest_alerts")
      .insert({
        guest_id:   guest.id,
        phone:      guest.phone,
        alert_type: "upsell_opportunity",
        message:    `[פורטל אורח${guest.room ? " — " + guest.room : ""}] ${upsellLabel}`.trim(),
        resolved:   false,
      })
      .select("id")
      .maybeSingle();
    if (insErr) throw new Error(`alert_insert_error: ${insErr.message}`);

    return new Response(
      JSON.stringify({ ok: true, alertId: alert?.id ?? null }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-upsell] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
