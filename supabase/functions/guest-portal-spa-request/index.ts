// supabase/functions/guest-portal-spa-request/index.ts
// Guest Personal Portal — one-click spa treatment request.
// Updates guests.requires_attention + guest_notes audit, alerts staff via
// guest_alerts, and sends the canonical Whapi auto-reply DM to the guest.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanPhoneForMention, sendWhapiText } from "../_shared/whapiSend.ts";

export const PORTAL_SPA_ATTENTION_REASON = "בקשת טיפול בספא";

export const PORTAL_SPA_GUEST_REPLY =
  "ראינו שביקשת טיפול בספא, העברתי את הבקשה לצוות, אפשר גם לחייג למרכז ההזמנות שלנו - 08-6705600.";

const PORTAL_SPA_AUDIT_LINE =
  "\n[System] האורח ביקש טיפול בספא דרך הפורטל האישי.";

const ADIR_PHONE = "972546294885";

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

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, name, phone, room, arrival_date, status, guest_notes")
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

    const tag = futureArrivalTag(guest.arrival_date as string | null, guest.status as string | null);
    const alertMessage =
      `[פורטל אורח — בקשת ספא${guest.room ? " — " + guest.room : ""}]` +
      `${tag ? " [" + tag + "]" : ""} ${PORTAL_SPA_ATTENTION_REASON}`.trim();

    const { data: alert, error: alertErr } = await supabase
      .from("guest_alerts")
      .insert({
        guest_id:   guest.id,
        phone:      guest.phone,
        alert_type: "request",
        message:    alertMessage,
        resolved:   false,
      })
      .select("id")
      .maybeSingle();
    if (alertErr) console.warn("[guest-portal-spa-request] guest_alerts insert:", alertErr.message);

    let whapiSent = false;
    try {
      const digits = cleanPhoneForMention(guest.phone as string);
      await sendWhapiText(digits, PORTAL_SPA_GUEST_REPLY, { noLinkPreview: true });
      whapiSent = true;
    } catch (e) {
      console.warn("[guest-portal-spa-request] Whapi guest DM failed:", (e as Error).message);
    }

    try {
      const staffText =
        `💆 PORTAL SPA REQUEST${guest.room ? " — Suite " + guest.room : ""} (${guest.name ?? "Guest"})\n` +
        `${PORTAL_SPA_ATTENTION_REASON}` +
        (tag ? `\n${tag}` : "") +
        `\nPlease check the Requests Board / guest profile.`;
      await sendWhapiText(ADIR_PHONE, staffText, { noLinkPreview: true });
    } catch (e) {
      console.warn("[guest-portal-spa-request] Adir notify failed:", (e as Error).message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        alertId: alert?.id ?? null,
        whapiSent,
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
