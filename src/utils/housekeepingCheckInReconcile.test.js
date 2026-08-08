import {
  buildHousekeepingSyncMap,
  collectGuestSuiteRoomIds,
  fetchHousekeepingActivityForDate,
  fetchHousekeepingCheckInsForDate,
  indexHousekeepingActivityRoomIds,
  indexHousekeepingCheckInsByRoom,
  markHousekeepingEventSynced,
  reconcileHousekeepingCheckIns,
  resolveGuestHousekeepingSync,
} from "./housekeepingCheckInReconcile";
import { israelTodayStr, israelDateOffsetStr } from "./guestTiming";

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
    in() { return builder; },
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

  describe("resolveGuestHousekeepingSync — awaiting_group_signal (B1, 2026-08-08)", () => {
    // Forensic-shaped: 2026-08-07 had 9 rooms with a ready (✅) signal but no
    // check_in text was ever sent, while guests stayed stuck at "expected".
    const yesterday = israelDateOffsetStr(-1);
    const today = israelTodayStr();

    test("ready activity, no check_in row, guest still pending past arrival → awaiting_group_signal", () => {
      const hkByRoom = indexHousekeepingCheckInsByRoom([]); // no check_in events at all today
      const activityRoomIds = indexHousekeepingActivityRoomIds([
        { room_id: "אמטיסט 9", event_type: "ready", created_at: "2026-08-07T11:58:42Z" },
      ]);
      const guest = { id: 4966, status: "expected", arrival_date: yesterday, room: "אמטיסט 9" };
      const sync = resolveGuestHousekeepingSync(guest, [], hkByRoom, activityRoomIds);
      expect(sync.state).toBe("awaiting_group_signal");
      expect(sync.roomId).toBe("אמטיסט 9");
    });

    test("check_in row present wins over activity — stays on the existing pending/synced path, not awaiting", () => {
      const hkByRoom = indexHousekeepingCheckInsByRoom([
        { id: 1, room_id: "ג׳ספר 6", created_at: "2026-08-07T09:51:00Z", sync_action: "no_guest" },
      ]);
      const activityRoomIds = indexHousekeepingActivityRoomIds([
        { room_id: "ג׳ספר 6", event_type: "ready", created_at: "2026-08-07T09:00:00Z" },
      ]);
      const guest = { id: 10, status: "expected", arrival_date: yesterday, room: "ג׳ספר 6" };
      const sync = resolveGuestHousekeepingSync(guest, [], hkByRoom, activityRoomIds);
      expect(sync.state).toBe("pending"); // unchanged from pre-B1 behavior
    });

    test("no housekeeping activity at all for the room → none, not awaiting", () => {
      const hkByRoom = indexHousekeepingCheckInsByRoom([]);
      const activityRoomIds = indexHousekeepingActivityRoomIds([
        { room_id: "אמרלד 20", event_type: "ready", created_at: "2026-08-07T13:46:08Z" },
      ]);
      const guest = { id: 4969, status: "expected", arrival_date: yesterday, room: "ג׳ספר 1" }; // different room
      const sync = resolveGuestHousekeepingSync(guest, [], hkByRoom, activityRoomIds);
      expect(sync.state).toBe("none");
    });

    test("checked_in guest never gets awaiting_group_signal, even with activity and no check_in row", () => {
      const activityRoomIds = indexHousekeepingActivityRoomIds([
        { room_id: "אמטיסט 9", event_type: "ready", created_at: "2026-08-07T11:58:42Z" },
      ]);
      const guest = { id: 1, status: "checked_in", arrival_date: yesterday, room: "אמטיסט 9" };
      const sync = resolveGuestHousekeepingSync(guest, [], {}, activityRoomIds);
      expect(sync.state).toBe("none");
    });

    test("future arrival never gets awaiting_group_signal, even with activity on the room", () => {
      const tomorrow = israelDateOffsetStr(1);
      const activityRoomIds = indexHousekeepingActivityRoomIds([
        { room_id: "אמטיסט 9", event_type: "ready", created_at: `${today}T11:58:42Z` },
      ]);
      const guest = { id: 2, status: "expected", arrival_date: tomorrow, room: "אמטיסט 9" };
      const sync = resolveGuestHousekeepingSync(guest, [], {}, activityRoomIds);
      expect(sync.state).toBe("none");
    });

    test("checkout activity alone (no ready) also triggers awaiting_group_signal", () => {
      const activityRoomIds = indexHousekeepingActivityRoomIds([
        { room_id: "רובי 15", event_type: "check_out", created_at: "2026-08-07T12:10:38Z" },
      ]);
      const guest = { id: 4680, status: "expected", arrival_date: yesterday, room: "רובי 15" };
      const sync = resolveGuestHousekeepingSync(guest, [], {}, activityRoomIds);
      expect(sync.state).toBe("awaiting_group_signal");
    });

    test("no activityRoomIds arg at all (legacy callers) never crashes, behaves exactly as before B1", () => {
      const guest = { id: 3, status: "expected", arrival_date: yesterday, room: "אמטיסט 9" };
      const sync = resolveGuestHousekeepingSync(guest, [], {});
      expect(sync.state).toBe("none");
    });

    test("buildHousekeepingSyncMap wires activityRoomIds through for multiple guests", () => {
      const activityRoomIds = indexHousekeepingActivityRoomIds([
        { room_id: "אמטיסט 9", event_type: "ready", created_at: "2026-08-07T11:58:42Z" },
      ]);
      const map = buildHousekeepingSyncMap(
        [
          { id: 100, status: "expected", arrival_date: yesterday, room: "אמטיסט 9" },
          { id: 101, status: "expected", arrival_date: yesterday, room: "אמטיסט 11" },
        ],
        {},
        {},
        activityRoomIds,
      );
      expect(map[100].state).toBe("awaiting_group_signal");
      expect(map[101].state).toBe("none");
    });
  });

  describe("indexHousekeepingActivityRoomIds", () => {
    test("collects unique room_ids from ready/check_out rows", () => {
      const ids = indexHousekeepingActivityRoomIds([
        { room_id: "אמטיסט 9", event_type: "ready" },
        { room_id: "אמטיסט 9", event_type: "ready" },
        { room_id: "ג׳ספר 6", event_type: "check_out" },
      ]);
      expect(ids).toEqual(new Set(["אמטיסט 9", "ג׳ספר 6"]));
    });

    test("empty/missing input never crashes", () => {
      expect(indexHousekeepingActivityRoomIds([])).toEqual(new Set());
      expect(indexHousekeepingActivityRoomIds(undefined)).toEqual(new Set());
    });
  });

  describe("fetchHousekeepingActivityForDate — fail-visible errors (B1, 2026-08-08)", () => {
    test("returns rows with error:null on success", async () => {
      const supabase = makeMockSupabaseForSelect({ data: [{ id: 1, room_id: "אמטיסט 9", event_type: "ready" }], error: null });
      const { rows, error } = await fetchHousekeepingActivityForDate(supabase, "2026-08-07");
      expect(error).toBeNull();
      expect(rows).toHaveLength(1);
    });

    test("surfaces the error instead of returning an empty array indistinguishable from 'no activity'", async () => {
      const supabase = makeMockSupabaseForSelect({ data: null, error: { message: "network error" } });
      const { rows, error } = await fetchHousekeepingActivityForDate(supabase, "2026-08-07");
      expect(error).toBe("network error");
      expect(rows).toEqual([]);
    });
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
