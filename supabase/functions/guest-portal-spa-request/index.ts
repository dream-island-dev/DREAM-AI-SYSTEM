// supabase/functions/guest-portal-spa-request/index.ts
// Guest Personal Portal — one-click spa treatment request.
// Updates guests.requires_attention + guest_notes audit, alerts staff via
// guest_alerts, and sends the canonical Whapi auto-reply DM to the guest.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onGuestAlertInserted } from "../_shared/guestAlertWhapiNotify.ts";
import {
  shouldRouteGuestOutboundViaWhapiSuites,
  primeGuestChannelConfig,
} from "../_shared/guestWhapiRouting.ts";
import { isEffectiveSuiteGuest } from "../_shared/suiteNames.ts";

export const PORTAL_SPA_ATTENTION_REASON = "בקשת טיפול בספא";

export const PORTAL_SPA_GUEST_REPLY =
  "היי, למתי תרצו לתאם טיפול בספא? נדאג שנציג מטעמנו יחזור אליכם בהקדם";

const PORTAL_SPA_AUDIT_LINE =
  "\n[System] האורח ביקש טיפול בספא דרך הפורטל האישי.";

function futureArrivalTag(arrivalDateStr: string | null, status: string | null): string | null {
  if (!arrivalDateStr || status === "checked_in") return null;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const arrival = new Date(`${arrivalDateStr}T00:00:00Z`);
  const daysAway = Math.round((arrival.getTime() - today.getTime()) / 86400000);
  if (daysAway <= 0) return null;
  return `⚠️ בקשה עתידית לתאריך ${arrivalDateStr} - בעוד ${daysAway} ימים`;
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") throw new Error("token required");

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    await primeGuestChannelConfig(supabase);

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, room, room_type, arrival_date, status, guest_notes, spa_time")
      .eq("portal_token", token)
      .maybeSingle();
    if (guestErr) throw new Error(`lookup_error: ${guestErr.message}`);
    if (!guest) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    if (!guest.phone) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_has_no_phone" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const { data: spaToggleRow } = await supabase
      .from("system_settings")
      .select("value_bool")
      .eq("key", "enable_spa_request_button")
      .maybeSingle();
    if (spaToggleRow?.value_bool === false) {
      return new Response(
        JSON.stringify({ ok: false, error: "spa_request_disabled" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const spaTime = String((guest.spa_time as string | null) ?? "").trim();
    if (spaTime && spaTime !== "null" && spaTime !== "undefined") {
      return new Response(
        JSON.stringify({ ok: false, error: "spa_already_scheduled" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const prevNotes = (guest.guest_notes as string | null) ?? "";
    const guestNotes = prevNotes.includes("ביקש טיפול בספא דרך הפורטל")
      ? prevNotes
      : `${prevNotes}${PORTAL_SPA_AUDIT_LINE}`;

    const { error: updErr } = await supabase
      .from("guests")
      .update({
        requires_attention:       true,
        requires_attention_since: new Date().toISOString(),
        attention_reason:         PORTAL_SPA_ATTENTION_REASON,
        guest_notes:              guestNotes,
      })
      .eq("id", guest.id);
    if (updErr) throw new Error(`guest_update_error: ${updErr.message}`);

    // Suite portal spa replies always target the physical Suites device —
    // independent of ACC guest_suites_channel (automation cohort toggle).
    // portal_spa_whapi bypasses that gate in whatsapp-send inbox_reply;
    // SOS mode still blocks Whapi. Day-pass follows cohort routing.
    const forceSuiteWhapi = isEffectiveSuiteGuest(guest);
    const outboundChannel =
      forceSuiteWhapi || shouldRouteGuestOutboundViaWhapiSuites(guest) ? "whapi" : "meta";
    const alertInboxChannel = outboundChannel;

    const tag = futureArrivalTag(guest.arrival_date as string | null, guest.status as string | null);
    const alertMessage =
      `[פורטל אורח — בקשת ספא${guest.room ? " — " + guest.room : ""}]` +
      `${tag ? " [" + tag + "]" : ""} ${PORTAL_SPA_ATTENTION_REASON}`.trim();

    const { data: alert, error: alertErr } = await supabase
      .from("guest_alerts")
      .insert({
        guest_id:   guest.id,
        phone:      guest.phone,
        alert_type: "spa_request",
        message:    alertMessage,
        resolved:   false,
      })
      .select("id")
      .maybeSingle();
    if (alertErr) console.warn("[guest-portal-spa-request] guest_alerts insert:", alertErr.message);

    onGuestAlertInserted(supabase, {
      guestId: guest.id as number,
      phone: guest.phone as string,
      message: alertMessage,
      alertType: "spa_request",
      guestName: guest.name as string | null,
      room: guest.room as string | null,
      sourceLabel: "Guest Portal",
      alsoPersonalDm: true,
      preferredInboxChannel: alertInboxChannel,
    }).catch((e: Error) => console.warn("[guest-portal-spa-request] staff notify failed:", e.message));

    let conciergeReplySent = false;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      const waRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          trigger: "inbox_reply",
          phone: guest.phone,
          message: PORTAL_SPA_GUEST_REPLY,
          inbox_channel: outboundChannel,
          portal_spa_whapi: forceSuiteWhapi,
          preserve_attention: true,
        }),
        signal: AbortSignal.timeout(28000),
      });
      const waData = await waRes.json().catch(() => ({}));
      conciergeReplySent = waRes.ok && (waData as { ok?: boolean }).ok !== false;
      if (!conciergeReplySent) {
        console.warn(`[guest-portal-spa-request] concierge reply failed (channel=${outboundChannel}):`, JSON.stringify(waData).slice(0, 300));
      }
    } catch (e) {
      console.warn("[guest-portal-spa-request] whatsapp-send invoke failed:", (e as Error).message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        alertId: alert?.id ?? null,
        conciergeReplySent,
        channel: outboundChannel,
        attentionReason: PORTAL_SPA_ATTENTION_REASON,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-spa-request] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
