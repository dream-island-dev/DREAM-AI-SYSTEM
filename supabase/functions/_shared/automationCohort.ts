// automationCohort.ts — applies_to audience resolution (suite/daypass × spa).
// Single server truth for cron, Live Queue, and ACC projection.
// Legacy: non_suite → daypass (umbrella). Umbrella daypass + specific stage_keys
// still use legacy stage-key gates in getAppliesToSkipReason until DB rows are
// migrated to daypass_spa / daypass_no_spa (migration 266).

import {
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
  type GuestRoomFields,
} from "./suiteNames.ts";

export type AppliesTo =
  | "all"
  | "suite"
  | "suite_spa"
  | "suite_no_spa"
  | "daypass"
  | "daypass_spa"
  | "daypass_no_spa"
  | "non_suite"; // legacy DB alias → daypass umbrella

export type GuestSpaVisitFields = GuestRoomFields & {
  spa_date?: unknown;
  arrival_date?: unknown;
};

/** Spa booked on the visit day — same rule as guestSurveyEligibility day-pass MVP. */
export function guestHasSpaOnVisitDay(
  guest: GuestSpaVisitFields | null | undefined,
): boolean {
  const spaDateStr = String(guest?.spa_date ?? "").trim().slice(0, 10);
  const arrivalStr = String(guest?.arrival_date ?? "").trim().slice(0, 10);
  return !!spaDateStr && spaDateStr === arrivalStr;
}

/** Normalize legacy applies_to from DB or ACC patches. */
export function normalizeAppliesTo(raw: string | null | undefined): AppliesTo {
  const v = String(raw ?? "all").trim();
  if (v === "non_suite") return "daypass";
  return v as AppliesTo;
}

export function isSuiteAppliesTo(appliesTo: AppliesTo): boolean {
  return appliesTo === "suite" || appliesTo === "suite_spa" || appliesTo === "suite_no_spa";
}

export function isDaypassAppliesTo(appliesTo: AppliesTo): boolean {
  return appliesTo === "daypass" || appliesTo === "daypass_spa" || appliesTo === "daypass_no_spa";
}

/** Timeline / Live Queue segment — spa sub-cohorts stay on their parent pipeline. */
export function pipelineSegmentFromAppliesTo(
  appliesToRaw: string | null | undefined,
): "shared" | "suite" | "daypass" {
  const appliesTo = normalizeAppliesTo(appliesToRaw);
  if (isSuiteAppliesTo(appliesTo)) return "suite";
  if (isDaypassAppliesTo(appliesTo)) return "daypass";
  return "shared";
}

/** Stage keys that required spa-on-visit when applies_to was umbrella daypass/non_suite. */
export const LEGACY_DAYPASS_SPA_STAGE_KEYS = new Set([
  "night_before_daypass",
  "spa_warmup_daypass",
  "survey_invite_daypass",
]);

export type AppliesToMatch = {
  match: boolean;
  /** Guest is on the right pipeline but wrong spa sub-cohort. */
  spaMismatch?: boolean;
};

export function evaluateAppliesToMatch(
  appliesToRaw: string | null | undefined,
  guest: GuestSpaVisitFields | null | undefined,
): AppliesToMatch {
  const appliesTo = normalizeAppliesTo(appliesToRaw);
  const hasSpa = guestHasSpaOnVisitDay(guest);

  if (appliesTo === "all") return { match: true };

  if (isSuiteAppliesTo(appliesTo)) {
    if (!isEffectiveSuiteGuest(guest)) return { match: false };
    if (appliesTo === "suite_spa" && !hasSpa) return { match: false, spaMismatch: true };
    if (appliesTo === "suite_no_spa" && hasSpa) return { match: false, spaMismatch: true };
    return { match: true };
  }

  if (isDaypassAppliesTo(appliesTo)) {
    if (!isEffectiveDayPassGuest(guest)) return { match: false };
    if (appliesTo === "daypass_spa" && !hasSpa) return { match: false, spaMismatch: true };
    if (appliesTo === "daypass_no_spa" && hasSpa) return { match: false, spaMismatch: true };
    return { match: true };
  }

  return { match: true };
}

/**
 * Skip reason for checkEligibility / Live Queue — null when guest matches audience.
 * Preserves legacy behavior when applies_to is still umbrella `daypass`/`non_suite`.
 */
export function getAppliesToSkipReason(
  appliesToRaw: string | null | undefined,
  stageKey: string,
  guest: GuestSpaVisitFields | null | undefined,
): string | null {
  const appliesTo = normalizeAppliesTo(appliesToRaw);
  const match = evaluateAppliesToMatch(appliesToRaw, guest);

  if (match.match) {
    // Pre-migration / admin-set umbrella daypass — stage_key gates (unchanged behavior).
    if (appliesTo === "daypass") {
      if (LEGACY_DAYPASS_SPA_STAGE_KEYS.has(stageKey) && !guestHasSpaOnVisitDay(guest)) {
        return "no_spa_visit_today";
      }
      if (stageKey === "checkout_fb_daypass" && guestHasSpaOnVisitDay(guest)) {
        return "superseded_by_survey";
      }
    }
    return null;
  }

  if (
    stageKey === "checkout_fb_daypass"
    && guestHasSpaOnVisitDay(guest)
    && (appliesTo === "daypass_no_spa" || appliesTo === "daypass")
  ) {
    return "superseded_by_survey";
  }

  if (match.spaMismatch) return "no_spa_visit_today";
  return "wrong_room_type";
}

/** Live Queue — show stages on the guest's pipeline even when spa sub-cohort mismatches. */
export function stageAppliesToGuestPipeline(
  appliesToRaw: string | null | undefined,
  guest: GuestSpaVisitFields | null | undefined,
): boolean {
  const result = evaluateAppliesToMatch(appliesToRaw, guest);
  return result.match || !!result.spaMismatch;
}
