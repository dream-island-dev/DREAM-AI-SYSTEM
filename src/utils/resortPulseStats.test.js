import {
  buildGuestsByPhoneKey,
  computeResortPulse,
  countActiveInboxAlerts,
} from "./resortPulseStats";
import { israelTodayStr } from "./guestTiming";

describe("computeResortPulse", () => {
  const today = israelTodayStr();

  it("counts suite arrivals today (pre check-in) and checked-in suite in-resort", () => {
    const guests = [
      { status: "expected", arrival_date: today, departure_date: today, room_type: "suite", room: "אמטיסט 8" },
      { status: "checked_in", arrival_date: today, departure_date: today, room_type: "suite", room: "רובי 14" },
      { status: "expected", arrival_date: today, departure_date: today, room_type: "day_guest", room: "Premium Day 1" },
      { status: "cancelled", arrival_date: today, departure_date: today, room_type: "suite" },
    ];
    const stats = computeResortPulse(guests);
    expect(stats.arrivalsToday).toBe(1);
    expect(stats.inResort).toBe(1);
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
