import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  evaluateAppliesToMatch,
  getAppliesToSkipReason,
  guestHasSpaOnVisitDay,
  normalizeAppliesTo,
  pipelineSegmentFromAppliesTo,
  stageAppliesToGuestPipeline,
} from "./automationCohort.ts";

const suiteGuest = { room: "אמטיסט 8", room_type: "suite", arrival_date: "2026-07-20", spa_date: "2026-07-20" };
const suiteNoSpa = { room: "אמטיסט 8", room_type: "suite", arrival_date: "2026-07-20", spa_date: null };
const daypassSpa = { room: "Premium Day 1", room_type: "day_guest", arrival_date: "2026-07-20", spa_date: "2026-07-20" };
const daypassNoSpa = { room: "Premium Day 1", room_type: "day_guest", arrival_date: "2026-07-20", spa_date: null };

Deno.test("normalizeAppliesTo: non_suite → daypass", () => {
  assertEquals(normalizeAppliesTo("non_suite"), "daypass");
});

Deno.test("guestHasSpaOnVisitDay", () => {
  assertEquals(guestHasSpaOnVisitDay(daypassSpa), true);
  assertEquals(guestHasSpaOnVisitDay(daypassNoSpa), false);
});

Deno.test("umbrella suite/daypass unchanged", () => {
  assertEquals(evaluateAppliesToMatch("suite", suiteNoSpa).match, true);
  assertEquals(evaluateAppliesToMatch("suite", daypassSpa).match, false);
  assertEquals(evaluateAppliesToMatch("daypass", daypassNoSpa).match, true);
  assertEquals(evaluateAppliesToMatch("non_suite", daypassSpa).match, true);
});

Deno.test("spa sub-cohorts", () => {
  assertEquals(evaluateAppliesToMatch("daypass_spa", daypassSpa).match, true);
  assertEquals(evaluateAppliesToMatch("daypass_spa", daypassNoSpa).spaMismatch, true);
  assertEquals(evaluateAppliesToMatch("daypass_no_spa", daypassNoSpa).match, true);
  assertEquals(evaluateAppliesToMatch("suite_spa", suiteGuest).match, true);
  assertEquals(evaluateAppliesToMatch("suite_no_spa", suiteGuest).spaMismatch, true);
});

Deno.test("legacy umbrella daypass + stage_key gates preserved", () => {
  assertEquals(
    getAppliesToSkipReason("non_suite", "night_before_daypass", daypassNoSpa),
    "no_spa_visit_today",
  );
  assertEquals(
    getAppliesToSkipReason("daypass", "checkout_fb_daypass", daypassSpa),
    "superseded_by_survey",
  );
});

Deno.test("migration cohorts replace hardcoded gates", () => {
  assertEquals(
    getAppliesToSkipReason("daypass_spa", "night_before_daypass", daypassNoSpa),
    "no_spa_visit_today",
  );
  assertEquals(
    getAppliesToSkipReason("daypass_no_spa", "checkout_fb_daypass", daypassSpa),
    "superseded_by_survey",
  );
  assertEquals(
    getAppliesToSkipReason("daypass_spa", "night_before_daypass", daypassSpa),
    null,
  );
});

Deno.test("pipelineSegmentFromAppliesTo", () => {
  assertEquals(pipelineSegmentFromAppliesTo("suite_spa"), "suite");
  assertEquals(pipelineSegmentFromAppliesTo("daypass_no_spa"), "daypass");
  assertEquals(pipelineSegmentFromAppliesTo("all"), "shared");
});

Deno.test("stageAppliesToGuestPipeline shows spa mismatch on same pipeline", () => {
  assertEquals(stageAppliesToGuestPipeline("daypass_spa", daypassNoSpa), true);
  assertEquals(stageAppliesToGuestPipeline("daypass_spa", suiteGuest), false);
});
