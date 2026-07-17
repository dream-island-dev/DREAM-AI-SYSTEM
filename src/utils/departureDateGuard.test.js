import {
  addDepartureFromNights,
  isMissingSuiteDepartureDate,
  validateSuiteProfilesDeparture,
} from "./departureDateGuard";

describe("departureDateGuard", () => {
  test("addDepartureFromNights uses nights column", () => {
    expect(addDepartureFromNights("2026-07-17", 2)).toBe("2026-07-19");
  });

  test("day guest departure equals arrival", () => {
    expect(addDepartureFromNights("2026-07-17", 0, { isDayGuest: true })).toBe("2026-07-17");
  });

  test("suite without departure is flagged", () => {
    expect(isMissingSuiteDepartureDate({
      arrival_date: "2026-07-17",
      departure_date: null,
      room_type: "suite",
    })).toBe(true);
  });

  test("validateSuiteProfilesDeparture blocks suite rows", () => {
    const blocked = validateSuiteProfilesDeparture([
      { hasSuite: true, isDayGuest: false, arrivalDate: "2026-07-17", departureDate: null, guestName: "Test", nights: 0 },
    ]);
    expect(blocked).toHaveLength(1);
  });
});
