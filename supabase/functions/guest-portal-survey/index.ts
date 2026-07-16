// supabase/functions/guest-portal-survey/index.ts
// Guest Experience Survey — Guest Portal write path.
//
// MVP audience: day-pass (day_guest / premium_day_guest) guests who have a
// spa booking that day. Categories come from bot_config.guest_survey_ui
// (staff-editable, including custom keys). Scores stored in
// guest_surveys.ratings jsonb; legacy six columns mirrored when present.
//
// Positive gate (overall≥8 AND avg categories≥8.0): Google review CTA +
// suites booking CTA (https://www.dream-island.co.il/suites).
// Negative (any category≤4 OR overall≤4): guest_feedback mirror row.

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  DEFAULT_SUITES_CTA_URL,
  isPositiveSurveyAverage,
  LEGACY_SURVEY_CATEGORY_KEYS,
  normalizeGuestSurveyUi,
} from "../_shared/guestSurveyUi.ts";
import {
  isGuestPortalSurveyEligible,
  resolveSurveyVisitDate,
} from "../_shared/guestSurveyEligibility.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_CTA_MIN_OVERALL = 8;
const GOOGLE_CTA_MIN_AVG_CATEGORY = 8.0;
const NEGATIVE_CATEGORY_MAX = 4;
const NEGATIVE_OVERALL_MAX = 4;

const GOOGLE_REVIEW_URL = Deno.env.get("GOOGLE_REVIEW_URL") ?? "";

function isValidScore(n: unknown): n is number {
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: surveyUiRow } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", "guest_survey_ui")
      .maybeSingle();
    const surveyUi = normalizeGuestSurveyUi(surveyUiRow?.config_value ?? null);

    const scoreMap = scores as Record<string, unknown>;
    const categoryValues: number[] = [];
    const ratings: Record<string, number> = {};
    for (const cat of surveyUi.categories) {
      if (!isValidScore(scoreMap[cat.key])) {
        return new Response(
          JSON.stringify({ ok: false, error: `invalid_score_${cat.key}` }),
          { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      const v = scoreMap[cat.key] as number;
      categoryValues.push(v);
      ratings[cat.key] = v;
    }
    if (!isValidScore(scoreMap.overall_experience)) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_score_overall_experience" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
    const freeTextRaw = scoreMap.free_text;
    const freeText = typeof freeTextRaw === "string" ? freeTextRaw.trim().slice(0, 2000) : null;

    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id, phone, room, room_type, arrival_date, departure_date, spa_date, status, club_status")
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

    if (!isGuestPortalSurveyEligible(guest)) {
      return new Response(
        JSON.stringify({ ok: false, error: "not_eligible" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const visitDate = resolveSurveyVisitDate(guest);
    if (!visitDate) {
      return new Response(
        JSON.stringify({ ok: false, error: "missing_visit_date" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const avgCategory = categoryValues.reduce((sum, v) => sum + v, 0) / categoryValues.length;
    const overall = scoreMap.overall_experience as number;
    const googleCtaShown = overall >= GOOGLE_CTA_MIN_OVERALL && avgCategory >= GOOGLE_CTA_MIN_AVG_CATEGORY;
    const suitesCtaShown = isPositiveSurveyAverage(overall, categoryValues);
    const isNegative = categoryValues.some((v) => v <= NEGATIVE_CATEGORY_MAX) || overall <= NEGATIVE_OVERALL_MAX;

    const insertRow: Record<string, unknown> = {
      guest_id: guest.id,
      phone: guest.phone,
      visit_date: visitDate,
      free_text: freeText,
      google_cta_shown: googleCtaShown,
      suites_cta_shown: suitesCtaShown,
      portal_token_snapshot: token,
      overall_experience: overall,
      ratings,
    };
    for (const key of LEGACY_SURVEY_CATEGORY_KEYS) {
      insertRow[key] = typeof ratings[key] === "number" ? ratings[key] : null;
    }

    const { error: insertErr } = await supabase.from("guest_surveys").insert(insertRow);
    if (insertErr) {
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

    const suitesUrl = suitesCtaShown
      ? (surveyUi.suites_cta_url || DEFAULT_SUITES_CTA_URL)
      : null;

    // Club offer only after a positive survey (same gate as suites CTA).
    let clubOffer = suitesCtaShown;
    const { data: clubRow } = await supabase
      .from("guest_club_members")
      .select("status")
      .eq("phone", guest.phone as string)
      .maybeSingle();
    if (clubRow?.status === "active" || guest.club_status === "active") {
      clubOffer = false;
    }
    if (clubRow?.status === "declined" || clubRow?.status === "opted_out") {
      clubOffer = false;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        positiveReview: suitesCtaShown,
        googleCta: googleCtaShown,
        reviewUrl: googleCtaShown ? (GOOGLE_REVIEW_URL || "dream-island.co.il") : null,
        suitesCta: suitesCtaShown,
        suitesUrl,
        suitesCtaLabel: suitesCtaShown ? surveyUi.suites_cta_label : null,
        clubOffer,
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
