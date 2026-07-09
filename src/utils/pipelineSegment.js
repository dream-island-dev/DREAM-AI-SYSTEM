/**
 * Guest pipeline segmentation — suite vs day-pass vs shared stages.
 * Mirrors supabase/functions/_shared/suiteNames.ts + automation-queue routing.
 */

import { SUITE_REGISTRY } from "../data/suiteRegistry";

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
]);

/** Effective suite — room_type OR canonical suite room (same as suiteNames.ts). */
export function isEffectiveSuiteGuest(guest) {
  if (!guest) return false;
  if (guest.room_type === "suite") return true;
  return isCanonicalSuiteRoom(guest.room);
}

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

/** Authoritative routing segment for cron + Live Queue display. */
export function resolveGuestPipelineSegment(guest) {
  if (isEffectiveSuiteGuest(guest) || isCanonicalSuiteRoom(guest?.room)) return "suite";
  return "daypass";
}

export function classifyStagePipelineSegment(stageKey, appliesTo) {
  if (SHARED_STAGE_KEYS.has(stageKey)) return "shared";
  if (SUITE_STAGE_KEYS.has(stageKey) || appliesTo === "suite") return "suite";
  if (DAYPASS_STAGE_KEYS.has(stageKey) || appliesTo === "non_suite") return "daypass";
  return "other";
}

/** Whether a queue row belongs on this guest's journey (never both pipelines). */
export function queueItemAppliesToGuest(item, guest) {
  const guestSeg = resolveGuestPipelineSegment(guest);
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
