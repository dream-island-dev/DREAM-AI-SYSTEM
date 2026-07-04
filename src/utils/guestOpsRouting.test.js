/**
 * Mirrors _shared/automationSchedule.ts guest-ops helpers (Deno boundary).
 * Keep in sync when eligibility/SLA/dept rules change.
 */
import { israelTodayStr } from "./guestTiming";

const GUEST_OPS_SLA_THRESHOLDS = { pest_control: 10, guest_amenities: 15, maintenance: 30 };

function isGuestEligibleForInHouseOpsDispatch(guest, now = new Date()) {
  const status = guest.status ?? null;
  if (status === "checked_in") return true;
  if (status === "cancelled" || status === "checked_out") return false;
  const today = israelTodayStr();
  const arrival = guest.arrival_date ?? null;
  const departure = guest.departure_date ?? null;
  if (!arrival || arrival > today) return false;
  if (departure && departure < today) return false;
  return status === "room_ready" || status === "expected" || status === "pending";
}

function guessGuestOpsSlaCategory(text) {
  const lower = text.toLowerCase();
  if (/שמפו|מגבות|towel/i.test(lower)) return "guest_amenities";
  if (/מזגן|ac\b/i.test(lower)) return "maintenance";
  return "maintenance";
}

describe("guestOpsRouting", () => {
  const today = israelTodayStr();

  test("arrival-day expected guest is eligible for field ops", () => {
    expect(
      isGuestEligibleForInHouseOpsDispatch({
        status: "expected",
        arrival_date: today,
        departure_date: today,
      }),
    ).toBe(true);
  });

  test("future arrival guest is not eligible", () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 3);
    const ymd = future.toISOString().slice(0, 10);
    expect(
      isGuestEligibleForInHouseOpsDispatch({
        status: "expected",
        arrival_date: ymd,
      }),
    ).toBe(false);
  });

  test("shampoo request SLA is guest_amenities", () => {
    expect(guessGuestOpsSlaCategory("אפשר שמפו לחדר")).toBe("guest_amenities");
  });

  test("SLA thresholds match staff-ops convention", () => {
    expect(GUEST_OPS_SLA_THRESHOLDS.guest_amenities).toBe(15);
  });
});
