import {
  resolveSuiteFromEzgoFields,
  roomsCanonicallyMatch,
} from "./suiteRegistry";

describe("suiteRegistry — EZGO room resolution", () => {
  test("resolveSuiteFromEzgoFields: room number + suite brand → canonical", () => {
    expect(resolveSuiteFromEzgoFields("8", "סוויטת אמטיסט", false)).toBe("אמטיסט 8");
  });

  test("resolveSuiteFromEzgoFields: premium day 2", () => {
    expect(resolveSuiteFromEzgoFields("", "Premium Day 2", true)).toBe("Premium Day 2");
  });

  test("roomsCanonicallyMatch: bare number vs registry name", () => {
    expect(roomsCanonicallyMatch("8", "אמטיסט 8")).toBe(true);
    expect(roomsCanonicallyMatch("וילה 2", "וילה 5")).toBe(false);
  });
});
