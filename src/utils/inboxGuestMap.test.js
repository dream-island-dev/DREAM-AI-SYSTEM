import {
  buildGuestMapsFromRows,
  buildGhostContactFromGuestEntry,
  fetchInboxRosterAnchorGuests,
  inboxNormalizePhone,
  inboxPhonesMatch,
  lookupGuestFromMaps,
  mergeRosterAnchorContacts,
  shouldHydrateInboxRosterAnchor,
  toInboxGuestMapEntry,
} from "./inboxGuestMap";
import { israelTodayStr } from "./guestTiming";

/** Mock Supabase client: chainable filter builder, pages `range()` off in-memory rows. */
function makeMockSupabase({ checkedInRows, arrivingRows }) {
  return {
    from() {
      const filters = {};
      const builder = {
        select() { return builder; },
        eq(field, val) { filters[field] = val; return builder; },
        in(field, vals) { filters[`${field}_in`] = vals; return builder; },
        not() { return builder; },
        order() { return builder; },
        range(from, to) {
          const rows = filters.status === "checked_in" ? checkedInRows : arrivingRows;
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
}

function canon(p) {
  let s = String(p).replace(/\D/g, "");
  if (s.startsWith("0")) s = "972" + s.slice(1);
  return s;
}

describe("inboxGuestMap", () => {
  test("inboxPhonesMatch handles +972 vs 972", () => {
    expect(inboxPhonesMatch("+972548036760", "972548036760")).toBe(true);
    expect(inboxNormalizePhone("+972548036760")).toBe("548036760");
  });

  test("lookupGuestFromMaps falls back to id when phone bucket missing", () => {
    const entry = toInboxGuestMapEntry({
      id: 4327,
      name: "הדר",
      phone: "+972548036760",
      status: "checked_in",
      room: "אקווה מרין 23",
      room_type: "suite",
      arrival_date: israelTodayStr(),
      departure_date: israelTodayStr(),
    });
    const idMap = new Map([[4327, entry]]);
    const phoneMap = new Map();
    expect(lookupGuestFromMaps("972548036760", 4327, phoneMap, idMap)?.id).toBe(4327);
  });

  test("shouldHydrateInboxRosterAnchor for checked_in suite", () => {
    const today = israelTodayStr();
    expect(
      shouldHydrateInboxRosterAnchor({
        phone: "+972548036760",
        status: "checked_in",
        room: "אקווה מרין 23",
        room_type: "suite",
        arrival_date: today,
        departure_date: today,
      }, today),
    ).toBe(true);
  });

  test("mergeRosterAnchorContacts adds ghost when phone absent from WA window", () => {
    const today = israelTodayStr();
    const anchor = {
      id: 99,
      name: "אורח ללא הודעה",
      phone: "+972501234567",
      status: "checked_in",
      room: "רובי 14",
      room_type: "suite",
      arrival_date: today,
      departure_date: today,
    };
    const merged = mergeRosterAnchorContacts([], [anchor], canon);
    expect(merged).toHaveLength(1);
    expect(merged[0].guestId).toBe(99);
    expect(merged[0].isRosterAnchor).toBe(true);
    expect(merged[0].messages).toEqual([]);
  });

  test("mergeRosterAnchorContacts skips duplicate phone", () => {
    const today = israelTodayStr();
    const existing = [{
      threadKey: "972501234567",
      phone: "972501234567",
      messages: [{ id: 1 }],
      guestId: 1,
    }];
    const anchor = {
      id: 99,
      name: "אחר",
      phone: "+972501234567",
      status: "checked_in",
      room: "רובי 14",
      room_type: "suite",
      arrival_date: today,
      departure_date: today,
    };
    expect(mergeRosterAnchorContacts(existing, [anchor], canon)).toHaveLength(1);
  });

  test("buildGuestMapsFromRows picks active stay on duplicate phone", () => {
    const today = israelTodayStr();
    const { phoneMap } = buildGuestMapsFromRows([
      { id: 1, phone: "+972501111111", status: "checked_out", arrival_date: "2026-01-01", room: "רובי 1", room_type: "suite" },
      { id: 2, phone: "+972501111111", status: "checked_in", arrival_date: today, departure_date: today, room: "רובי 2", room_type: "suite" },
    ], today);
    expect(phoneMap.get("501111111")?.id).toBe(2);
  });

  test("buildGhostContactFromGuestEntry", () => {
    const ghost = buildGhostContactFromGuestEntry(
      { id: 5, name: "X", phone: "+972501234567", status: "checked_in", room: "רובי 1", room_type: "suite" },
      canon,
    );
    expect(ghost.phone).toBe("972501234567");
    expect(ghost.guestId).toBe(5);
  });

  test("fetchInboxRosterAnchorGuests paginates past 1000-row PostgREST cap", async () => {
    const today = israelTodayStr();
    const checkedInRows = Array.from({ length: 1001 }, (_, i) => ({
      id: i + 1,
      name: `אורח ${i + 1}`,
      phone: `+97250${String(1000000 + i).slice(-7)}`,
      status: "checked_in",
      room: "אקווה מרין 23",
      room_type: "suite",
      arrival_date: today,
      departure_date: today,
    }));
    const supabase = makeMockSupabase({ checkedInRows, arrivingRows: [] });

    const result = await fetchInboxRosterAnchorGuests(supabase, today);

    expect(result).toHaveLength(1001);
    expect(new Set(result.map((g) => g.id)).size).toBe(1001);
    expect(result.some((g) => g.id === 1001)).toBe(true);
  });

  test("fetchInboxRosterAnchorGuests dedupes guests present in both queries", async () => {
    const today = israelTodayStr();
    const shared = {
      id: 42,
      name: "משותף",
      phone: "+972501234567",
      status: "checked_in",
      room: "אקווה מרין 23",
      room_type: "suite",
      arrival_date: today,
      departure_date: today,
    };
    const supabase = makeMockSupabase({ checkedInRows: [shared], arrivingRows: [shared] });

    const result = await fetchInboxRosterAnchorGuests(supabase, today);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(42);
  });
});
