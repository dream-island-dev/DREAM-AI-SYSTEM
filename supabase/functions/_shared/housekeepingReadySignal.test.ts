import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildHousekeepingReadyAckLine,
  HOUSEKEEPING_READY_PROBLEM_ACTIONS,
} from "./housekeepingReadySignal.ts";

Deno.test("buildHousekeepingReadyAckLine: skipped_no_suite uses roomNumber (no roomId exists)", () => {
  const line = buildHousekeepingReadyAckLine({
    ok: false,
    roomNumber: 99,
    roomId: null,
    guestId: null,
    guestName: null,
    action: "skipped_no_suite",
  });
  assertEquals(line, '⚠️ מספר חדר #99 לא מוכר במערכת — סטטוס "מוכן" לא נקלט, בדקו את המספר');
});

Deno.test("buildHousekeepingReadyAckLine: error surfaces visibly", () => {
  const line = buildHousekeepingReadyAckLine({
    ok: false,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: null,
    guestName: null,
    action: "error",
    error: "upsert failed",
  });
  assertEquals(line, '🚨 רובי 14 — שגיאת מערכת בסימון "מוכן". בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.');
});

Deno.test("buildHousekeepingReadyAckLine: dedup stays silent", () => {
  const line = buildHousekeepingReadyAckLine({
    ok: true,
    roomNumber: 14,
    roomId: "רובי 14",
    guestId: null,
    guestName: null,
    action: "dedup",
  });
  assertEquals(line, null);
});

Deno.test("buildHousekeepingReadyAckLine: existing success/no-op lines unchanged", () => {
  assertEquals(
    buildHousekeepingReadyAckLine({
      ok: true, roomNumber: 14, roomId: "רובי 14", guestId: 1, guestName: "ישראל", action: "updated",
    }),
    "✅ רובי 14 מוכן — אורח: ישראל — ממתין לאישור מנהל 🔔",
  );
  assertEquals(
    buildHousekeepingReadyAckLine({
      ok: true, roomNumber: 6, roomId: "רובי 6", guestId: null, guestName: null, action: "already_pending",
    }),
    "ℹ️ רובי 6 — כבר ממתין לאישור",
  );
});

Deno.test("HOUSEKEEPING_READY_PROBLEM_ACTIONS: only skipped_no_suite + error, not success/occupied/dedup", () => {
  assertEquals(HOUSEKEEPING_READY_PROBLEM_ACTIONS.has("skipped_no_suite"), true);
  assertEquals(HOUSEKEEPING_READY_PROBLEM_ACTIONS.has("error"), true);
  assertEquals(HOUSEKEEPING_READY_PROBLEM_ACTIONS.has("updated"), false);
  assertEquals(HOUSEKEEPING_READY_PROBLEM_ACTIONS.has("already_pending"), false);
  assertEquals(HOUSEKEEPING_READY_PROBLEM_ACTIONS.has("skipped_occupied"), false);
  assertEquals(HOUSEKEEPING_READY_PROBLEM_ACTIONS.has("dedup"), false);
});
