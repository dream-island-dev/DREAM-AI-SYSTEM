import {
  resolveSuiteFromEzgoFields,
  roomsCanonicallyMatch,
  guestRoomMatchesSuiteId,
  GENERIC_DAY_PASS_ROOM,
} from "./suiteRegistry";

describe("suiteRegistry — EZGO room resolution", () => {
  test("resolveSuiteFromEzgoFields: room number + suite brand → canonical", () => {
    expect(resolveSuiteFromEzgoFields("8", "סוויטת אמטיסט", false)).toBe("אמטיסט 8");
  });

  test("resolveSuiteFromEzgoFields: premium day 2", () => {
    expect(resolveSuiteFromEzgoFields("", "Premium Day 2", true)).toBe("Premium Day 2");
  });

  test("resolveSuiteFromEzgoFields: plain day visit → בילוי יומי (not Premium Day)", () => {
    expect(resolveSuiteFromEzgoFields("", "", true)).toBe(GENERIC_DAY_PASS_ROOM);
    expect(resolveSuiteFromEzgoFields("", "בילוי יומי", true)).toBe(GENERIC_DAY_PASS_ROOM);
  });

  test("resolveSuiteFromEzgoFields: premium package Hebrew", () => {
    expect(resolveSuiteFromEzgoFields("", "חבילת פרימיום בילוי יומי 1", true)).toBe("Premium Day 1");
  });

  test("roomsCanonicallyMatch: bare number vs registry name", () => {
    expect(roomsCanonicallyMatch("8", "אמטיסט 8")).toBe(true);
    expect(roomsCanonicallyMatch("וילה 2", "וילה 5")).toBe(false);
  });

  test("guestRoomMatchesSuiteId: registry id vs bare room number", () => {
    expect(guestRoomMatchesSuiteId({ room: "14" }, "רובי 14")).toBe(true);
    expect(guestRoomMatchesSuiteId({ room: "רובי 14" }, "רובי 14")).toBe(true);
    expect(guestRoomMatchesSuiteId({ room: "15" }, "רובי 14")).toBe(false);
  });
});
