import {
  buildGuestsByPhoneKey,
  computeResortPulse,
  countActiveInboxAlerts,
} from "./resortPulseStats";
import { israelTodayStr } from "./guestTiming";

describe("computeResortPulse", () => {
  const today = israelTodayStr();

  it("counts arrivals today and in-resort guests", () => {
    const guests = [
      { status: "expected", arrival_date: today, departure_date: today },
      { status: "checked_in", arrival_date: today, departure_date: today },
      { status: "cancelled", arrival_date: today, departure_date: today },
    ];
    const stats = computeResortPulse(guests);
    expect(stats.arrivalsToday).toBe(2);
    expect(stats.inResort).toBeGreaterThanOrEqual(1);
  });

  it("uses inboxAlertsCount extra — not stale guest flags", () => {
    const stats = computeResortPulse(
      [{ status: "expected", needs_callback: true, arrival_date: "2099-01-01", phone: "+972501111111" }],
      { inboxAlertsCount: 2 },
    );
    expect(stats.needsAttention).toBe(2);
  });
});

describe("countActiveInboxAlerts", () => {
  it("excludes departed guests with stale human_requested", () => {
    const guests = buildGuestsByPhoneKey([
      { phone: "+972501234567", status: "checked_out", departure_date: "2020-01-01" },
      { phone: "+972509876543", status: "checked_in", departure_date: "2099-12-31" },
    ]);
    const count = countActiveInboxAlerts(
      ["+972501234567", "+972509876543", "+972509876543"],
      guests,
    );
    expect(count).toBe(1);
  });
});
