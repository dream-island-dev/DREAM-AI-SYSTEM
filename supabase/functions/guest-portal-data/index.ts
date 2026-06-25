// supabase/functions/guest-portal-data/index.ts
// Pre-Arrival Guest Portal — public, password-less data fetch.
//
// Looks a guest up by `portal_token` (migration 083, the magic-link
// credential — NOT phone/id, see that migration's comment for why) using the
// SERVICE ROLE key, and returns only a hand-picked safe subset of columns.
// `guests` RLS stays "authenticated only" (migration 028) — this function is
// the only thing an unauthenticated guest-facing page is allowed to read
// through, and it explicitly never selects phone, payment_amount,
// payment_link_url, guest_notes, claimed_by, attention_reason,
// needs_callback, requires_attention, or order_number.

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

    // portal_token is a UUID column — a malformed token (typo, truncated
    // link, someone poking at the URL) throws a Postgres type error at query
    // time, not a clean "0 rows". Validate the shape first so that case
    // returns the same guest_not_found a guest sees for a well-formed-but-
    // unknown token, instead of leaking a raw DB error message to the client.
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

    const { data: guest, error: err } = await supabase
      .from("guests")
      .select("name, room, room_type, arrival_date, departure_date, spa_time, meal_time, meal_location, status")
      .eq("portal_token", token)
      .maybeSingle();

    if (err) throw new Error(`lookup_error: ${err.message}`);
    if (!guest) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Room Masking ("SYSTEM ARCHITECTURE, ZERO-REJECTION, ROOM MASKING & UX"
    // session) — the specific suite name/number is operationally swappable
    // until check-in actually happens; this portal is the public guest-
    // facing surface, so it never reveals it before then. A suite guest
    // still sees a generic "luxury suite" label rather than nothing — the
    // directive's exact framing ("should only know they are booked into a
    // luxury suite"), not a silent disappearance of the field.
    const maskedGuest = { ...guest };
    if (guest.status !== "checked_in") {
      maskedGuest.room = guest.room_type === "suite" ? "סוויטת יוקרה" : null;
    }

    return new Response(
      JSON.stringify({ ok: true, guest: maskedGuest }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-data] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
