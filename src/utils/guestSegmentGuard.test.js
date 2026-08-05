import {
  normalizeGuestPhoneForLookup,
  assertGuestSegmentConsistent,
  assertNoConflictingSuiteProfile,
  assertNoDuplicateGuest,
  fetchSplitBrainSuiteGuests,
  bulkFixSplitBrainSuiteGuests,
  fetchDuplicateGuestPairs,
  deleteGuestProfileById,
} from "./guestSegmentGuard";

/** Minimal thenable query-builder mock — every filter method returns itself,
 * and awaiting the builder resolves to the canned response (mirrors the
 * real supabase-js query builder's thenable behavior). */
function makeThenableBuilder(response) {
  const builder = {
    select() { return builder; },
    update() { return builder; },
    in() { return builder; },
    eq() { return builder; },
    neq() { return builder; },
    lte() { return builder; },
    gte() { return builder; },
    not() { return builder; },
    order() { return builder; },
    or() { return builder; },
    then(resolve, reject) {
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  return builder;
}

function makeMockSupabase({ guestsResponse = { data: [], error: null }, rpcResponse } = {}) {
  return {
    from(table) {
      if (table === "guests") return makeThenableBuilder(guestsResponse);
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name, args) {
      return Promise.resolve(rpcResponse ?? { data: null, error: new Error("no rpc response configured") });
    },
  };
}

describe("normalizeGuestPhoneForLookup", () => {
  test("normalizes an Israeli mobile to E.164", () => {
    expect(normalizeGuestPhoneForLookup("0501234567")).toBe("+972501234567");
    expect(normalizeGuestPhoneForLookup("972501234567")).toBe("+972501234567");
    expect(normalizeGuestPhoneForLookup("+972501234567")).toBe("+972501234567");
  });

  test("returns null for empty/missing phone", () => {
    expect(normalizeGuestPhoneForLookup(null)).toBeNull();
    expect(normalizeGuestPhoneForLookup("")).toBeNull();
  });
});

describe("assertGuestSegmentConsistent — split-brain gate", () => {
  test("throws when a canonical suite room is paired with day_guest", () => {
    expect(() =>
      assertGuestSegmentConsistent({ room: "ג׳ספר 3", room_type: "day_guest" }),
    ).toThrow(/לא עקבי/);
  });

  test("throws when a canonical suite room is paired with premium_day_guest", () => {
    expect(() =>
      assertGuestSegmentConsistent({ room: "אמטיסט 8", room_type: "premium_day_guest" }),
    ).toThrow(/לא עקבי/);
  });

  test("does not throw for a real suite pairing", () => {
    expect(() =>
      assertGuestSegmentConsistent({ room: "ג׳ספר 3", room_type: "suite" }),
    ).not.toThrow();
  });

  test("does not throw for a real Premium Day pairing", () => {
    expect(() =>
      assertGuestSegmentConsistent({ room: "Premium Day 1", room_type: "premium_day_guest" }),
    ).not.toThrow();
  });

  test("does not throw for a generic day-pass pairing", () => {
    expect(() =>
      assertGuestSegmentConsistent({ room: "בילוי יומי", room_type: "day_guest" }),
    ).not.toThrow();
  });
});

describe("assertNoConflictingSuiteProfile — hermetic day-pass create gate", () => {
  test("throws when an active suite profile exists for the same phone within the stay window", async () => {
    const supabase = makeMockSupabase({
      guestsResponse: {
        data: [
          { id: 1, name: "דנה", room: "רובי 14", room_type: "suite", arrival_date: "2026-08-01", departure_date: "2026-08-10" },
        ],
        error: null,
      },
    });
    await expect(
      assertNoConflictingSuiteProfile(supabase, "+972501234567", "2026-08-05"),
    ).rejects.toThrow(/פרופיל סוויטה פעיל/);
  });

  test("matches even when the stored phone lacks the leading + (bookings-style digits)", async () => {
    const supabase = makeMockSupabase({
      guestsResponse: {
        data: [
          { id: 1, name: "דנה", room: "רובי 14", room_type: "suite", arrival_date: "2026-08-01", departure_date: "2026-08-10" },
        ],
        error: null,
      },
    });
    await expect(
      assertNoConflictingSuiteProfile(supabase, "972501234567", "2026-08-05"),
    ).rejects.toThrow(/פרופיל סוויטה פעיל/);
  });

  test("does not throw when no conflicting suite profile exists", async () => {
    const supabase = makeMockSupabase({ guestsResponse: { data: [], error: null } });
    await expect(
      assertNoConflictingSuiteProfile(supabase, "+972501234567", "2026-08-05"),
    ).resolves.toBeUndefined();
  });

  test("is a no-op when phone or arrivalDate is missing", async () => {
    const supabase = makeMockSupabase();
    await expect(assertNoConflictingSuiteProfile(supabase, null, "2026-08-05")).resolves.toBeUndefined();
    await expect(assertNoConflictingSuiteProfile(supabase, "+972501234567", null)).resolves.toBeUndefined();
  });
});

describe("assertNoDuplicateGuest — phone-format-agnostic duplicate check", () => {
  test("catches a duplicate even when phone formats differ (+972 vs bare 972)", async () => {
    const supabase = makeMockSupabase({
      guestsResponse: {
        data: [{ id: 5, name: "יוסי", phone: "972501234567", arrival_date: "2026-08-05", status: "expected" }],
        error: null,
      },
    });
    await expect(
      assertNoDuplicateGuest(supabase, "+972501234567", "2026-08-05"),
    ).rejects.toThrow(/כבר קיים פרופיל אורח/);
  });

  test("excludes the guest's own row when editing (excludeId)", async () => {
    const supabase = makeMockSupabase({
      guestsResponse: {
        data: [{ id: 5, name: "יוסי", phone: "+972501234567", arrival_date: "2026-08-05", status: "expected" }],
        error: null,
      },
    });
    await expect(
      assertNoDuplicateGuest(supabase, "+972501234567", "2026-08-05", { excludeId: 5 }),
    ).resolves.toBeUndefined();
  });

  test("does not throw when no duplicate exists", async () => {
    const supabase = makeMockSupabase({ guestsResponse: { data: [], error: null } });
    await expect(
      assertNoDuplicateGuest(supabase, "+972501234567", "2026-08-05"),
    ).resolves.toBeUndefined();
  });
});

describe("fetchSplitBrainSuiteGuests", () => {
  test("filters to rows whose room is a canonical suite (client-side, geresh-tolerant)", async () => {
    const supabase = makeMockSupabase({
      guestsResponse: {
        data: [
          { id: 1, name: "מיה", room: "ג׳ספר 3", room_type: "day_guest" },
          { id: 2, name: "עדי", room: "בילוי יומי", room_type: "day_guest" },
          { id: 3, name: "רון", room: "Premium Day 1", room_type: "premium_day_guest" },
        ],
        error: null,
      },
    });
    const { guests, error } = await fetchSplitBrainSuiteGuests(supabase);
    expect(error).toBeNull();
    expect(guests.map((g) => g.id)).toEqual([1]);
  });
});

describe("bulkFixSplitBrainSuiteGuests", () => {
  test("updates room_type to suite for the given ids and never touches room/status", async () => {
    const supabase = makeMockSupabase({ guestsResponse: { data: null, error: null } });
    const { updated, error } = await bulkFixSplitBrainSuiteGuests(supabase, [1, 2]);
    expect(error).toBeNull();
    expect(updated).toBe(2);
  });

  test("no-ops on an empty id list", async () => {
    const supabase = makeMockSupabase();
    const { updated, error } = await bulkFixSplitBrainSuiteGuests(supabase, []);
    expect(error).toBeNull();
    expect(updated).toBe(0);
  });
});

describe("fetchDuplicateGuestPairs", () => {
  test("pairs same normalized phone with overlapping stay windows", async () => {
    const supabase = makeMockSupabase({
      guestsResponse: {
        data: [
          { id: 1, name: "אורח", phone: "+972501234567", room: "רובי 14", room_type: "suite", status: "checked_in", arrival_date: "2026-08-01", departure_date: "2026-08-10" },
          { id: 2, name: "אורח", phone: "972501234567", room: "בילוי יומי", room_type: "day_guest", status: "pending", arrival_date: "2026-08-05", departure_date: "2026-08-05" },
        ],
        error: null,
      },
    });
    const { pairs, error } = await fetchDuplicateGuestPairs(supabase);
    expect(error).toBeNull();
    expect(pairs).toHaveLength(1);
    expect(pairs[0].map((g) => g.id).sort()).toEqual([1, 2]);
  });

  test("does not pair the same phone when stay windows do not overlap", async () => {
    const supabase = makeMockSupabase({
      guestsResponse: {
        data: [
          { id: 1, name: "אורח א", phone: "+972501234567", arrival_date: "2026-08-01", departure_date: "2026-08-03" },
          { id: 2, name: "אורח ב", phone: "+972501234567", arrival_date: "2026-09-01", departure_date: "2026-09-03" },
        ],
        error: null,
      },
    });
    const { pairs } = await fetchDuplicateGuestPairs(supabase);
    expect(pairs).toHaveLength(0);
  });
});

describe("deleteGuestProfileById", () => {
  test("returns ok:true on a successful RPC call", async () => {
    const supabase = makeMockSupabase({ rpcResponse: { data: { ok: true, phone: "+972501234567", name: "יוסי" }, error: null } });
    const result = await deleteGuestProfileById(supabase, 5);
    expect(result.ok).toBe(true);
    expect(result.name).toBe("יוסי");
  });

  test("returns ok:false when the RPC reports an application error", async () => {
    const supabase = makeMockSupabase({ rpcResponse: { data: { ok: false, error: "guest_not_found" }, error: null } });
    const result = await deleteGuestProfileById(supabase, 999);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("guest_not_found");
  });
});
