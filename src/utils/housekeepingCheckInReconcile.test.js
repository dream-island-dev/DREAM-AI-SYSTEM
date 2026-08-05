import {
  buildHousekeepingSyncMap,
  collectGuestSuiteRoomIds,
  indexHousekeepingCheckInsByRoom,
  resolveGuestHousekeepingSync,
} from "./housekeepingCheckInReconcile";

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
});
