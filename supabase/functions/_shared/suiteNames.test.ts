// supabase/functions/_shared/suiteNames.test.ts
//
// Run: deno test supabase/functions/_shared/suiteNames.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  getMissingRoomAssignmentSkipReason,
  hasPremiumDayRoomTypeConflict,
  hasSuiteRoomTypeConflict,
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
  isPremiumDayRoom,
  resolveSuiteRoomFromEzgoLabel,
} from "./suiteNames.ts";

Deno.test("resolveSuiteRoomFromEzgoLabel: suite wins over בילוי יומי substring — P0 2026-08-05 regression (אמטיסט 11 - בילוי יומי misclassified as day_guest)", () => {
  assertEquals(resolveSuiteRoomFromEzgoLabel("אמטיסט 11 - בילוי יומי"), "אמטיסט 11");
  assertEquals(resolveSuiteRoomFromEzgoLabel("סוויטת ג'ספר - 3 בילוי יומי"), "ג׳ספר 3");
});

Deno.test("resolveSuiteRoomFromEzgoLabel: suite wins over ביקור יומי substring too", () => {
  assertEquals(resolveSuiteRoomFromEzgoLabel("רובי 14 - ביקור יומי"), "רובי 14");
});

Deno.test("resolveSuiteRoomFromEzgoLabel: standalone בילוי יומי with no suite number stays day-pass", () => {
  assertEquals(resolveSuiteRoomFromEzgoLabel("בילוי יומי"), "בילוי יומי");
  assertEquals(resolveSuiteRoomFromEzgoLabel("חבילת בילוי יומי"), "בילוי יומי");
});

Deno.test("resolveSuiteRoomFromEzgoLabel: standalone ביקור יומי with no suite number is day-pass", () => {
  assertEquals(resolveSuiteRoomFromEzgoLabel("ביקור יומי"), "בילוי יומי");
});

Deno.test("resolveSuiteRoomFromEzgoLabel: Premium Day still wins regardless of order", () => {
  assertEquals(resolveSuiteRoomFromEzgoLabel("Premium Day 1"), "Premium Day 1");
  assertEquals(resolveSuiteRoomFromEzgoLabel("פרימיום 2"), "Premium Day 2");
});

Deno.test("resolveSuiteRoomFromEzgoLabel: plain suite label unaffected", () => {
  assertEquals(resolveSuiteRoomFromEzgoLabel("סוויטת אמטיסט - 8"), "אמטיסט 8");
});

Deno.test("isPremiumDayRoom — Premium Day 1/2 only", () => {
  assertEquals(isPremiumDayRoom("Premium Day 1"), true);
  assertEquals(isPremiumDayRoom("Premium Day 2"), true);
  assertEquals(isPremiumDayRoom("אמטיסט 8"), false);
  assertEquals(isPremiumDayRoom(""), false);
});

Deno.test("isEffectiveSuiteGuest — canonical room only, not room_type alone", () => {
  assertEquals(isEffectiveSuiteGuest({ room_type: "suite", room: "אמטיסט 8" }), true);
  assertEquals(isEffectiveSuiteGuest({ room_type: "suite", room: "" }), false);
  assertEquals(isEffectiveSuiteGuest({ room_type: "suite", room: null }), false);
  assertEquals(isEffectiveSuiteGuest({ room_type: "day_guest", room: "אמטיסט 8" }), true);
});

Deno.test("isEffectiveSuiteGuest — Premium Day room is never suite", () => {
  assertEquals(isEffectiveSuiteGuest({ room_type: "suite", room: "Premium Day 1" }), false);
  assertEquals(isEffectiveSuiteGuest({ room_type: "premium_day_guest", room: "Premium Day 2" }), false);
});

Deno.test("isEffectiveDayPassGuest — Premium Day even when room_type=suite", () => {
  const g = { room_type: "suite", room: "Premium Day 1" };
  assertEquals(isEffectiveDayPassGuest(g), true);
  assertEquals(isEffectiveSuiteGuest(g), false);
});

Deno.test("isEffectiveDayPassGuest — day_guest requires non-empty room", () => {
  assertEquals(isEffectiveDayPassGuest({ room_type: "day_guest", room: "Premium Day 1" }), true);
  assertEquals(isEffectiveDayPassGuest({ room_type: "day_guest", room: "" }), false);
  assertEquals(isEffectiveDayPassGuest({ room_type: "day_guest", room: null }), false);
});

Deno.test("getMissingRoomAssignmentSkipReason — unassigned guests blocked", () => {
  assertEquals(getMissingRoomAssignmentSkipReason({ room_type: "suite", room: "" }), "missing_room_assignment");
  assertEquals(getMissingRoomAssignmentSkipReason({ room_type: "day_guest", room: "" }), "missing_room_assignment");
  assertEquals(getMissingRoomAssignmentSkipReason({ room_type: "standard", room: "" }), "missing_room_assignment");
  assertEquals(getMissingRoomAssignmentSkipReason(null), "missing_room_assignment");
});

Deno.test("getMissingRoomAssignmentSkipReason — assigned guests pass", () => {
  assertEquals(getMissingRoomAssignmentSkipReason({ room_type: "suite", room: "רובי 14" }), null);
  assertEquals(getMissingRoomAssignmentSkipReason({ room_type: "day_guest", room: "Premium Day 1" }), null);
});

Deno.test("hasSuiteRoomTypeConflict — session 125 incident", () => {
  assertEquals(hasSuiteRoomTypeConflict({ room: "אמטיסט 8", room_type: "day_guest" }), true);
  assertEquals(hasSuiteRoomTypeConflict({ room: "Premium Day 1", room_type: "day_guest" }), false);
});

Deno.test("hasPremiumDayRoomTypeConflict — mis-tagged premium day", () => {
  assertEquals(hasPremiumDayRoomTypeConflict({ room: "Premium Day 1", room_type: "suite" }), true);
  assertEquals(hasPremiumDayRoomTypeConflict({ room: "Premium Day 1", room_type: "premium_day_guest" }), false);
});
