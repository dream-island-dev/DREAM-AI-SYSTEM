import {
  isSendWindowInvalid,
  normalizeStageTimingPatch,
  parseLocalHourFromTime,
} from "./sendWindow";

describe("sendWindow", () => {
  test("parseLocalHourFromTime", () => {
    expect(parseLocalHourFromTime("17:00")).toBe(17);
    expect(parseLocalHourFromTime("12:00:00")).toBe(12);
    expect(parseLocalHourFromTime(null)).toBeNull();
  });

  test("detects invalid window (end before start)", () => {
    expect(isSendWindowInvalid("17:00", "12:00")).toBe(true);
    expect(isSendWindowInvalid("10:00", "12:00")).toBe(false);
    expect(isSendWindowInvalid("17:00", null)).toBe(false);
  });

  test("normalizeStageTimingPatch clears end when invalid", () => {
    const stage = { local_time: "10:00", local_time_end: "12:00" };
    expect(normalizeStageTimingPatch(stage, { local_time: "17:00" })).toEqual({
      local_time: "17:00",
      local_time_end: null,
    });
    expect(normalizeStageTimingPatch(stage, { day_offset: 1 })).toEqual({ day_offset: 1 });
  });
});
