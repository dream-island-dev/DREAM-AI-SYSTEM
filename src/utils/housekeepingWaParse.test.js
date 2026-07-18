import {
  parseHousekeepingReadyRoomNumbers,
  parseHousekeepingCheckInRoomNumbers,
  parseHousekeepingCheckOutRoomNumbers,
} from "./housekeepingWaParse";
import { buildHousekeepingGroupAckMessage } from "./housekeepingReadySignal";

describe("housekeepingWaParse", () => {
  test("parses compact ready patterns from live group export", () => {
    expect(parseHousekeepingReadyRoomNumbers("7✅")).toEqual([7]);
    expect(parseHousekeepingReadyRoomNumbers("13✅\n16✅")).toEqual([13, 16]);
    expect(parseHousekeepingReadyRoomNumbers("Room 7 ✅")).toEqual([7]);
    expect(parseHousekeepingReadyRoomNumbers("22 ready ✅")).toEqual([22]);
    expect(parseHousekeepingReadyRoomNumbers("Room 2 is ready ✅")).toEqual([2]);
    expect(parseHousekeepingReadyRoomNumbers("14 מוכן")).toEqual([14]);
  });

  test("excludes waiting / checkout — check-in handled separately", () => {
    expect(parseHousekeepingReadyRoomNumbers("5 ממתין")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("25 - ממתין - טריפל")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("8 check outtttt")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("22 co")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("2 צ׳ק אין")).toEqual([]);
  });

  test("parses check-in patterns from live group export", () => {
    expect(parseHousekeepingCheckInRoomNumbers("2 צ׳ק אין")).toEqual([2]);
    expect(parseHousekeepingCheckInRoomNumbers("25 צק אין")).toEqual([25]);
    expect(parseHousekeepingCheckInRoomNumbers("4 ציק אין")).toEqual([4]);
    expect(parseHousekeepingCheckInRoomNumbers("4,5\nציק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("1 check in")).toEqual([1]);
    expect(parseHousekeepingCheckInRoomNumbers("17 צ'ק אין")).toEqual([17]);
    expect(parseHousekeepingCheckInRoomNumbers("16 צ\u2019ק אין")).toEqual([16]);
    expect(parseHousekeepingCheckInRoomNumbers("CI 17")).toEqual([17]);
    expect(parseHousekeepingCheckInRoomNumbers("ci 7")).toEqual([7]);
    expect(parseHousekeepingCheckInRoomNumbers("check in 11")).toEqual([11]);
    expect(parseHousekeepingCheckInRoomNumbers("17 ci")).toEqual([17]);
    expect(parseHousekeepingCheckInRoomNumbers("8 check out")).toEqual([]);
  });

  test("parses check-out patterns from live group (Co 23 / 24 co)", () => {
    expect(parseHousekeepingCheckOutRoomNumbers("Co 23")).toEqual([23]);
    expect(parseHousekeepingCheckOutRoomNumbers("24 co")).toEqual([24]);
    expect(parseHousekeepingCheckOutRoomNumbers("CO 7")).toEqual([7]);
    expect(parseHousekeepingCheckOutRoomNumbers("16 check out")).toEqual([16]);
    expect(parseHousekeepingCheckOutRoomNumbers("check out 11")).toEqual([11]);
    expect(parseHousekeepingCheckOutRoomNumbers("23 צ'ק אאוט")).toEqual([23]);
    expect(parseHousekeepingCheckOutRoomNumbers("צק אאוט 9")).toEqual([9]);
    expect(parseHousekeepingCheckOutRoomNumbers("שילמו בקבלה 7 co")).toEqual([7]);
    // Must not steal check-in or ready
    expect(parseHousekeepingCheckOutRoomNumbers("17 צ'ק אין")).toEqual([]);
    expect(parseHousekeepingCheckOutRoomNumbers("CI 17")).toEqual([]);
    expect(parseHousekeepingCheckOutRoomNumbers("14✅")).toEqual([]);
    expect(parseHousekeepingCheckInRoomNumbers("Co 23")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("Co 23")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("24 co")).toEqual([]);
  });

  test("✅ always wins over check-in phrasing in the same line (bell priority)", () => {
    // ✅ right after the room number (the real-world order — ✅ arrives first)
    // + check-in text tacked on → READY only, never check-in.
    expect(parseHousekeepingReadyRoomNumbers("14 ✅ צ'ק אין")).toEqual([14]);
    expect(parseHousekeepingCheckInRoomNumbers("14 ✅ צ'ק אין")).toEqual([]);

    // ✅ anywhere in the line always blocks check-in detection, even if the
    // ✅ isn't adjacent enough to the room number to register as ready itself
    // (ambiguous message — safer to trigger neither action than to wrongly
    // fire check-in on what was actually a ready/bell message).
    expect(parseHousekeepingReadyRoomNumbers("14 צ'ק אין ✅")).toEqual([]);
    expect(parseHousekeepingCheckInRoomNumbers("14 צ'ק אין ✅")).toEqual([]);

    // No ✅, just check-in text → check-in only, never ready (unchanged behavior)
    expect(parseHousekeepingReadyRoomNumbers("14 צ'ק אין")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("CI 17")).toEqual([]);
    expect(parseHousekeepingCheckInRoomNumbers("14 צ'ק אין")).toEqual([14]);
    expect(parseHousekeepingCheckInRoomNumbers("CI 17")).toEqual([17]);
  });

  test("ignores forwarded bubbles", () => {
    expect(parseHousekeepingReadyRoomNumbers("הועברה\n14✅")).toEqual([]);
  });

  test("clamps to suite numbers 1–26", () => {
    expect(parseHousekeepingReadyRoomNumbers("99✅")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("0✅")).toEqual([]);
  });

  test("mixed multi-line bubble from Adir-style burst", () => {
    const text = [
      "Room 7 ✅",
      "13✅",
      "16✅",
      "18✅",
      "Room 9 ✅",
    ].join("\n");
    expect(parseHousekeepingReadyRoomNumbers(text)).toEqual([7, 9, 13, 16, 18]);
  });

  test("Adir-style room list then action on next line", () => {
    expect(parseHousekeepingCheckInRoomNumbers("4,5\nצ׳ק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("4 5\nצק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("4\n5\nצ׳ק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("4,5 צ׳ק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("צק אין\n4,5")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("4,5\n✅")).toEqual([4, 5]);
    expect(parseHousekeepingReadyRoomNumbers("4,5\nמוכן")).toEqual([4, 5]);
    expect(parseHousekeepingReadyRoomNumbers("4,5 ✅")).toEqual([4, 5]);
    expect(parseHousekeepingCheckOutRoomNumbers("4,5\nco")).toEqual([4, 5]);
    expect(parseHousekeepingCheckOutRoomNumbers("4,5 co")).toEqual([4, 5]);
  });

  test("group ack message for fresh bell triggers", () => {
    expect(buildHousekeepingGroupAckMessage(["רובי 14"])).toBe(
      "✅ רובי 14 מוכן — ממתין לאישור מנהל לשליחת הודעה 🔔",
    );
    expect(buildHousekeepingGroupAckMessage([
      { roomId: "רובי 14", guestName: "ישראל ישראלי" },
      { roomId: "רובי 15" },
    ])).toBe(
      "✅ רובי 14 מוכן — אורח: ישראל ישראלי — ממתין לאישור מנהל לשליחת הודעה 🔔\n✅ רובי 15 מוכן — ממתין לאישור מנהל לשליחת הודעה 🔔",
    );
    expect(buildHousekeepingGroupAckMessage([])).toBe("");
  });
});
