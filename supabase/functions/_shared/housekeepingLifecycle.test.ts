import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  CHECKIN_ELIGIBLE_STATUSES,
  HOUSEKEEPING_SCORE_OUT_OF_RANGE,
  isGuestInStayWindow,
  isGuestEligibleForHousekeepingCheckIn,
  isGuestEligibleForHousekeepingCheckOut,
  scoreGuestForCheckIn,
  scoreGuestForCheckout,
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

Deno.test("isGuestInStayWindow: open-ended only on arrival day", () => {
  assertEquals(isGuestInStayWindow({ arrival_date: today, departure_date: null }, today), true);
  assertEquals(isGuestInStayWindow({ arrival_date: "2026-07-29", departure_date: null }, today), false);
  assertEquals(isGuestInStayWindow({ arrival_date: "2026-07-29", departure_date: today }, today), true);
  assertEquals(isGuestInStayWindow({ arrival_date: today, departure_date: "2026-07-29" }, today), false);
});

Deno.test("scoreGuestForCheckIn: arrival today beats stale room_ready from past stay", () => {
  const arrivingToday = { ...incoming, status: "expected" as const };
  const staleReady = {
    id: 9,
    status: "room_ready",
    arrival_date: "2026-07-20",
    departure_date: "2026-08-05",
  };
  assertEquals(
    scoreGuestForCheckIn(arrivingToday, today) < scoreGuestForCheckIn(staleReady, today),
    true,
  );
  assertEquals(scoreGuestForCheckIn(staleReady, today), 20);
});

Deno.test("isGuestEligibleForHousekeepingCheckOut: requires departure on/before today", () => {
  assertEquals(
    isGuestEligibleForHousekeepingCheckOut({ arrival_date: today, departure_date: today }, today),
    true,
  );
  assertEquals(
    isGuestEligibleForHousekeepingCheckOut({ arrival_date: today, departure_date: null }, today),
    false,
  );
  assertEquals(
    isGuestEligibleForHousekeepingCheckOut({ arrival_date: today, departure_date: "2026-07-31" }, today),
    false,
  );
});

Deno.test("scoreGuestForCheckout: departing today checked_in wins", () => {
  const score = scoreGuestForCheckout({ ...outgoing }, today);
  assertEquals(score < HOUSEKEEPING_SCORE_OUT_OF_RANGE, true);
});

Deno.test("isGuestEligibleForHousekeepingCheckIn: future arrival blocked", () => {
  assertEquals(
    isGuestEligibleForHousekeepingCheckIn({ arrival_date: "2026-07-31", departure_date: "2026-08-02", status: "expected" }, today),
    false,
  );
});
