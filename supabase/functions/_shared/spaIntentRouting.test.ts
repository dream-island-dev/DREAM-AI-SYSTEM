// supabase/functions/_shared/spaIntentRouting.test.ts
// Run: deno test --allow-env supabase/functions/_shared/spaIntentRouting.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isGuestArrivingToday,
  resolveSpaIntentCohort,
  shouldAdirPersonalDmForSpaIntent,
  shouldInterceptSpaTreatmentRequest,
} from "./spaIntentRouting.ts";

Deno.test("resolveSpaIntentCohort: suite vs daypass", () => {
  assertEquals(resolveSpaIntentCohort({ room: "אמטיסט 8", room_type: "suite" }), "suite");
  assertEquals(resolveSpaIntentCohort({ room: "בילוי יומי", room_type: "day_guest" }), "daypass");
  assertEquals(resolveSpaIntentCohort({ room: "", room_type: "suite" }), null);
});

Deno.test("shouldInterceptSpaTreatmentRequest: cohort + spa text", () => {
  const suite = { room: "רובי 14", room_type: "suite" };
  assertEquals(shouldInterceptSpaTreatmentRequest("רוצה לקבוע טיפול בספא", suite), true);
  assertEquals(shouldInterceptSpaTreatmentRequest("מה שעות הבריכה?", suite), false);
});

Deno.test("shouldInterceptSpaTreatmentRequest: pre-arrival suite", () => {
  const preArrival = { room: "אמרלד 19", room_type: "suite", status: "expected" };
  assertEquals(shouldInterceptSpaTreatmentRequest("אפשר טיפול בספא?", preArrival), true);
});

Deno.test("shouldAdirPersonalDmForSpaIntent: suite only", () => {
  assertEquals(shouldAdirPersonalDmForSpaIntent("suite"), true);
  assertEquals(shouldAdirPersonalDmForSpaIntent("daypass"), false);
  assertEquals(shouldAdirPersonalDmForSpaIntent(null), false);
});

Deno.test("isGuestArrivingToday", () => {
  const guest = { arrival_date: "2026-08-02" };
  assertEquals(isGuestArrivingToday(guest, new Date("2026-08-02T10:00:00+03:00")), true);
  assertEquals(isGuestArrivingToday(guest, new Date("2026-08-03T10:00:00+03:00")), false);
});
