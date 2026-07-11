import {
  formatCheckinArrivalDisplay,
  sortCheckinRosterGuests,
  shouldAutoPromoteToCheckedIn,
  resolveEffectiveGuestStatus,
} from "./guestCheckinMatrix";
import { israelTodayStr } from "./guestTiming";

describe("formatCheckinArrivalDisplay", () => {
  it("returns date and eta when present", () => {
    expect(formatCheckinArrivalDisplay({ arrival_date: "2026-07-08", arrival_time: "16:00" })).toEqual({
      date: "2026-07-08",
      eta: "16:00",
    });
  });

  it("returns null eta when missing", () => {
    expect(formatCheckinArrivalDisplay({ arrival_date: "2026-07-08" }).eta).toBeNull();
  });
});

describe("sortCheckinRosterGuests prioritizeEta", () => {
  const today = israelTodayStr();

  it("sorts pre-arrival today guests by ETA before room when prioritizeEta", () => {
    const guests = [
      { id: 1, name: "א", status: "expected", arrival_date: today, arrival_time: "18:00", room: "אמטיסט 1" },
      { id: 2, name: "ב", status: "expected", arrival_date: today, arrival_time: "14:00", room: "אמטיסט 8" },
    ];
    const sorted = sortCheckinRosterGuests(guests, new Date(), null, { prioritizeEta: true });
    expect(sorted.map((g) => g.id)).toEqual([2, 1]);
  });

  it("keeps room before ETA when prioritizeEta is false", () => {
    const guests = [
      { id: 1, name: "א", status: "expected", arrival_date: today, arrival_time: "18:00", room: "אמטיסט 1" },
      { id: 2, name: "ב", status: "expected", arrival_date: today, arrival_time: "14:00", room: "אמטיסט 8" },
    ];
    const sorted = sortCheckinRosterGuests(guests, new Date(), null, { prioritizeEta: false });
    expect(sorted.map((g) => g.id)).toEqual([1, 2]);
  });
});

describe("shouldAutoPromoteToCheckedIn (disabled 2026-07-11)", () => {
  it("returns false at 16:00 for an expected guest arriving today", () => {
    const today = israelTodayStr();
    const guest = { status: "expected", arrival_date: today };
    const sixteenHundred = new Date();
    sixteenHundred.setUTCHours(14, 0, 0, 0); // 16:00 Israel (UTC+2)
    expect(shouldAutoPromoteToCheckedIn(guest, sixteenHundred)).toBe(false);
  });
});

describe("resolveEffectiveGuestStatus (auto check-in promotion disabled)", () => {
  it("keeps a pre-arrival guest at their real status past the old 15:00 gateway", () => {
    const today = israelTodayStr();
    const guest = { status: "expected", arrival_date: today };
    const sixteenHundred = new Date();
    sixteenHundred.setUTCHours(14, 0, 0, 0);
    expect(resolveEffectiveGuestStatus(guest, sixteenHundred)).toBe("expected");
  });
});
