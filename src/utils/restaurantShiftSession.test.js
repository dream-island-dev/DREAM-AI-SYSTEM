import { describe, it, expect } from "vitest";
import { sessionRoleLabel, formatShiftStartedAt } from "./restaurantShiftSession";

describe("restaurantShiftSession", () => {
  it("labels session roles in Hebrew", () => {
    expect(sessionRoleLabel("waiter")).toBe("מלצר/ית");
    expect(sessionRoleLabel("shift_manager")).toBe("מנהל משמרת");
  });

  it("formats shift start time", () => {
    const out = formatShiftStartedAt("2026-07-20T16:30:00.000Z");
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });
});
