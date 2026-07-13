// supabase/functions/guest-portal-club/index.ts
// Guest Club opt-in / decline after structured survey thank-you screen.
//
// POST { token, action: "join" | "decline" }
// Resolves guest by portal_token (same pattern as guest-portal-survey).
/// Zero-Spam: only guests who "join" become status=active; declined is stored
// so the portal does not re-ask forever.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json() as { token?: string; action?: string };
    const token = String(body.token ?? "").trim();
    const action = String(body.action ?? "").trim().toLowerCase();

    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    if (action !== "join" && action !== "decline") {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_action" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, phone, club_status")
      .eq("portal_token", token)
      .maybeSingle();
    if (guestErr) throw new Error(`guest_lookup: ${guestErr.message}`);
    if (!guest?.phone) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const phone = String(guest.phone).trim();
    const now = new Date().toISOString();
    const nextStatus = action === "join" ? "active" : "declined";

    // Never overwrite active → declined silently via this portal offer.
    // Active member who already joined keeps active; decline is no-op for them.
    if (guest.club_status === "active" && action === "decline") {
      return new Response(
        JSON.stringify({ ok: true, status: "active", alreadyMember: true }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    if (guest.club_status === "active" && action === "join") {
      return new Response(
        JSON.stringify({ ok: true, status: "active", alreadyMember: true }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const row: Record<string, unknown> = {
      guest_id: guest.id,
      phone,
      status: nextStatus,
      source: "survey_portal",
      portal_token_snapshot: token,
      updated_at: now,
      opted_in_at: action === "join" ? now : null,
      declined_at: action === "decline" ? now : null,
      opted_out_at: null,
    };

    const { error: upsertErr } = await supabase
      .from("guest_club_members")
      .upsert(row, { onConflict: "phone" });
    if (upsertErr) throw new Error(`club_upsert: ${upsertErr.message}`);

    const { error: guestUpdateErr } = await supabase
      .from("guests")
      .update({ club_status: nextStatus })
      .eq("id", guest.id);
    if (guestUpdateErr) {
      console.warn("[guest-portal-club] guests.club_status denorm failed:", guestUpdateErr.message);
    }

    return new Response(
      JSON.stringify({ ok: true, status: nextStatus, alreadyMember: false }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-club] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
