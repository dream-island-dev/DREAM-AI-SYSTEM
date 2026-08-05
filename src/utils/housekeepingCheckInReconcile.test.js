import {
  buildHousekeepingSyncMap,
  collectGuestSuiteRoomIds,
  fetchHousekeepingCheckInsForDate,
  indexHousekeepingCheckInsByRoom,
  markHousekeepingEventSynced,
  reconcileHousekeepingCheckIns,
  resolveGuestHousekeepingSync,
} from "./housekeepingCheckInReconcile";

function makeMockSupabase(updateResponse) {
  return {
    from(table) {
      if (table === "housekeeping_wa_events") {
        return {
          update() {
            return { eq: () => Promise.resolve(updateResponse) };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function makeMockSupabaseForSelect(selectResponse) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    gte() { return builder; },
    lte() { return builder; },
    order() { return Promise.resolve(selectResponse); },
  };
  return {
    from(table) {
      if (table !== "housekeeping_wa_events") throw new Error(`unexpected table: ${table}`);
      return builder;
    },
  };
}

describe("housekeepingCheckInReconcile", () => {
  test("collectGuestSuiteRoomIds resolves canonical suite from bare number", () => {
    expect(collectGuestSuiteRoomIds({ room: "8", suite_name: null }, [])).toEqual(["אמטיסט 8"]);
  });

  test("indexHousekeepingCheckInsByRoom keeps latest per room", () => {
    const byRoom = indexHousekeepingCheckInsByRoom([
      { room_id: "אמטיסט 9", created_at: "2026-08-05T10:00:00Z", sync_action: "no_guest" },
      { room_id: "אמטיסט 9", created_at: "2026-08-05T13:00:00Z", sync_action: "updated" },
    ]);
    expect(byRoom["אמטיסט 9"].sync_action).toBe("updated");
  });

  test("resolveGuestHousekeepingSync: pending when group signal but guest still expected", () => {
    const hkByRoom = indexHousekeepingCheckInsByRoom([
      { id: 1, room_id: "ג׳ספר 6", created_at: "2026-08-05T09:51:00Z", sync_action: "no_guest" },
    ]);
    const sync = resolveGuestHousekeepingSync(
      { id: 10, status: "expected", room: "ג׳ספר 6" },
      [],
      hkByRoom,
    );
    expect(sync.state).toBe("pending");
    expect(sync.roomId).toBe("ג׳ספר 6");
  });

  test("buildHousekeepingSyncMap marks checked_in guest as synced", () => {
    const hkByRoom = indexHousekeepingCheckInsByRoom([
      { id: 2, room_id: "אמטיסט 8", created_at: "2026-08-05T10:55:00Z", sync_action: "updated" },
    ]);
    const map = buildHousekeepingSyncMap(
      [{ id: 5, status: "checked_in", room: "אמטיסט 8" }],
      {},
      hkByRoom,
    );
    expect(map[5].state).toBe("synced");
  });

  describe("fetchHousekeepingCheckInsForDate — fail-visible errors (P0 2026-08-05)", () => {
    test("returns rows with error:null on success", async () => {
      const supabase = makeMockSupabaseForSelect({ data: [{ id: 1, room_id: "אמטיסט 8" }], error: null });
      const { rows, error } = await fetchHousekeepingCheckInsForDate(supabase, "2026-08-05");
      expect(error).toBeNull();
      expect(rows).toHaveLength(1);
    });

    test("surfaces the error instead of returning an empty array indistinguishable from 'no signals'", async () => {
      const supabase = makeMockSupabaseForSelect({ data: null, error: { message: "network error" } });
      const { rows, error } = await fetchHousekeepingCheckInsForDate(supabase, "2026-08-05");
      expect(error).toBe("network error");
      expect(rows).toEqual([]);
    });
  });

  describe("reconcileHousekeepingCheckIns — ambiguous-room confirmation gate (QA P2 2026-08-05)", () => {
    test("never auto-applies when the room's signal already resolved to a different guest (logged_success_guest_stale)", async () => {
      const hkByRoom = indexHousekeepingCheckInsByRoom([
        { id: 3, room_id: "ג׳ספר 6", created_at: "2026-08-05T09:00:00Z", sync_action: "updated", guest_id: 999 },
      ]);
      const guest = { id: 20, status: "expected", room: "ג׳ספר 6" };
      // Sanity check this fixture actually exercises the guarded branch.
      const sync = resolveGuestHousekeepingSync(guest, [], hkByRoom);
      expect(sync.reason).toBe("logged_success_guest_stale");

      // Throws on any table access — proves performSuiteCheckIn (writes to
      // "guests") is never reached, i.e. the `continue` guard fired first.
      const supabaseThatMustNotBeCalled = {
        from(table) { throw new Error(`unexpected supabase.from(${table}) call — auto-apply should have been skipped`); },
      };
      const applied = await reconcileHousekeepingCheckIns(
        supabaseThatMustNotBeCalled,
        [guest],
        { 20: [] },
        hkByRoom,
      );
      expect(applied).toEqual([]);
    });
  });

  describe("markHousekeepingEventSynced — RLS fail-visible (P0 2026-08-05)", () => {
    test("returns ok:true on a successful update", async () => {
      const supabase = makeMockSupabase({ error: null });
      const result = await markHousekeepingEventSynced(supabase, 1, 5);
      expect(result).toEqual({ ok: true });
    });

    test("surfaces the error instead of silently swallowing an RLS-blocked update", async () => {
      const supabase = makeMockSupabase({ error: { message: "permission denied for table housekeeping_wa_events" } });
      const result = await markHousekeepingEventSynced(supabase, 1, 5);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/permission denied/);
    });

    test("is a no-op when eventId is missing", async () => {
      const supabase = makeMockSupabase({ error: null });
      const result = await markHousekeepingEventSynced(supabase, null, 5);
      expect(result).toEqual({ ok: false });
    });
  });
});
