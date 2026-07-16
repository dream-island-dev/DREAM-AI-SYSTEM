// supabase/functions/guest-portal-data/index.ts
// Pre-Arrival Guest Portal — public, password-less data fetch.
//
// Looks a guest up by `portal_token` (migration 083, the magic-link
// credential — NOT phone/id, see that migration's comment for why) using the
// SERVICE ROLE key, and returns only a hand-picked safe subset of columns.
// `guests` RLS stays "authenticated only" (migration 028) — this function is
// the only thing an unauthenticated guest-facing page is allowed to read
// through, and it explicitly never selects phone, guest_notes, claimed_by,
// attention_reason, needs_callback, requires_attention, or order_number.
// Payment: only direct_payment_url/payment_link_url + payment_amount are exposed
// when balance > 0 — never staff-internal fields (ezgo_portal_url, etc.).

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatSpaScheduleDisplay, hasSpaBooking } from "../_shared/spaSchedule.ts";
import { buildMealsItinerary } from "../_shared/stayMeals.ts";
import { DEFAULT_SUITES_CTA_URL, normalizeGuestSurveyUi } from "../_shared/guestSurveyUi.ts";
import { normalizeGuestClubUi } from "../_shared/guestClubUi.ts";
import { isGuestPortalSurveyEligible } from "../_shared/guestSurveyEligibility.ts";

const GOOGLE_REVIEW_URL = Deno.env.get("GOOGLE_REVIEW_URL") ?? "";

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
      .select("id, name, room, room_type, arrival_date, departure_date, spa_time, spa_date, meal_time, meal_location, meal_plan, breakfast_time, lunch_time, dinner_time, status, payment_amount, direct_payment_url, payment_link_url, club_status")
      .eq("portal_token", token)
      .maybeSingle();

    const { data: spaToggleRow, error: spaToggleErr } = await supabase
      .from("system_settings")
      .select("value_bool")
      .eq("key", "enable_spa_request_button")
      .maybeSingle();
    if (spaToggleErr) {
      console.warn("[guest-portal-data] system_settings lookup failed (default enable):", spaToggleErr.message);
    }

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

    // Secure checkout — expose payment link + balance only when guest owes money.
    const payUrlRaw = String(
      (guest.direct_payment_url as string | null) ||
      (guest.payment_link_url as string | null) ||
      "",
    ).trim();
    const payAmount = guest.payment_amount != null ? Number(guest.payment_amount) : null;
    const balanceDue = payAmount != null && !Number.isNaN(payAmount) && payAmount > 0;
    delete (maskedGuest as Record<string, unknown>).direct_payment_url;
    delete (maskedGuest as Record<string, unknown>).payment_link_url;
    (maskedGuest as Record<string, unknown>).payment_url =
      balanceDue && payUrlRaw ? payUrlRaw : null;
    (maskedGuest as Record<string, unknown>).payment_amount = balanceDue ? payAmount : null;
    (maskedGuest as Record<string, unknown>).payment_status = balanceDue ? "pending" : "paid";

    // ── Upsell items — server-side filtered by guest's room_type ─────────
    // visibility_settings TEXT[] (migration 097) lists which room_type values
    // can see each item. Filter: visibility_settings @> ARRAY[guestRoomType]
    // (array-contains, GIN-indexed).
    // Backward compat: if room_type is unknown/null, return all active items
    // so a guest is never shown an empty portal due to a missing enum value.
    const guestRoomType: string = (guest.room_type as string) ?? "";
    let itemsQuery = supabase
      .from("upsell_items")
      .select("id, name, description, price, category, link_url")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (guestRoomType) {
      // PostgREST 'cs' operator = "array contains" — true when
      // visibility_settings contains guestRoomType as an element.
      itemsQuery = itemsQuery.filter("visibility_settings", "cs", `{${guestRoomType}}`);
    }

    const { data: upsellItems, error: upsellErr } = await itemsQuery;

    if (upsellErr) {
      // Non-fatal — portal still loads without upsell items (FAIL VISIBLE
      // principle: portal doesn't crash; items section simply won't render).
      console.warn("[guest-portal-data] upsell_items fetch failed (non-blocking):", upsellErr.message);
    }

    // ── Portal scenes — two-level visibility filtering ───────────────────
    // Both levels are executed in JavaScript (not at the DB query level) so
    // that Level 2 CTA filtering always runs *before* Level 1 scene dropping.
    // Using a PostgREST array-contains filter at the DB level was the root
    // cause of the bug: a scene whose `visibility_settings` correctly included
    // `day_guest` was being dropped entirely because the `cs` filter was
    // evaluated before the `ctas` array was ever inspected — the guest lost
    // the whole scene instead of just the suite-only CTAs inside it.
    //
    // Fetching all active scenes and filtering in JS is safe: the portal has
    // O(10) scenes, not thousands; the extra rows are negligible.
    //
    // If room_type is unknown/null: all scenes and all CTAs pass (backward
    // compat — guest sees more, not less; same convention as upsell_items).
    const scenesBaseQuery = supabase
      .from("portal_scenes")
      .select("image, title, body, ctas, visibility_settings")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    const { data: rawScenes, error: scenesErr } = await scenesBaseQuery;

    if (scenesErr) {
      console.warn("[guest-portal-data] portal_scenes fetch failed (non-blocking):", scenesErr.message);
    }

    // Level 1 + Level 2 in a single reduce so we never build an intermediate
    // array of scenes with their full un-filtered CTA lists.
    const scenes: Array<{ image: unknown; title: unknown; body: unknown; ctas: unknown[] }> = [];
    for (const scene of rawScenes ?? []) {
      // ── Level 1: scene visibility ──────────────────────────────────────────
      // Keep scene if guest's room_type is in visibility_settings.
      // Absent/empty visibility_settings → no restriction (backward compat).
      const sceneviz = scene.visibility_settings as string[] | null | undefined;
      const sceneVisible =
        !guestRoomType          // unknown room_type → show all
        || !sceneviz            // column null/undefined → no restriction
        || sceneviz.length === 0  // empty array → no restriction
        || sceneviz.includes(guestRoomType);

      if (!sceneVisible) continue; // Level 1 gate

      // ── Level 2: CTA visibility within the kept scene ─────────────────────
      // Strip individual CTAs the guest isn't entitled to.
      // Keep CTA if: no visibility field, empty array, or includes room_type.
      // The scene itself is always kept — even if every CTA is stripped.
      const filteredCtas = ((scene.ctas as unknown[]) ?? []).filter((cta: unknown) => {
        const c = cta as Record<string, unknown>;
        const vis = c.visibility as string[] | null | undefined;
        return !vis || vis.length === 0 || !guestRoomType || vis.includes(guestRoomType);
      });

      scenes.push({
        image: scene.image,
        title: scene.title,
        body:  scene.body,
        ctas:  filteredCtas,
      });
    }

    const spaTimeRaw = String((guest.spa_time as string | null) ?? "").trim();
    const spaDateRaw = String((guest.spa_date as string | null) ?? "").trim().slice(0, 10);
    const hasSpaBookingFlag = hasSpaBooking(spaDateRaw, spaTimeRaw);
    const spaScheduleDisplay = formatSpaScheduleDisplay(spaDateRaw, spaTimeRaw);
    (maskedGuest as Record<string, unknown>).spa_schedule_display = spaScheduleDisplay;
    (maskedGuest as Record<string, unknown>).meals_itinerary = buildMealsItinerary(guest);
    const enableSpaRequestButton = spaToggleRow?.value_bool !== false;

    // Guest Experience Survey — day-pass+spa OR suite post-checkout (checkout_fb).
    const surveyEligible = isGuestPortalSurveyEligible(guest);
    let surveyCompleted = false;
    let surveyScores: Record<string, unknown> | null = null;
    if (guest.id != null) {
      const { data: surveyRow, error: surveyErr } = await supabase
        .from("guest_surveys")
        .select("patio, live_kitchen, chestnut_restaurant, service_team, spa, cleaning_maintenance, overall_experience, free_text, google_cta_shown, suites_cta_shown, ratings")
        .eq("guest_id", guest.id as number)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (surveyErr) {
        console.warn("[guest-portal-data] guest_surveys fetch failed (non-blocking):", surveyErr.message);
      } else if (surveyRow) {
        surveyCompleted = true;
        surveyScores = surveyRow;
      }
    }
    (maskedGuest as Record<string, unknown>).survey_eligible = surveyEligible;
    (maskedGuest as Record<string, unknown>).survey_completed = surveyCompleted;
    (maskedGuest as Record<string, unknown>).survey_scores = surveyScores;
    (maskedGuest as Record<string, unknown>).club_status =
      (guest as Record<string, unknown>).club_status ?? null;
    delete (maskedGuest as Record<string, unknown>).id;

    // Editable Hebrew labels (staff Feedback → Surveys editor → bot_config).
    const { data: surveyUiRow, error: surveyUiErr } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", "guest_survey_ui")
      .maybeSingle();
    if (surveyUiErr) {
      console.warn("[guest-portal-data] guest_survey_ui fetch failed (defaults):", surveyUiErr.message);
    }
    const surveyUi = normalizeGuestSurveyUi(surveyUiRow?.config_value ?? null);

    const { data: clubUiRow, error: clubUiErr } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", "guest_club_ui")
      .maybeSingle();
    if (clubUiErr) {
      console.warn("[guest-portal-data] guest_club_ui fetch failed (defaults):", clubUiErr.message);
    }
    const clubUi = normalizeGuestClubUi(clubUiRow?.config_value ?? null);

    // Thank-you CTAs persist after refresh (club + Google + suites).
    let surveyThankYou: Record<string, unknown> | null = null;
    if (surveyCompleted && surveyScores) {
      const suitesCta = surveyScores.suites_cta_shown === true;
      const googleCta = surveyScores.google_cta_shown === true;
      const clubSt = String((guest as Record<string, unknown>).club_status ?? "").trim();
      let clubOffer = suitesCta;
      if (clubSt === "active" || clubSt === "declined" || clubSt === "opted_out") {
        clubOffer = false;
      }
      if (suitesCta || googleCta || clubOffer) {
        surveyThankYou = {
          positiveReview: suitesCta,
          googleCta,
          reviewUrl: googleCta ? (GOOGLE_REVIEW_URL || "dream-island.co.il") : null,
          suitesCta,
          suitesUrl: suitesCta ? (surveyUi.suites_cta_url || DEFAULT_SUITES_CTA_URL) : null,
          suitesCtaLabel: suitesCta ? surveyUi.suites_cta_label : null,
          clubOffer,
        };
      }
    }
    (maskedGuest as Record<string, unknown>).survey_thank_you = surveyThankYou;

    return new Response(
      JSON.stringify({
        ok: true,
        guest: maskedGuest,
        upsellItems: upsellItems ?? [],
        scenes,
        portalConfig: {
          has_spa_booking: hasSpaBookingFlag,
          enable_spa_request_button: enableSpaRequestButton,
          survey_ui: surveyUi,
          club_ui: clubUi,
        },
      }),
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
