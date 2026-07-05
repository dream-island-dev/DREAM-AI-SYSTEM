import {
  classifyInboxContactSegment,
  classifyInboxRosterSegment,
  israelTodayStr,
  israelDateOffsetStr,
  rosterGuestFields,
  syncInboxContactWithGuestMap,
} from "./guestTiming";

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
      status: "expected",
      messages: [],
    };
    const stripped = syncInboxContactWithGuestMap(stale, null);
    expect(classifyInboxContactSegment(stripped)).toBe("no_date");
    expect(classifyInboxContactSegment(stale)).toBe("tomorrow");
  });
});
