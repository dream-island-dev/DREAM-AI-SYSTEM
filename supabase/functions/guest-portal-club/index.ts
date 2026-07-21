// supabase/functions/guest-portal-club/index.ts
// Guest Club opt-in / decline after structured survey thank-you screen.
//
// POST { token, action: "join" | "decline", guest_birthday?, partner_birthday?, wedding_anniversary? }
// Join requires guest_birthday (YYYY-MM-DD). Partner birthday + anniversary optional.
// After join/decline on positive survey — sends bot_scripts.positive_feedback_reply (Google review).

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseOptionalClubDate,
  parseRequiredClubBirthday,
} from "../_shared/guestClubUi.ts";
import { sendPostSurveyPositiveFeedbackWa } from "../_shared/postSurveyPositiveFeedback.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClubRequestBody = {
  token?: string;
  action?: string;
  guest_birthday?: string | null;
  partner_birthday?: string | null;
  wedding_anniversary?: string | null;
};

async function shouldSendPositiveSurveyWa(
  supabase: ReturnType<typeof createClient>,
  guestId: number,
): Promise<boolean> {
  const { data: surveyRow } = await supabase
    .from("guest_surveys")
    .select("google_cta_shown")
    .eq("guest_id", guestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return surveyRow?.google_cta_shown === true;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json() as ClubRequestBody;
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
      .select("id, phone, room_type, room, club_status")
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

    let guestBirthday: string | null = null;
    let partnerBirthday: string | null = null;
    let weddingAnniversary: string | null = null;

    if (action === "join") {
      guestBirthday = parseRequiredClubBirthday(body.guest_birthday);
      if (!guestBirthday) {
        return new Response(
          JSON.stringify({ ok: false, error: "guest_birthday_required" }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      partnerBirthday = parseOptionalClubDate(body.partner_birthday);
      weddingAnniversary = parseOptionalClubDate(body.wedding_anniversary);
    }

    if (guest.club_status === "active" && action === "decline") {
      return new Response(
        JSON.stringify({ ok: true, status: "active", alreadyMember: true, waFollowUpSent: false }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    if (guest.club_status === "active" && action === "join") {
      return new Response(
        JSON.stringify({ ok: true, status: "active", alreadyMember: true, waFollowUpSent: false }),
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
      guest_birthday: action === "join" ? guestBirthday : null,
      partner_birthday: action === "join" ? partnerBirthday : null,
      wedding_anniversary: action === "join" ? weddingAnniversary : null,
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

    let waFollowUpSent = false;
    const sendWa = await shouldSendPositiveSurveyWa(supabase, guest.id as number);
    if (sendWa && guest.phone) {
      const waResult = await sendPostSurveyPositiveFeedbackWa(supabase, {
        id: guest.id as number,
        phone: guest.phone as string,
        room_type: guest.room_type,
        room: guest.room,
      });
      waFollowUpSent = waResult.sent;
      if (!waResult.sent && waResult.error) {
        console.warn("[guest-portal-club] positive_feedback WA skipped:", waResult.error);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status: nextStatus,
        alreadyMember: false,
        waFollowUpSent,
      }),
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
