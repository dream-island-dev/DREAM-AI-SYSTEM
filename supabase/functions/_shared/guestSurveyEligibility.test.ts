import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isDayPassSpaSurveyEligible,
  isGuestPortalSurveyEligible,
  isSuitePostCheckoutSurveyEligible,
  resolveSurveyVisitDate,
} from "./guestSurveyEligibility.ts";

Deno.test("suite post-checkout: checked_out suite with departure → eligible", () => {
  const guest = {
    room_type: "suite",
    room: "אמטיסט 8",
    status: "checked_out",
    departure_date: "2026-07-16",
    arrival_date: "2026-07-14",
  };
  assertEquals(isSuitePostCheckoutSurveyEligible(guest), true);
  assertEquals(isGuestPortalSurveyEligible(guest), true);
  assertEquals(resolveSurveyVisitDate(guest), "2026-07-16");
});

Deno.test("suite still in-house → not survey eligible", () => {
  const guest = {
    room_type: "suite",
    room: "אמטיסט 8",
    status: "checked_in",
    departure_date: "2026-07-16",
  };
  assertEquals(isSuitePostCheckoutSurveyEligible(guest), false);
});

Deno.test("day-pass spa cohort unchanged", () => {
  const guest = {
    room_type: "day_guest",
    arrival_date: "2026-07-16",
    spa_date: "2026-07-16",
    status: "checked_in",
  };
  assertEquals(isDayPassSpaSurveyEligible(guest), true);
  assertEquals(resolveSurveyVisitDate(guest), "2026-07-16");
});
