import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildHousekeepingCheckInAckLine,
  HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS,
} from "./housekeepingCheckInSignal.ts";

Deno.test("buildHousekeepingCheckInAckLine: no_guest names missing arrival-today guest", () => {
  const line = buildHousekeepingCheckInAckLine({
    ok: false,
    roomNumber: 9,
    roomId: "אמטיסט 9",
    guestId: null,
    guestName: null,
    action: "no_guest",
  });
  assertEquals(line, "⚠️ חדר אמטיסט 9 — צ'ק-אין: לא נמצא אורח עם הגעה היום בחדר");
});

Deno.test("buildHousekeepingCheckInAckLine: skipped_no_suite uses roomNumber (no roomId exists)", () => {
  const line = buildHousekeepingCheckInAckLine({
    ok: false,
    roomNumber: 99,
    roomId: null,
    guestId: null,
    guestName: null,
    action: "skipped_no_suite",
  });
  assertEquals(line, "⚠️ מספר חדר #99 לא מוכר במערכת — צ'ק-אין לא נקלט, בדקו את המספר");
});

Deno.test("buildHousekeepingCheckInAckLine: error surfaces visibly, no raw error text leaked", () => {
  const line = buildHousekeepingCheckInAckLine({
    ok: false,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: 5,
    guestName: "אורח",
    action: "error",
    error: "duplicate key value violates unique constraint",
  });
  assertEquals(line, "🚨 חדר רובי 14 — שגיאת מערכת בקליטת צ'ק-אין. בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.");
});

Deno.test("buildHousekeepingCheckInAckLine: dedup stays silent — not a drop, just a WA retry", () => {
  const line = buildHousekeepingCheckInAckLine({
    ok: true,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: null,
    guestName: null,
    action: "dedup",
  });
  assertEquals(line, null);
});

Deno.test("buildHousekeepingCheckInAckLine: turnover implicit-co hint unchanged", () => {
  const line = buildHousekeepingCheckInAckLine({
    ok: true,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: 2,
    guestName: "נכנס",
    previousGuestId: 1,
    previousGuestName: "יוצא",
    action: "updated",
  });
  assertEquals(line, "✅ חדר רובי 14 — צ'ק-אין נקלט (נכנס) · יצא קודם: יוצא");
});

Deno.test("HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS: covers every problem action, excludes success/dedup", () => {
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("skipped_no_suite"), true);
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("no_guest"), true);
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("ambiguous_guest"), true);
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("guest_not_eligible"), true);
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("error"), true);
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("updated"), false);
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("already_checked_in"), false);
  assertEquals(HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS.has("dedup"), false);
});
