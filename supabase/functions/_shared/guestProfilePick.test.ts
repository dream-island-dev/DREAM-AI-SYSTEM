import {
  pickGuestProfileByPhone,
  recordSignalsNewStay,
  shouldTreatAsReturningGuestCreate,
} from "./guestProfilePick.ts";

Deno.test("recordSignalsNewStay: new arrival after ended stay", () => {
  const guest = {
    id: 1,
    status: "checked_out",
    arrival_date: "2026-07-06",
    departure_date: "2026-07-07",
  };
  const rec = { arrival_date: "2026-08-08" };
  if (!recordSignalsNewStay(rec, guest, "2026-08-08", "2026-08-08")) {
    throw new Error("expected new stay signal");
  }
  if (!shouldTreatAsReturningGuestCreate(guest, rec, "2026-08-08", "2026-08-08")) {
    throw new Error("expected returning guest create");
  }
});

Deno.test("pickGuestProfileByPhone prefers today's expected over archived", () => {
  const oldStay = {
    id: 1,
    status: "checked_out",
    arrival_date: "2026-07-06",
    departure_date: "2026-07-07",
  };
  const newStay = {
    id: 2,
    status: "expected",
    arrival_date: "2026-08-08",
    departure_date: "2026-08-09",
  };
  const picked = pickGuestProfileByPhone([oldStay, newStay], "2026-08-08");
  if (picked?.id !== 2) throw new Error(`expected new stay id=2 got ${picked?.id}`);
});
