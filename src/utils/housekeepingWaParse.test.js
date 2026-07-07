import { parseHousekeepingReadyRoomNumbers, parseHousekeepingCheckInRoomNumbers } from "./housekeepingWaParse";
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
    expect(parseHousekeepingCheckInRoomNumbers("1 check in")).toEqual([1]);
    expect(parseHousekeepingCheckInRoomNumbers("17 צ'ק אין")).toEqual([17]);
    expect(parseHousekeepingCheckInRoomNumbers("8 check out")).toEqual([]);
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

  test("group ack message for fresh bell triggers", () => {
    expect(buildHousekeepingGroupAckMessage(["רובי 14"])).toBe(
      "✅ חדר רובי 14 מוכן — נשלחה התראה לשליחת הודעה לאורח 🔔",
    );
    expect(buildHousekeepingGroupAckMessage(["רובי 14", "רובי 15"])).toBe(
      "✅ חדר רובי 14 מוכן — נשלחה התראה לשליחת הודעה לאורח 🔔\n✅ חדר רובי 15 מוכן — נשלחה התראה לשליחת הודעה לאורח 🔔",
    );
    expect(buildHousekeepingGroupAckMessage([])).toBe("");
  });
});
