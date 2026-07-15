// Smart Paste — client-side fuzzy match + scenario classification after parse-raw-paste.
import { buildEnrichGuestPatch } from "./guestImportIntelligence";
import {
  inferMealPlanFromHints,
  mealPlanLabel,
  normalizeMealPlan,
} from "../data/stayMealsSchema";

/** @typedef {'sync_enrich'|'suite_missing_alert'|'day_guest_optional'} SmartPasteScenario */

/**
 * Normalize meal_plan from HB/FB hints when Gemini returned label only.
 * @param {object} candidate
 */
export function normalizePasteCandidate(candidate) {
  const inferred = inferMealPlanFromHints(candidate);
  const meal_plan = inferred !== "none" ? inferred : normalizeMealPlan(candidate.meal_plan);
  return { ...candidate, meal_plan };
}

/**
 * Map parse-raw-paste candidate → enrich patch keys on guests row.
 * @param {object} candidate
 */
export function candidateToImportFields(candidate) {
  const c = normalizePasteCandidate(candidate);
  const fields = {};
  if (c.meal_plan && c.meal_plan !== "none") {
    fields.meal_plan = c.meal_plan;
  }
  if (c.spa_time) fields.spa_time = c.spa_time;
  if (c.spa_date) fields.spa_date = c.spa_date;
  if (c.order_number) fields.order_number = c.order_number;
  if (c.phone_raw) fields.phone = c.phone_raw;
  if (c.guest_name) fields.name = c.guest_name;
  if (c.guest_count != null) fields.treatment_count = c.guest_count;
  return fields;
}

/**
 * Human-readable list of fields the paste would add that are empty on the DB row.
 * @param {object} candidate
 * @param {object} existingRow — guests row from fuzzy match
 */
export function computeMissingEnrichFields(candidate, existingRow) {
  const c = normalizePasteCandidate(candidate);
  const importFields = candidateToImportFields(c);
  const patch = buildEnrichGuestPatch(importFields, existingRow);
  const labels = [];

  if (patch.meal_plan) {
    labels.push(`פנסיון: ${mealPlanLabel(patch.meal_plan)}`);
  }
  if (patch.spa_time) labels.push(`שעת ספא: ${patch.spa_time}`);
  if (patch.spa_date) labels.push(`תאריך ספא: ${patch.spa_date}`);
  if (patch.order_number) labels.push(`מספר הזמנה: ${patch.order_number}`);
  if (patch.phone) labels.push(`טלפון: ${patch.phone}`);
  if (patch.name) labels.push(`שם: ${patch.name}`);
  if (patch.treatment_count != null) labels.push(`כמות אורחים/טיפולים: ${patch.treatment_count}`);

  return { patch, labels };
}

/**
 * Run match_guest_fuzzy per candidate and assign UI scenario.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object[]} candidates — from parse-raw-paste
 */
export async function classifySmartPasteCandidates(supabase, candidates) {
  const classified = [];

  for (const raw of candidates) {
    const candidate = normalizePasteCandidate(raw);

    if (candidate.guest_type === "day_guest") {
      classified.push({
        scenario: /** @type {SmartPasteScenario} */ ("day_guest_optional"),
        candidate,
        matches: [],
        bestMatch: null,
        missing: { patch: {}, labels: [] },
      });
      continue;
    }

    let matches = [];
    if (candidate.guest_name) {
      const { data, error } = await supabase.rpc("match_guest_fuzzy", {
        p_name: candidate.guest_name,
        p_arrival_date: candidate.arrival_date || null,
      });
      if (error) console.warn("[smartPaste] match_guest_fuzzy:", error.message);
      matches = Array.isArray(data) ? data : [];
    }

    const bestMatch = matches[0] ?? null;

    if (!bestMatch) {
      classified.push({
        scenario: "suite_missing_alert",
        candidate,
        matches,
        bestMatch: null,
        missing: { patch: {}, labels: [] },
      });
      continue;
    }

    const missing = computeMissingEnrichFields(candidate, bestMatch);
    classified.push({
      scenario: "sync_enrich",
      candidate,
      matches,
      bestMatch,
      missing,
    });
  }

  return classified;
}

export const SCENARIO_META = {
  sync_enrich: {
    title: "סנכרון והשלמה",
    icon: "🔄",
    color: "#1A56DB",
    bg: "#E8F0FE",
  },
  suite_missing_alert: {
    title: "התראת חוסר",
    icon: "⚠️",
    color: "#B91C1C",
    bg: "#FEE2E2",
  },
  day_guest_optional: {
    title: "אורחי יום (אופציונלי)",
    icon: "☀️",
    color: "#A16207",
    bg: "#FEF9C3",
  },
};
