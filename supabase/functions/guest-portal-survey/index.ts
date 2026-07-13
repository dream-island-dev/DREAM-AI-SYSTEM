// supabase/functions/guest-portal-survey/index.ts
// Guest Experience Survey — Guest Portal write path.
//
// MVP audience: day-pass (day_guest / premium_day_guest) guests who have a
// spa booking that day (guests.spa_date === arrival_date, same write-through
// truth guest-portal-data reads for eligibility). One survey per visit —
// enforced by guest_surveys' UNIQUE(guest_id, visit_date), not just here.
//
// Positive gate (tunable constants below): overall_experience >= 8 AND the
// average of the six 1-5 category scores >= 4.0 → Google review CTA shown.
// Negative outcome (any category <=2 OR overall <=4) mirrors a row into
// guest_feedback (source='structured_survey') so it surfaces in the existing
// staff attention triage — same convention as the post-stay button path.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORY_FIELDS = [
  "patio", "live_kitchen", "chestnut_restaurant", "service_team", "spa", "cleaning_maintenance",
] as const;

/** Mike-confirmed gate (product lock): overall>=8 AND avg categories>=4.0 → Google CTA. */
const GOOGLE_CTA_MIN_OVERALL = 8;
const GOOGLE_CTA_MIN_AVG_CATEGORY = 4.0;
/** Any category <=2 OR overall <=4 → negative attention mirror row. */
const NEGATIVE_CATEGORY_MAX = 2;
const NEGATIVE_OVERALL_MAX = 4;

const GOOGLE_REVIEW_URL = Deno.env.get("GOOGLE_REVIEW_URL") ?? "";

function isValidCategoryScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

function isValidOverallScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { token, scores } = body ?? {};
    if (!token || typeof token !== "string") throw new Error("token required");

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(token)) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (!scores || typeof scores !== "object") throw new Error("scores required");
    for (const field of CATEGORY_FIELDS) {
      if (!isValidCategoryScore((scores as Record<string, unknown>)[field])) {
        return new Response(
          JSON.stringify({ ok: false, error: `invalid_score_${field}` }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
    }
    if (!isValidOverallScore((scores as Record<string, unknown>).overall_experience)) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_score_overall_experience" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    const freeTextRaw = (scores as Record<string, unknown>).free_text;
    const freeText = typeof freeTextRaw === "string" ? freeTextRaw.trim().slice(0, 2000) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, phone, room_type, arrival_date, spa_date, status")
      .eq("portal_token", token)
      .maybeSingle();
    if (guestErr) throw new Error(`lookup_error: ${guestErr.message}`);
    if (!guest) {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_not_found" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    if (guest.status === "cancelled") {
      return new Response(
        JSON.stringify({ ok: false, error: "guest_cancelled" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Server-authoritative eligibility — same truth guest-portal-data exposes
    // as survey_eligible; the client's gating on that flag is UX only.
    const isDayPassRoomType = guest.room_type === "day_guest" || guest.room_type === "premium_day_guest";
    const spaDateStr = String((guest.spa_date as string | null) ?? "").trim().slice(0, 10);
    const arrivalStr = String((guest.arrival_date as string | null) ?? "").trim().slice(0, 10);
    if (!isDayPassRoomType || !spaDateStr || spaDateStr !== arrivalStr) {
      return new Response(
        JSON.stringify({ ok: false, error: "not_eligible" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    if (!arrivalStr) {
      return new Response(
        JSON.stringify({ ok: false, error: "missing_visit_date" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const categoryValues = CATEGORY_FIELDS.map((f) => (scores as Record<string, number>)[f]);
    const avgCategory = categoryValues.reduce((sum, v) => sum + v, 0) / categoryValues.length;
    const overall = (scores as Record<string, number>).overall_experience;
    const googleCtaShown = overall >= GOOGLE_CTA_MIN_OVERALL && avgCategory >= GOOGLE_CTA_MIN_AVG_CATEGORY;
    const isNegative = categoryValues.some((v) => v <= NEGATIVE_CATEGORY_MAX) || overall <= NEGATIVE_OVERALL_MAX;

    const insertRow: Record<string, unknown> = {
      guest_id: guest.id,
      phone: guest.phone,
      visit_date: arrivalStr,
      free_text: freeText,
      google_cta_shown: googleCtaShown,
      portal_token_snapshot: token,
    };
    for (const f of CATEGORY_FIELDS) insertRow[f] = (scores as Record<string, number>)[f];
    insertRow.overall_experience = overall;

    const { error: insertErr } = await supabase.from("guest_surveys").insert(insertRow);
    if (insertErr) {
      // UNIQUE(guest_id, visit_date) — one completed survey per visit.
      if (insertErr.code === "23505" || /duplicate key/i.test(insertErr.message)) {
        return new Response(
          JSON.stringify({ ok: false, error: "already_submitted" }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`insert_error: ${insertErr.message}`);
    }

    if (isNegative) {
      const summary = freeText || "אורח מילא סקר חוויה עם ציון נמוך — ללא הערה חופשית.";
      const { error: feedbackErr } = await supabase.from("guest_feedback").insert({
        guest_id:      guest.id,
        phone:         guest.phone,
        sentiment:     "negative",
        feedback_text: summary,
        source:        "structured_survey",
      });
      if (feedbackErr) {
        console.warn("[guest-portal-survey] guest_feedback mirror insert failed (non-blocking):", feedbackErr.message);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        googleCta: googleCtaShown,
        reviewUrl: googleCtaShown ? (GOOGLE_REVIEW_URL || "dream-island.co.il") : null,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guest-portal-survey] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
