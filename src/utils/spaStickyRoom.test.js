import { inferHomeRoomByTherapist, resolveHomeRoomMap, planAlignDay } from "./spaStickyRoom";

const DATE = "2026-07-13";

function appt(id, therapistId, roomId, startTime, status = "active") {
  return { id, therapist_id: therapistId, room_id: roomId, start_time: startTime, status, appointment_date: DATE };
}

describe("inferHomeRoomByTherapist", () => {
  test("earliest non-cancelled appointment wins", () => {
    const appts = [appt(1, 10, 100, "11:00"), appt(2, 10, 200, "09:00"), appt(3, 10, 300, "10:00")];
    expect(inferHomeRoomByTherapist(appts).get(10)).toBe(200);
  });

  test("cancelled appointments are ignored", () => {
    const appts = [appt(1, 10, 100, "09:00", "cancelled"), appt(2, 10, 200, "10:00")];
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

describe("planAlignDay", () => {
  test("no moves when every appointment is already in its therapist's home room", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 10, 100, "11:00")];
    const { moves } = planAlignDay(appts, []);
    expect(moves).toEqual([]);
  });

  test("proposes a move for an appointment outside the inferred home room", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 10, 200, "11:00")];
    const { moves } = planAlignDay(appts, []);
    expect(moves).toEqual([{ apptId: 2, therapistId: 10, fromRoomId: 200, toRoomId: 100 }]);
  });

  test("roster wins over inference when planning moves", () => {
    const appts = [appt(1, 10, 100, "09:00")];
    const roster = [{ appointment_date: DATE, room_id: 999, therapist_id: 10 }];
    const { moves } = planAlignDay(appts, roster);
    expect(moves).toEqual([{ apptId: 1, therapistId: 10, fromRoomId: 100, toRoomId: 999 }]);
  });

  test("seeds rosterUpserts only for therapists missing a roster row", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 20, 300, "09:30")];
    const roster = [{ appointment_date: DATE, room_id: 300, therapist_id: 20 }];
    const { rosterUpserts } = planAlignDay(appts, roster);
    expect(rosterUpserts).toEqual([{ appointment_date: DATE, room_id: 100, therapist_id: 10 }]);
  });

  test("cancelled appointments never produce a move", () => {
    const appts = [appt(1, 10, 100, "09:00"), appt(2, 10, 200, "11:00", "cancelled")];
    const { moves } = planAlignDay(appts, []);
    expect(moves).toEqual([]);
  });

  test("empty input returns empty plan", () => {
    expect(planAlignDay([], [])).toEqual({ rosterUpserts: [], moves: [] });
  });
});
