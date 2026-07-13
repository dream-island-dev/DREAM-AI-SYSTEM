import {
  inferHomeRoomByTherapist,
  resolveHomeRoomMap,
  planAlignDay,
  timesOverlap,
  canPlaceInRoom,
} from "./spaStickyRoom";

const DATE = "2026-07-13";

function appt(id, therapistId, roomId, startTime, endTime = null, status = "active") {
  const end = endTime ?? (() => {
    const [h, m] = startTime.split(":").map(Number);
    return `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  })();
  return {
    id,
    therapist_id: therapistId,
    room_id: roomId,
    start_time: startTime,
    end_time: end,
    status,
    appointment_date: DATE,
  };
}

describe("inferHomeRoomByTherapist", () => {
  test("earliest non-cancelled appointment wins", () => {
    const appts = [appt(1, 10, 100, "11:00"), appt(2, 10, 200, "09:00"), appt(3, 10, 300, "10:00")];
    expect(inferHomeRoomByTherapist(appts).get(10)).toBe(200);
  });

  test("cancelled appointments are ignored", () => {
    const appts = [appt(1, 10, 100, "09:00", null, "cancelled"), appt(2, 10, 200, "10:00")];
    expect(inferHomeRoomByTherapist(appts).get(10)).toBe(200);
  });

  test("appointments without a therapist are ignored", () => {
    const appts = [appt(1, null, 100, "09:00")];
    expect(inferHomeRoomByTherapist(appts).size).toBe(0);
  });
});

describe("resolveHomeRoomMap", () => {
  test("existing roster row overrides first-touch inference", () => {
    const appts = [appt(1, 10, 100, "09:00")];
    const roster = [{ appointment_date: DATE, room_id: 999, therapist_id: 10 }];
    expect(resolveHomeRoomMap(appts, roster).get(10)).toBe(999);
  });

  test("falls back to inference when no roster row exists", () => {
    const appts = [appt(1, 10, 100, "09:00")];
    expect(resolveHomeRoomMap(appts, []).get(10)).toBe(100);
  });
});

describe("timesOverlap", () => {
  test("adjacent half-open ranges do not overlap", () => {
    expect(timesOverlap("09:00", "10:00", "10:00", "11:00")).toBe(false);
  });

  test("partial overlap is true", () => {
    expect(timesOverlap("09:00", "10:30", "10:00", "11:00")).toBe(true);
  });
});

describe("canPlaceInRoom", () => {
  const roomTypes = { 100: "single", 200: "couple" };

  test("single room blocks a second overlapping appointment", () => {
    const sim = [appt(1, 10, 100, "09:00")];
    const candidate = appt(2, 20, 200, "09:30");
    expect(canPlaceInRoom(sim, candidate, 100, roomTypes)).toBe(false);
  });

  test("couple room allows a second overlapping appointment", () => {
    const sim = [appt(1, 10, 200, "09:00")];
    const candidate = appt(2, 20, 100, "09:30");
    expect(canPlaceInRoom(sim, candidate, 200, roomTypes)).toBe(true);
  });

  test("couple room blocks a third overlapping appointment", () => {
    const sim = [appt(1, 10, 200, "09:00"), appt(2, 20, 200, "09:15")];
    const candidate = appt(3, 30, 100, "09:30");
    expect(canPlaceInRoom(sim, candidate, 200, roomTypes)).toBe(false);
  });
});

describe("planAlignDay", () => {
  const singles = { 100: "single", 200: "single", 300: "single", 999: "single" };

  test("no moves when every appointment is already in its therapist's home room", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 10, 100, "11:00")];
    const { safeMoves, blockedMoves } = planAlignDay(appts, [], singles);
    expect(safeMoves).toEqual([]);
    expect(blockedMoves).toEqual([]);
  });

  test("safe move when target room is free", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 10, 200, "11:00")];
    const { safeMoves, blockedMoves } = planAlignDay(appts, [], singles);
    expect(safeMoves).toEqual([{ apptId: 2, therapistId: 10, fromRoomId: 200, toRoomId: 100 }]);
    expect(blockedMoves).toEqual([]);
  });

  test("blocks move when home room is already occupied at that time", () => {
    // Therapist 10 home=100 (09:00). Therapist 20 also in 100 at 11:00.
    // Therapist 10's later appt in 200 at 11:00 cannot move into 100.
    const appts = [
      appt(1, 10, 100, "09:00"),
      appt(2, 20, 100, "11:00"),
      appt(3, 10, 200, "11:00"),
    ];
    const { safeMoves, blockedMoves } = planAlignDay(appts, [], singles);
    expect(safeMoves).toEqual([]);
    expect(blockedMoves).toEqual([
      { apptId: 3, therapistId: 10, fromRoomId: 200, toRoomId: 100, reason: "room_full" },
    ]);
  });

  test("cascade: freeing a room unlocks a later safe move", () => {
    // T10 home=100, T20 home=200. At 11:00 T20 is wrongly in 100 but home 200 is free →
    // moves first and frees 100; then T10 (wrongly in 300) can move into 100.
    const appts = [
      appt(1, 10, 100, "09:00"),
      appt(2, 20, 200, "09:00"),
      appt(3, 20, 100, "11:00"),
      appt(4, 10, 300, "11:00"),
    ];
    const { safeMoves, blockedMoves, swapPairs } = planAlignDay(appts, [], singles, [100, 200, 300]);
    expect(blockedMoves).toEqual([]);
    expect(swapPairs).toEqual([]);
    expect(safeMoves).toEqual([
      { apptId: 3, therapistId: 20, fromRoomId: 100, toRoomId: 200 },
      { apptId: 4, therapistId: 10, fromRoomId: 300, toRoomId: 100 },
    ]);
  });

  test("mutual deadlock becomes a parking-room swap when a free room exists", () => {
    // Each sits in the other's home at 11:00 — parking on room 300 lets DB apply 3 hops.
    const appts = [
      appt(1, 10, 100, "09:00"),
      appt(2, 20, 200, "09:00"),
      appt(3, 20, 100, "11:00"),
      appt(4, 10, 200, "11:00"),
    ];
    const { safeMoves, blockedMoves, swapPairs } = planAlignDay(appts, [], singles, [100, 200, 300]);
    expect(safeMoves).toEqual([]);
    expect(blockedMoves).toEqual([]);
    expect(swapPairs).toHaveLength(1);
    expect(swapPairs[0].parkingRoomId).toBe(300);
    expect(swapPairs[0].a.toRoomId).toBe(200);
    expect(swapPairs[0].b.toRoomId).toBe(100);
  });

  test("mutual deadlock stays blocked when no parking room is free", () => {
    const appts = [
      appt(1, 10, 100, "09:00"),
      appt(2, 20, 200, "09:00"),
      appt(3, 20, 100, "11:00"),
      appt(4, 10, 200, "11:00"),
      appt(5, 30, 300, "11:00"), // fills the only other single room
    ];
    const roster = [{ appointment_date: DATE, room_id: 300, therapist_id: 30 }];
    const { safeMoves, blockedMoves, swapPairs } = planAlignDay(appts, roster, singles, [100, 200, 300]);
    expect(safeMoves).toEqual([]);
    expect(swapPairs).toEqual([]);
    expect(blockedMoves).toHaveLength(2);
  });

  test("roster wins over inference when planning moves", () => {
    const appts = [appt(1, 10, 100, "09:00")];
    const roster = [{ appointment_date: DATE, room_id: 999, therapist_id: 10 }];
    // 999 empty → safe
    const { safeMoves, blockedMoves } = planAlignDay(appts, roster, singles);
    expect(safeMoves).toEqual([{ apptId: 1, therapistId: 10, fromRoomId: 100, toRoomId: 999 }]);
    expect(blockedMoves).toEqual([]);
  });

  test("seeds rosterUpserts only for therapists missing a roster row", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 20, 300, "09:30")];
    const roster = [{ appointment_date: DATE, room_id: 300, therapist_id: 20 }];
    const { rosterUpserts } = planAlignDay(appts, roster, singles);
    expect(rosterUpserts).toEqual([{ appointment_date: DATE, room_id: 100, therapist_id: 10 }]);
  });

  test("cancelled appointments never produce a move", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 10, 200, "11:00", null, "cancelled")];
    const { safeMoves, blockedMoves } = planAlignDay(appts, [], singles);
    expect(safeMoves).toEqual([]);
    expect(blockedMoves).toEqual([]);
  });

  test("empty input returns empty plan", () => {
    expect(planAlignDay([], [])).toEqual({
      rosterUpserts: [],
      safeMoves: [],
      swapPairs: [],
      blockedMoves: [],
    });
  });

  test("couple capacity allows two safe moves into the same home room", () => {
    const rooms = { 100: "couple", 200: "single", 300: "single" };
    // T10 home=100 @09. Two later appts for T10 wrongly elsewhere, both @11 — couple holds 2.
    // Actually same therapist can't have two overlapping appointments (therapist exclusion).
    // Use two therapists who both have home=100 via roster.
    const appts = [
      appt(1, 10, 200, "11:00"),
      appt(2, 20, 300, "11:00"),
    ];
    const roster = [
      { appointment_date: DATE, room_id: 100, therapist_id: 10 },
      { appointment_date: DATE, room_id: 100, therapist_id: 20 },
    ];
    const { safeMoves, blockedMoves } = planAlignDay(appts, roster, rooms);
    expect(safeMoves).toHaveLength(2);
    expect(blockedMoves).toEqual([]);
  });
});
