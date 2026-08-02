import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildHousekeepingCheckOutAckLine } from "./housekeepingCheckOutSignal.ts";

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
