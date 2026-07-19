import { describe, it, expect } from "vitest";
import {
  sessionRoleLabel,
  formatShiftStartedAt,
  isGenericRosterPlaceholder,
} from "./restaurantShiftSession";

describe("restaurantShiftSession", () => {
  it("labels session roles in Hebrew", () => {
    expect(sessionRoleLabel("waiter")).toBe("מלצר/ית");
    expect(sessionRoleLabel("shift_manager")).toBe("מנהל משמרת");
    expect(sessionRoleLabel("hostess")).toBe("מארחת");
  });

  it("formats shift start time", () => {
    const out = formatShiftStartedAt("2026-07-20T16:30:00.000Z");
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("flags generic seed roster names", () => {
    expect(isGenericRosterPlaceholder("מלצר/ית 1")).toBe(true);
    expect(isGenericRosterPlaceholder("מלצר 2")).toBe(true);
    expect(isGenericRosterPlaceholder("דנה")).toBe(false);
  });
});
