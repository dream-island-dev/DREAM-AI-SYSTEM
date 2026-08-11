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

  it("carries the suite/daypass/unmatched split through as separate fields", () => {
    const stats = computeResortPulse([], {
      inboxAlertsCount: 5,
      inboxAlertsCountSuite: 3,
      inboxAlertsCountDaypass: 1,
      inboxAlertsCountUnmatched: 1,
    });
    expect(stats.needsAttention).toBe(5);
    expect(stats.needsAttentionSuite).toBe(3);
    expect(stats.needsAttentionDaypass).toBe(1);
    expect(stats.needsAttentionUnmatched).toBe(1);
  });
});

describe("countActiveInboxAlerts", () => {
  it("excludes departed guests with stale human_requested", () => {
    const guests = buildGuestsByPhoneKey([
      { phone: "+972501234567", status: "checked_out", departure_date: "2020-01-01", room_type: "suite", room: "אמטיסט 8" },
      { phone: "+972509876543", status: "checked_in", departure_date: "2099-12-31", room_type: "suite", room: "רובי 14" },
    ]);
    const result = countActiveInboxAlerts(
      ["+972501234567", "+972509876543", "+972509876543"],
      guests,
    );
    expect(result.total).toBe(1);
    expect(result.suite).toBe(1);
    expect(result.daypass).toBe(0);
  });

  it("splits suite vs daypass — one combined number would hide which cohort needs attention", () => {
    const guests = buildGuestsByPhoneKey([
      { phone: "+972501111111", status: "checked_in", room_type: "suite", room: "אמטיסט 8" },
      { phone: "+972502222222", status: "expected", room_type: "day_guest", room: "Premium Day 1" },
      { phone: "+972503333333", status: "expected", room_type: "suite", room: "רובי 15" },
    ]);
    const result = countActiveInboxAlerts(
      ["+972501111111", "+972502222222", "+972503333333"],
      guests,
    );
    expect(result.suite).toBe(2);
    expect(result.daypass).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(result.total).toBe(3);
  });

  it("FAIL VISIBLE — unlinked phone (no guest row) lands in its own unmatched bucket, not suite", () => {
    const guests = buildGuestsByPhoneKey([
      { phone: "+972501111111", status: "checked_in", room_type: "suite", room: "אמטיסט 8" },
    ]);
    const result = countActiveInboxAlerts(
      ["+972501111111", "+972509999999"],
      guests,
    );
    expect(result.suite).toBe(1);
    expect(result.daypass).toBe(0);
    expect(result.unmatched).toBe(1);
    expect(result.total).toBe(2);
  });
});
