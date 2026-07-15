// Smart Paste — client-side fuzzy match + scenario classification after parse-raw-paste.
import { buildEnrichGuestPatch } from "./guestImportIntelligence";
import { normalizeMealPlan, MEAL_SLOT_LABELS, MEAL_SLOTS_BY_PLAN } from "../data/stayMealsSchema";

/** @typedef {'sync_enrich'|'suite_missing_alert'|'day_guest_optional'} SmartPasteScenario */

const MEAL_PLAN_LABELS = {
  none: "ללא פנסיון",
  dinner_only: "ארוחת ערב בלבד",
  half_board: "חצי פנסיון (HB)",
  full_board: "פנסיון מלא (FB)",
};

/**
 * Map parse-raw-paste candidate → enrich patch keys on guests row.
 * @param {object} candidate
 */
export function candidateToImportFields(candidate) {
  const fields = {};
  if (candidate.meal_plan && candidate.meal_plan !== "none") {
    fields.meal_plan = candidate.meal_plan;
  }
  if (candidate.spa_time) fields.spa_time = candidate.spa_time;
  if (candidate.spa_date) fields.spa_date = candidate.spa_date;
  if (candidate.order_number) fields.order_number = candidate.order_number;
  if (candidate.phone_raw) fields.phone = candidate.phone_raw;
  if (candidate.guest_name) fields.name = candidate.guest_name;
  if (candidate.guest_count != null) fields.treatment_count = candidate.guest_count;
  return fields;
}

/**
 * Human-readable list of fields the paste would add that are empty on the DB row.
 * @param {object} candidate
 * @param {object} existingRow — guests row from fuzzy match
 */
export function computeMissingEnrichFields(candidate, existingRow) {
  const importFields = candidateToImportFields(candidate);
  const patch = buildEnrichGuestPatch(importFields, existingRow);
  const labels = [];

  if (patch.meal_plan) {
    labels.push(`פנסיון: ${MEAL_PLAN_LABELS[patch.meal_plan] ?? patch.meal_plan}`);
  }
  if (patch.spa_time) labels.push(`שעת ספא: ${patch.spa_time}`);
  if (patch.spa_date) labels.push(`תאריך ספא: ${patch.spa_date}`);
  if (patch.order_number) labels.push(`מספר הזמנה: ${patch.order_number}`);
  if (patch.phone) labels.push(`טלפון: ${patch.phone}`);
  if (patch.name) labels.push(`שם: ${patch.name}`);
  if (patch.treatment_count != null) labels.push(`כמות אורחים/טיפולים: ${patch.treatment_count}`);

  const plan = normalizeMealPlan(existingRow?.meal_plan);
  const slots = MEAL_SLOTS_BY_PLAN[plan] ?? [];
  for (const slot of slots) {
    const col = slot === "dinner" ? "dinner_time" : `${slot}_time`;
    if (!existingRow?.[col] && candidate.meal_plan && candidate.meal_plan !== "none") {
      const label = MEAL_SLOT_LABELS[slot];
      if (label && !labels.some((l) => l.includes(label))) {
        labels.push(`${label} — חסר בפרופיל (פנסיון מזוהה בדוח)`);
      }
    }
  }

  return { patch, labels };
}

/**
 * Run match_guest_fuzzy per candidate and assign UI scenario.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object[]} candidates — from parse-raw-paste
 */
export async function classifySmartPasteCandidates(supabase, candidates) {
  const classified = [];

  for (const candidate of candidates) {
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
