import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildHousekeepingCheckOutAckLine,
  HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS,
} from "./housekeepingCheckOutSignal.ts";

Deno.test("buildHousekeepingCheckOutAckLine: turnover incoming hint", () => {
  const line = buildHousekeepingCheckOutAckLine({
    ok: true,
    roomNumber: 1,
    roomId: "ג׳ספר 1",
    guestId: 10,
    guestName: "יוצא",
    incomingGuestName: "נכנס",
    action: "updated",
  });
  assertEquals(
    line,
    "✅ חדר ג׳ספר 1 — צ'ק-אאוט נקלט (יוצא) · חדר לניקיון · מגיע היום: נכנס",
  );
});

Deno.test("buildHousekeepingCheckOutAckLine: no incoming — no extra hint", () => {
  const line = buildHousekeepingCheckOutAckLine({
    ok: true,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: 11,
    guestName: "אורח",
    action: "updated",
  });
  assertEquals(line, "✅ חדר רובי 14 — צ'ק-אאוט נקלט (אורח) · חדר לניקיון");
});

Deno.test("buildHousekeepingCheckOutAckLine: skipped_no_suite uses roomNumber (no roomId exists)", () => {
  const line = buildHousekeepingCheckOutAckLine({
    ok: false,
    roomNumber: 99,
    roomId: null,
    guestId: null,
    guestName: null,
    action: "skipped_no_suite",
  });
  assertEquals(line, "⚠️ מספר חדר #99 לא מוכר במערכת — צ'ק-אאוט לא נקלט, בדקו את המספר");
});

Deno.test("buildHousekeepingCheckOutAckLine: error surfaces visibly", () => {
  const line = buildHousekeepingCheckOutAckLine({
    ok: false,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: 5,
    guestName: "אורח",
    action: "error",
    error: "performSuiteCheckOut failed",
  });
  assertEquals(line, "🚨 חדר רובי 14 — שגיאת מערכת בקליטת צ'ק-אאוט. בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.");
});

Deno.test("buildHousekeepingCheckOutAckLine: dedup stays silent", () => {
  const line = buildHousekeepingCheckOutAckLine({
    ok: true,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: null,
    guestName: null,
    action: "dedup",
  });
  assertEquals(line, null);
});

Deno.test("HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS: covers every problem action, excludes success/dedup", () => {
  assertEquals(HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS.has("skipped_no_suite"), true);
  assertEquals(HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS.has("no_guest"), true);
  assertEquals(HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS.has("ambiguous_guest"), true);
  assertEquals(HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS.has("error"), true);
  assertEquals(HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS.has("updated"), false);
  assertEquals(HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS.has("already_checked_out"), false);
  assertEquals(HOUSEKEEPING_CHECKOUT_ALWAYS_VISIBLE_ACTIONS.has("dedup"), false);
});
