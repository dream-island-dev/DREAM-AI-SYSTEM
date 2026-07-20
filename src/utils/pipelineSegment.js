/**
 * Guest pipeline segmentation — suite vs day-pass vs shared stages.
 * Mirrors supabase/functions/_shared/suiteNames.ts + automation-queue routing.
 */

import { PREMIUM_DAY_ROOMS, SUITE_REGISTRY } from "../data/suiteRegistry";

export const SHARED_STAGE_KEYS = new Set(["pre_arrival_2d", "stage_2_arrival", "stage_2_pay"]);

export const SUITE_STAGE_KEYS = new Set([
  "night_before",
  "morning_suite",
  "mid_stay",
  "checkout_fb",
  "room_ready",
  "butler_1h",
]);

export const DAYPASS_STAGE_KEYS = new Set([
  "night_before_daypass",
  "morning_welcome",
  "morning_daypass",
  "mid_stay_daypass",
  "checkout_fb_daypass",
  "spa_warmup_daypass",
  "survey_invite_daypass",
  "spa_upsell_daypass",
]);

/** Legacy non_suite → daypass umbrella (mirrors automationCohort.ts). */
export function normalizeAppliesTo(appliesTo) {
  if (appliesTo === "non_suite") return "daypass";
  return appliesTo ?? "all";
}

function isSuiteAppliesTo(appliesTo) {
  const a = normalizeAppliesTo(appliesTo);
  return a === "suite" || a === "suite_spa" || a === "suite_no_spa";
}

function isDaypassAppliesTo(appliesTo) {
  const a = normalizeAppliesTo(appliesTo);
  return a === "daypass" || a === "daypass_spa" || a === "daypass_no_spa";
}

export { isSuiteAppliesTo, isDaypassAppliesTo };

/** Normalize room for registry lookup (geresh variants). */
export function normalizeSuiteRoomName(room) {
  return String(room ?? "")
    .trim()
    .replace(/^סוויטת\s+/, "")
    .replace(/['‘’׳]/g, "׳")
    .replace(/\s+/g, " ");
}

export function isCanonicalSuiteRoom(room) {
  const n = normalizeSuiteRoomName(room);
  if (!n) return false;
  return SUITE_REGISTRY.some((s) => normalizeSuiteRoomName(s) === n);
}

export function isPremiumDayRoom(room) {
  return PREMIUM_DAY_ROOMS.includes(String(room ?? "").trim());
}

/** Effective suite — canonical physical suite room only (suiteNames.ts). */
export function isEffectiveSuiteGuest(guest) {
  if (!guest) return false;
  if (isPremiumDayRoom(guest.room)) return false;
  return isCanonicalSuiteRoom(guest.room);
}

/** Effective day-pass — Premium Day or day_guest/premium_day_guest + room label. */
export function isEffectiveDayPassGuest(guest) {
  if (!guest) return false;
  if (isCanonicalSuiteRoom(guest.room)) return false;
  if (isPremiumDayRoom(guest.room)) return true;
  const rt = guest.room_type;
  if (rt !== "day_guest" && rt !== "premium_day_guest") return false;
  return String(guest.room ?? "").trim() !== "";
}

/** Authoritative routing segment for cron + Live Queue display. */
export function resolveGuestPipelineSegment(guest) {
  if (isEffectiveSuiteGuest(guest)) return "suite";
  if (isEffectiveDayPassGuest(guest)) return "daypass";
  return "unassigned";
}

export function classifyStagePipelineSegment(stageKey, appliesTo) {
  if (SHARED_STAGE_KEYS.has(stageKey)) return "shared";
  const at = normalizeAppliesTo(appliesTo);
  if (SUITE_STAGE_KEYS.has(stageKey) || isSuiteAppliesTo(at)) return "suite";
  if (DAYPASS_STAGE_KEYS.has(stageKey) || isDaypassAppliesTo(at)) return "daypass";
  return "other";
}

/** Whether a queue row belongs on this guest's journey (never both pipelines). */
export function queueItemAppliesToGuest(item, guest) {
  const guestSeg = resolveGuestPipelineSegment(guest);
  if (guestSeg === "unassigned") return false;
  const stageSeg = classifyStagePipelineSegment(item.stageKey, item.appliesTo);
  if (stageSeg === "shared" || stageSeg === "other") return true;
  return stageSeg === guestSeg;
}

export function filterQueueItemsForGuest(items, guest) {
  return (items ?? []).filter((q) => queueItemAppliesToGuest(q, guest));
}

export function partitionGuestQueueItems(items, guest) {
  const applicable = filterQueueItemsForGuest(items, guest);
  const shared = [];
  const pipeline = [];
  for (const q of applicable) {
    const seg = q.pipelineSegment ?? classifyStagePipelineSegment(q.stageKey, q.appliesTo);
    if (seg === "shared") shared.push(q);
    else pipeline.push(q);
  }
  return { shared, pipeline, segment: resolveGuestPipelineSegment(guest) };
}
