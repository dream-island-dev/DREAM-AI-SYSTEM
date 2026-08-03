import {
  pickGuestProfileByPhone,
  shouldTreatAsReturningGuestCreate,
} from "./guestProfilePick";

describe("guestProfilePick", () => {
  test("returning guest triggers create not enrich", () => {
    const guest = {
      id: 1,
      status: "checked_out",
      arrival_date: "2026-07-06",
      departure_date: "2026-07-07",
    };
    const rec = { arrival_date: "2026-08-08" };
    expect(shouldTreatAsReturningGuestCreate(guest, rec, "2026-08-08", "2026-08-08")).toBe(true);
  });

  test("pickGuestProfileByPhone prefers active stay", () => {
    const picked = pickGuestProfileByPhone(
      [
        { id: 1, status: "checked_out", arrival_date: "2026-07-06", departure_date: "2026-07-07" },
        { id: 2, status: "expected", arrival_date: "2026-08-08", departure_date: "2026-08-09" },
      ],
      "2026-08-08",
    );
    expect(picked?.id).toBe(2);
  });
});
