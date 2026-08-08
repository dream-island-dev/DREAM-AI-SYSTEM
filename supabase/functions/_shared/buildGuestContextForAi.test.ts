import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildGuestContextForAi } from "./buildGuestContextForAi.ts";

function ymdOffset(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

const YESTERDAY = ymdOffset(-1);
const TODAY = ymdOffset(0);
const TOMORROW = ymdOffset(1);

Deno.test("buildGuestContextForAi: never claims בתוך השהות for a guest still pending past arrival (2026-08-08 fix)", () => {
  for (const status of ["pending", "expected", "room_ready"]) {
    const guest = {
      name: "בדיקה",
      arrival_date: YESTERDAY,
      departure_date: TODAY,
      room: "רובי 14",
      status,
    };
    const line = buildGuestContextForAi(guest, []);
    assert(
      !line.includes("שלב האורח: בתוך השהות"),
      `status=${status} must not claim בתוך השהות — got: ${line}`,
    );
    assertStringIncludes(line, "טרם נקלט צ'ק-אין");
  }
});

Deno.test("buildGuestContextForAi: checked_in past arrival still says בתוך השהות (no regression)", () => {
  const guest = {
    name: "בדיקה",
    arrival_date: YESTERDAY,
    departure_date: TOMORROW,
    room: "רובי 14",
    status: "checked_in",
  };
  const line = buildGuestContextForAi(guest, []);
  assertStringIncludes(line, "שלב האורח: בתוך השהות");
});

Deno.test("buildGuestContextForAi: forceInHouse still wins regardless of status (in-room keyword override)", () => {
  const guest = {
    name: "בדיקה",
    arrival_date: YESTERDAY,
    departure_date: TOMORROW,
    room: "רובי 14",
    status: "pending",
  };
  const line = buildGuestContextForAi(guest, [], { forceInHouse: true });
  assertStringIncludes(line, "בתוך השהות — האורח בחדר");
});

Deno.test("buildGuestContextForAi: arrival today / future stages unaffected", () => {
  const todayGuest = {
    name: "בדיקה",
    arrival_date: TODAY,
    departure_date: TOMORROW,
    room: "רובי 14",
    status: "expected",
  };
  assertStringIncludes(buildGuestContextForAi(todayGuest, []), "יום הגעה — האורח מגיע היום");

  const futureGuest = {
    name: "בדיקה",
    arrival_date: TOMORROW,
    departure_date: ymdOffset(2),
    room: "רובי 14",
    status: "expected",
  };
  assertStringIncludes(buildGuestContextForAi(futureGuest, []), "טרם הגעה");
});
