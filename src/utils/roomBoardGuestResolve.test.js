import {
  pickGuestForSuite,
  isGuestInStay,
  isArrivalTodayGuest,
  isArrivalTomorrowGuest,
} from "./roomBoardGuestResolve";
import { detectRoomSyncMismatch, planRoomBoardReconcile, resolveEffectiveRoomStatus } from "./roomBoardSync";

describe("roomBoardGuestResolve", () => {
  const today = "2026-07-14";
  const tomorrow = "2026-07-15";

  test("pickGuestForSuite prefers checked_in over tomorrow arrival", () => {
    const guests = [
      { id: 1, name: "Current", room: "ג׳ספר 1", status: "checked_in", arrival_date: "2026-07-12", departure_date: "2026-07-14" },
      { id: 2, name: "Tomorrow", room: "ג׳ספר 1", status: "expected", arrival_date: tomorrow },
    ];
    const picked = pickGuestForSuite("ג׳ספר 1", guests, [], today);
    expect(picked?.id).toBe(1);
  });

  test("pickGuestForSuite prefers today arrival over tomorrow", () => {
    const guests = [
      { id: 1, name: "Today", room: "רובי 13", status: "expected", arrival_date: today },
      { id: 2, name: "Tomorrow", room: "רובי 13", status: "expected", arrival_date: tomorrow },
    ];
    const picked = pickGuestForSuite("רובי 13", guests, [], today);
    expect(picked?.id).toBe(1);
  });

  test("bare room number matches canonical suite id", () => {
    const guests = [{ id: 3, name: "Bare", room: "14", status: "expected", arrival_date: today }];
    expect(pickGuestForSuite("רובי 14", guests, [], today)?.id).toBe(3);
  });

  test("isGuestInStay rejects future checked_in", () => {
    expect(isGuestInStay({ status: "checked_in", arrival_date: tomorrow }, today)).toBe(false);
  });
});

describe("resolveEffectiveRoomStatus", () => {
  const today = "2026-07-14";

  test("תפוס without checked_in guest displays as פנוי", () => {
    const guest = { status: "expected", arrival_date: "2026-07-15" };
    expect(resolveEffectiveRoomStatus("תפוס", guest, today)).toBe("פנוי");
  });

  test("checked_in guest forces תפוס even when DB says פנוי", () => {
    const guest = { status: "checked_in", arrival_date: "2026-07-12", departure_date: "2026-07-16" };
    expect(resolveEffectiveRoomStatus("פנוי", guest, today)).toBe("תפוס");
  });

  test("לניקיון is not overridden by guest profile", () => {
    const guest = { status: "checked_in", arrival_date: today };
    expect(resolveEffectiveRoomStatus("לניקיון", guest, today)).toBe("לניקיון");
  });
});

describe("roomBoardSync", () => {
  const today = "2026-07-14";

  test("detectRoomSyncMismatch: תפוס + expected tomorrow", () => {
    const guest = { status: "expected", arrival_date: "2026-07-15" };
    expect(detectRoomSyncMismatch("תפוס", guest, today)).toBe("occupied_without_checkin");
  });

  test("planRoomBoardReconcile fixes stale תפוס", () => {
    const rooms = [{
      id: "ג׳ספר 1",
      status: "תפוס",
      guest: { status: "expected", arrival_date: "2026-07-15" },
      syncMismatch: "occupied_without_checkin",
    }];
    const fixes = planRoomBoardReconcile(rooms);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].to).toBe("פנוי");
  });

  test("planRoomBoardReconcile promotes פנוי when guest checked_in", () => {
    const rooms = [{
      id: "ג׳ספר 4",
      status: "פנוי",
      guest: { status: "checked_in", arrival_date: "2026-07-12", departure_date: "2026-07-16" },
      syncMismatch: "checkin_without_occupied",
    }];
    const fixes = planRoomBoardReconcile(rooms);
    expect(fixes[0].to).toBe("תפוס");
  });
});

describe("arrival labels", () => {
  const today = "2026-07-14";

  test("isArrivalTodayGuest", () => {
    expect(isArrivalTodayGuest({ arrival_date: today, status: "expected" }, today)).toBe(true);
    expect(isArrivalTodayGuest({ arrival_date: today, status: "checked_in" }, today)).toBe(false);
  });

  test("isArrivalTomorrowGuest", () => {
    expect(isArrivalTomorrowGuest({ arrival_date: "2026-07-15" }, today)).toBe(true);
  });
});
