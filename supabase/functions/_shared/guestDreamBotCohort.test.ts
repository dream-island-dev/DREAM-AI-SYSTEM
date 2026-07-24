import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  filterGuestsForDreamBotCohort,
  israelTomorrowYmd,
  israelYmd,
} from "./guestDreamBotCohort.ts";

const today = israelYmd(new Date("2026-07-24T10:00:00+03:00"));
const tomorrow = israelTomorrowYmd(new Date("2026-07-24T10:00:00+03:00"));

Deno.test("filterGuestsForDreamBotCohort: in_resort suite checked_in", () => {
  const rows = filterGuestsForDreamBotCohort(
    [{
      id: 1,
      name: "Test",
      phone: "+972501234567",
      status: "checked_in",
      arrival_date: today,
      departure_date: tomorrow,
      wa_window_expires_at: null,
      room: "אמטיסט 8",
      room_type: "suite",
    }],
    "in_resort",
    { now: new Date("2026-07-24T10:00:00+03:00") },
  );
  assertEquals(rows.length, 1);
});

Deno.test("filterGuestsForDreamBotCohort: arriving_tomorrow", () => {
  const rows = filterGuestsForDreamBotCohort(
    [{
      id: 2,
      name: "Tomorrow",
      phone: "+972509999999",
      status: "expected",
      arrival_date: tomorrow,
      departure_date: null,
      wa_window_expires_at: null,
      room: "רובי 14",
      room_type: "suite",
    }],
    "arriving_tomorrow",
    { now: new Date("2026-07-24T10:00:00+03:00") },
  );
  assertEquals(rows.length, 1);
});

Deno.test("filterGuestsForDreamBotCohort: onlyMissingMetaWindow skips open window", () => {
  const rows = filterGuestsForDreamBotCohort(
    [{
      id: 3,
      name: "HasWindow",
      phone: "+972501111111",
      status: "checked_in",
      arrival_date: today,
      departure_date: tomorrow,
      wa_window_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      room: "ג׳ספר 1",
      room_type: "suite",
    }],
    "in_resort",
    { onlyMissingMetaWindow: true },
  );
  assertEquals(rows.length, 0);
});
