import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  guestRoomMatchesSuiteId,
  isDayPassRoomLabel,
  resolveSuiteFromEzgoFields,
  roomsCanonicallyMatch,
} from "./guestRoomResolve.ts";

Deno.test("isDayPassRoomLabel: premium + generic day pass", () => {
  assertEquals(isDayPassRoomLabel("Premium Day 1"), true);
  assertEquals(isDayPassRoomLabel("בילוי יומי"), true);
  assertEquals(isDayPassRoomLabel("ג׳ספר 1"), false);
});

Deno.test("Premium Day 1 must not resolve or match ג׳ספר 1", () => {
  assertEquals(resolveSuiteFromEzgoFields("Premium Day 1", "", false), "Premium Day 1");
  assertEquals(roomsCanonicallyMatch("ג׳ספר 1", "Premium Day 1"), false);
  assertEquals(guestRoomMatchesSuiteId({ room: "Premium Day 1" }, "ג׳ספר 1"), false);
});
