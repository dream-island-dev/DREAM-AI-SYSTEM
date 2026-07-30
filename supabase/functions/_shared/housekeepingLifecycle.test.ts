import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  CHECKIN_ELIGIBLE_STATUSES,
  shouldHousekeepingTurnover,
} from "./housekeepingLifecycle.ts";

const today = "2026-07-30";

const incoming = {
  id: 2,
  name: "New Guest",
  status: "room_ready",
  arrival_date: today,
  departure_date: "2026-08-01",
};

const outgoing = {
  id: 1,
  name: "Old Guest",
  status: "checked_in",
  arrival_date: "2026-07-28",
  departure_date: today,
};

Deno.test("shouldHousekeepingTurnover: same-day swap", () => {
  assertEquals(shouldHousekeepingTurnover(incoming, outgoing, today), true);
});

Deno.test("shouldHousekeepingTurnover: same guest — no turnover", () => {
  assertEquals(shouldHousekeepingTurnover(incoming, { ...incoming, status: "checked_in" }, today), false);
});

Deno.test("shouldHousekeepingTurnover: incoming not today", () => {
  assertEquals(
    shouldHousekeepingTurnover({ ...incoming, arrival_date: "2026-07-31" }, outgoing, today),
    false,
  );
});

Deno.test("shouldHousekeepingTurnover: outgoing departs tomorrow", () => {
  assertEquals(
    shouldHousekeepingTurnover(incoming, { ...outgoing, departure_date: "2026-07-31" }, today),
    false,
  );
});

Deno.test("shouldHousekeepingTurnover: incoming already checked_in", () => {
  assertEquals(
    shouldHousekeepingTurnover({ ...incoming, status: "checked_in" }, outgoing, today),
    false,
  );
});

Deno.test("CHECKIN_ELIGIBLE excludes checked_in", () => {
  assertEquals(CHECKIN_ELIGIBLE_STATUSES.has("checked_in"), false);
});
