import {
  classifyInboxContactSegment,
  classifyInboxRosterSegment,
  getGuestArrivalRosterLabel,
  getGuestTimingBadge,
  hasSuiteRoomTypeConflict,
  isSuiteGuestProfile,
  israelTodayStr,
  israelDateOffsetStr,
  rosterGuestFields,
  syncInboxContactWithGuestMap,
} from "./guestTiming";

// ── Suite vs day-pass split-brain (session 125 P0) ─────────────────────────
// A guest synced with a real suite room but room_type='day_guest' received
// day-pass automation content. These tests pin the effective classification
// (suite room wins) + the FAIL VISIBLE conflict flag.
describe("hasSuiteRoomTypeConflict / effective suite classification", () => {
  test("suite room + day_guest room_type = conflict (the incident)", () => {
    const g = { room: "אמטיסט 8", room_type: "day_guest" };
    expect(hasSuiteRoomTypeConflict(g)).toBe(true);
    // Effective classification routes as suite — matches server suiteNames.ts.
    expect(isSuiteGuestProfile(g)).toBe(true);
  });

  test("suite room + premium_day_guest room_type = conflict", () => {
    expect(hasSuiteRoomTypeConflict({ room: "רובי 14", room_type: "premium_day_guest" })).toBe(true);
  });

  test("true day-pass guest (Premium Day room) = no conflict", () => {
    const g = { room: "Premium Day 1", room_type: "day_guest" };
    expect(hasSuiteRoomTypeConflict(g)).toBe(false);
    expect(isSuiteGuestProfile(g)).toBe(false);
  });

  test("consistent suite guest = no conflict", () => {
    expect(hasSuiteRoomTypeConflict({ room: "אמטיסט 8", room_type: "suite" })).toBe(false);
  });

  test("day_guest without a room = no conflict", () => {
    expect(hasSuiteRoomTypeConflict({ room: null, room_type: "day_guest" })).toBe(false);
    expect(hasSuiteRoomTypeConflict({})).toBe(false);
  });

  test("standard room_type never flags conflict", () => {
    expect(hasSuiteRoomTypeConflict({ room: "אמטיסט 8", room_type: "standard" })).toBe(false);
  });
});

describe("classifyInboxRosterSegment", () => {
  const today = israelTodayStr();
  const tomorrow = israelDateOffsetStr(1);
  const in2 = israelDateOffsetStr(2);
  const in5 = israelDateOffsetStr(5);
  const yesterday = israelDateOffsetStr(-1);

  test("in_resort when checked_in", () => {
    expect(
      classifyInboxRosterSegment({
        arrival_date: yesterday,
        departure_date: tomorrow,
        status: "checked_in",
      }),
    ).toBe("in_resort");
  });

  test("tomorrow for arrival in 1 day", () => {
    expect(
      classifyInboxRosterSegment({
        arrival_date: tomorrow,
        departure_date: in5,
        status: "expected",
      }),
    ).toBe("tomorrow");
  });

  test("in_2_days for arrival in 2 days", () => {
    expect(
      classifyInboxRosterSegment({
        arrival_date: in2,
        status: "pending",
      }),
    ).toBe("in_2_days");
  });

  test("future for arrival 3+ days out", () => {
    expect(
      classifyInboxRosterSegment({
        arrival_date: in5,
        status: "expected",
      }),
    ).toBe("future");
  });

  test("no_date when arrival missing", () => {
    expect(classifyInboxRosterSegment({ status: "expected" })).toBe("no_date");
  });

  test("departed after checkout date", () => {
    expect(
      classifyInboxRosterSegment({
        arrival_date: israelDateOffsetStr(-5),
        departure_date: yesterday,
        status: "checked_in",
      }),
    ).toBe("departed");
  });

  test("rosterGuestFields accepts camelCase inbox contact shape", () => {
    expect(
      rosterGuestFields({
        arrivalDate: today,
        departureDate: tomorrow,
        status: "expected",
      }),
    ).toEqual({
      arrival_date: today,
      departure_date: tomorrow,
      status: "expected",
    });
  });
});

describe("syncInboxContactWithGuestMap", () => {
  const tomorrow = israelDateOffsetStr(1);

  test("strips stale DB profile when guest was deleted from map", () => {
    const stale = {
      phone: "972522494341",
      guestName: "ירדנה",
      guestId: 3334,
      arrivalDate: tomorrow,
      departureDate: tomorrow,
      status: "expected",
      room: "אמטיסט 8",
      pushName: "Yardena",
      messages: [],
    };
    const next = syncInboxContactWithGuestMap(stale, null);
    expect(next.guestName).toBeNull();
    expect(next.arrivalDate).toBeNull();
    expect(next.guestId).toBeNull();
    expect(next.room).toBeNull();
    expect(next.pushName).toBe("Yardena");
  });

  test("overlays live guest map entry onto contact", () => {
    const contact = { phone: "972522494341", guestName: null, messages: [] };
    const next = syncInboxContactWithGuestMap(contact, {
      id: 99,
      name: "ירדנה",
      arrival_date: tomorrow,
      status: "expected",
    });
    expect(next.guestName).toBe("ירדנה");
    expect(next.guestId).toBe(99);
    expect(next.arrivalDate).toBe(tomorrow);
  });

  test("stripped deleted contact is no_date not tomorrow", () => {
    const stale = {
      phone: "972522494341",
      guestName: "ירדנה",
      guestId: 3334,
      arrivalDate: tomorrow,
      room: "רובי 14",
      status: "expected",
      messages: [],
    };
    const stripped = syncInboxContactWithGuestMap(stale, null);
    expect(classifyInboxContactSegment(stripped)).toBe("no_date");
    expect(stripped.room).toBeNull();
    expect(classifyInboxContactSegment(stale)).toBe("tomorrow");
  });

  test("live map overwrites stale room and dates — no merge with ghost contact", () => {
    const stale = {
      phone: "972522484041",
      guestName: "ירדנה",
      guestId: 3334,
      arrivalDate: tomorrow,
      room: "רובי 14",
      status: "expected",
      messages: [],
    };
    const live = {
      id: 100,
      name: "אורח אחר",
      arrival_date: israelDateOffsetStr(5),
      departure_date: null,
      status: "expected",
      room: "אמטיסט 8",
      room_type: "suite",
    };
    const synced = syncInboxContactWithGuestMap(stale, live);
    expect(synced.guestId).toBe(100);
    expect(synced.guestName).toBe("אורח אחר");
    expect(synced.room).toBe("אמטיסט 8");
    expect(synced.arrivalDate).toBe(israelDateOffsetStr(5));
    expect(classifyInboxContactSegment(synced)).toBe("future");
  });
});

describe("getGuestArrivalRosterLabel — departed vs stale checked_in", () => {
  const yesterday = israelDateOffsetStr(-1);
  const weekAgo = israelDateOffsetStr(-7);

  test("checked_in + past departure shows אחרי עזיבה not בריזורט", () => {
    const guest = {
      arrival_date: weekAgo,
      departure_date: yesterday,
      status: "checked_in",
    };
    expect(getGuestArrivalRosterLabel(guest).label).toBe("⚪ אחרי עזיבה");
  });

  test("getGuestTimingBadge matches for stale checked_in after checkout", () => {
    const guest = {
      arrival_date: weekAgo,
      departure_date: yesterday,
      status: "checked_in",
    };
    expect(getGuestTimingBadge(guest).label).toBe("⚪ אורח לאחר עזיבה");
  });
});
