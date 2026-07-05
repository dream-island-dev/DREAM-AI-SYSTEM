import { computeResortPulse } from "./resortPulseStats";
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

  it("counts attention flags", () => {
    const stats = computeResortPulse([
      { status: "expected", needs_callback: true, arrival_date: "2099-01-01" },
      { status: "expected", requires_attention: true, arrival_date: "2099-01-02" },
    ]);
    expect(stats.needsAttention).toBe(2);
  });
});
