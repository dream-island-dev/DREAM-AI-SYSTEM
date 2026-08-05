import { classifyRoomReadySendResult, fetchSuiteRoomsForGuestIds } from "./suiteRoomReady";

/** Generic thenable query-builder mock — every filter method returns itself,
 * and awaiting the builder resolves to the canned response, so it works
 * regardless of which chain (.in()/.eq()/.order()) the caller uses. */
function makeMockSupabase(suiteRoomsResponse) {
  const builder = {
    select() { return builder; },
    in() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    then(resolve, reject) {
      return Promise.resolve(suiteRoomsResponse).then(resolve, reject);
    },
  };
  return {
    from(table) {
      if (table !== "suite_rooms") throw new Error(`unexpected table: ${table}`);
      return builder;
    },
  };
}

describe("fetchSuiteRoomsForGuestIds — fail-visible errors (P0 2026-08-05)", () => {
  test("returns the grouped map with error:null on success", async () => {
    const supabase = makeMockSupabase({
      data: [{ id: 1, guest_id: 5, room_display: "אמטיסט 8" }],
      error: null,
    });
    const { map, error } = await fetchSuiteRoomsForGuestIds(supabase, [{ id: 5 }]);
    expect(error).toBeNull();
    expect(map[5]).toHaveLength(1);
  });

  test("surfaces the error instead of silently returning an empty map", async () => {
    const supabase = makeMockSupabase({ data: null, error: { message: "permission denied" } });
    const { map, error } = await fetchSuiteRoomsForGuestIds(supabase, [{ id: 5 }]);
    expect(error).toBe("permission denied");
    expect(map).toEqual({});
  });

  test("empty input → empty map, no error", async () => {
    const result = await fetchSuiteRoomsForGuestIds(makeMockSupabase({ data: [], error: null }), []);
    expect(result).toEqual({ map: {}, error: null });
  });
});

describe("classifyRoomReadySendResult", () => {
  test("hard error → error, never a success toast", () => {
    expect(classifyRoomReadySendResult({ data: null, error: { message: "boom" } }))
      .toEqual({ ok: false, kind: "error", reason: "boom" });
  });

  test("data.ok === false → error even without a transport error", () => {
    expect(classifyRoomReadySendResult({ data: { ok: false, error: "blocked_by_meta" }, error: null }))
      .toEqual({ ok: false, kind: "error", reason: "blocked_by_meta" });
  });

  test("timeout status → ok:true but kind:timeout, not a plain success", () => {
    expect(classifyRoomReadySendResult({ data: { ok: true, status: "timeout" }, error: null }))
      .toEqual({ ok: true, kind: "timeout" });
  });

  test("duplicate_blocked → ok:true but kind:duplicate, never mislabeled as a fresh send", () => {
    expect(classifyRoomReadySendResult({
      data: { ok: true, skipped: true, status: "duplicate_blocked" }, error: null,
    })).toEqual({ ok: true, kind: "duplicate" });
  });

  test("generic skipped (no duplicate status) carries its reason through", () => {
    expect(classifyRoomReadySendResult({
      data: { ok: true, skipped: true, reason: "quiet_hours" }, error: null,
    })).toEqual({ ok: true, kind: "skipped", reason: "quiet_hours" });
  });

  test("plain success → kind:sent, simulation flag passed through", () => {
    expect(classifyRoomReadySendResult({ data: { ok: true, simulation: true }, error: null }))
      .toEqual({ ok: true, kind: "sent", simulation: true });
  });

  test("plain success without simulation flag defaults to false", () => {
    expect(classifyRoomReadySendResult({ data: { ok: true }, error: null }))
      .toEqual({ ok: true, kind: "sent", simulation: false });
  });
});
