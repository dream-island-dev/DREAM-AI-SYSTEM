import {
  formatCheckinArrivalDisplay,
  sortCheckinRosterGuests,
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
