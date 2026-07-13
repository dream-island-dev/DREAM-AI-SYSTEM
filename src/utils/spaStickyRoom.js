// src/utils/spaStickyRoom.js
// Smart Spa Board — therapist sticky-room pure logic (migration 193 companion).
// Home room = earliest non-cancelled appointment that day for that therapist
// (first-touch); an existing spa_shift_roster row always wins over inference.
// No Supabase here — SpaBoard.js wires these against the DB.

// therapist_id -> room_id, first (earliest start_time) non-cancelled appointment wins.
export function inferHomeRoomByTherapist(appointments) {
  const sorted = [...(appointments ?? [])]
    .filter((a) => a.therapist_id && a.status !== "cancelled" && a.start_time)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  const map = new Map();
  sorted.forEach((a) => {
    if (!map.has(a.therapist_id)) map.set(a.therapist_id, a.room_id);
  });
  return map;
}

// Merges first-touch inference with an existing roster — roster rows win.
export function resolveHomeRoomMap(appointments, roster) {
  const home = inferHomeRoomByTherapist(appointments);
  (roster ?? []).forEach((r) => home.set(r.therapist_id, r.room_id));
  return home;
}

/** Half-open overlap matching Postgres tsrange '[)'. */
export function timesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart < bEnd && bStart < aEnd;
}

function roomCapacity(roomType) {
  return roomType === "couple" ? 2 : 1;
}

/**
 * Can `appt` sit in `targetRoomId` given the current simulated board?
 * Excludes `appt.id` from occupancy. Capacity: single=1, couple=2.
 * `roomTypeById` is Map|Record room_id -> 'single'|'couple'.
 */
export function canPlaceInRoom(simAppts, appt, targetRoomId, roomTypeById) {
  if (targetRoomId == null || !appt) return false;
  const lookup = (id) =>
    roomTypeById instanceof Map ? roomTypeById.get(id) : roomTypeById?.[id];
  const cap = roomCapacity(lookup(targetRoomId) ?? "single");
  let used = 0;
  for (const a of simAppts ?? []) {
    if (a.id === appt.id || a.status === "cancelled") continue;
    if (a.room_id !== targetRoomId) continue;
    if (timesOverlap(a.start_time, a.end_time, appt.start_time, appt.end_time)) used += 1;
    if (used >= cap) return false;
  }
  return true;
}

/** First room where `appt` fits, skipping `excludeRoomIds`. */
export function findParkingRoomId(simAppts, appt, roomIds, roomTypeById, excludeRoomIds = []) {
  const exclude = new Set(excludeRoomIds);
  for (const rid of roomIds ?? []) {
    if (exclude.has(rid)) continue;
    if (canPlaceInRoom(simAppts, appt, rid, roomTypeById)) return rid;
  }
  return null;
}

function runGreedySafeMoves(sim, home, roomTypeById, safeMoves) {
  let progressed = true;
  let any = false;
  while (progressed) {
    progressed = false;
    const pending = sim
      .filter((row) => {
        if (!row.therapist_id || row.status === "cancelled") return false;
        const homeRoomId = home.get(row.therapist_id);
        return homeRoomId != null && homeRoomId !== row.room_id;
      })
      .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "") || String(a.id).localeCompare(String(b.id)));

    for (const row of pending) {
      const toRoomId = home.get(row.therapist_id);
      if (!canPlaceInRoom(sim, row, toRoomId, roomTypeById)) continue;
      const fromRoomId = row.room_id;
      row.room_id = toRoomId;
      safeMoves.push({
        apptId: row.id,
        therapistId: row.therapist_id,
        fromRoomId,
        toRoomId,
      });
      progressed = true;
      any = true;
      break;
    }
  }
  return any;
}

/**
 * Seed roster + greedy safe room moves toward each therapist's home room.
 * Cascade retries after each placement. Mutual deadlocks (A in B's home, B in
 * A's home) become swapPairs — applied by SpaBoard via a parking-room hop so
 * sequential UPDATEs never trip room exclusion mid-swap.
 *
 * @param {object[]} appointments
 * @param {object[]} roster
 * @param {Map|Record} [roomTypeById]
 * @param {number[]} [allRoomIds] spa room ids for parking lookup on swaps
 * @returns {{ rosterUpserts: object[], safeMoves: object[], swapPairs: object[], blockedMoves: object[] }}
 */
export function planAlignDay(appointments, roster, roomTypeById = {}, allRoomIds = []) {
  const list = appointments ?? [];
  const rosterList = roster ?? [];
  const date =
    list.find((a) => a.appointment_date)?.appointment_date ??
    rosterList.find((r) => r.appointment_date)?.appointment_date ??
    null;

  const home = resolveHomeRoomMap(list, rosterList);
  const rosteredTherapistIds = new Set(rosterList.map((r) => r.therapist_id));

  const rosterUpserts = [];
  if (date) {
    home.forEach((roomId, therapistId) => {
      if (!rosteredTherapistIds.has(therapistId)) {
        rosterUpserts.push({ appointment_date: date, room_id: roomId, therapist_id: therapistId });
      }
    });
  }

  const sim = list.map((a) => ({
    id: a.id,
    therapist_id: a.therapist_id,
    room_id: a.room_id,
    start_time: a.start_time,
    end_time: a.end_time,
    status: a.status,
  }));

  const needsHome = (row) => {
    if (!row.therapist_id || row.status === "cancelled") return false;
    const homeRoomId = home.get(row.therapist_id);
    return homeRoomId != null && homeRoomId !== row.room_id;
  };

  const safeMoves = [];
  const swapPairs = [];
  const roomIds =
    allRoomIds.length > 0
      ? allRoomIds
      : [...new Set(sim.map((a) => a.room_id).filter((id) => id != null))];

  let outer = true;
  while (outer) {
    outer = false;
    if (runGreedySafeMoves(sim, home, roomTypeById, safeMoves)) outer = true;

    // Mutual home-room swap with a parking room (so DB can apply 3 sequential UPDATEs).
    const pending = sim.filter(needsHome);
    let swapped = false;
    outerPair: for (let i = 0; i < pending.length; i++) {
      for (let j = i + 1; j < pending.length; j++) {
        const a = pending[i];
        const b = pending[j];
        const aHome = home.get(a.therapist_id);
        const bHome = home.get(b.therapist_id);
        if (aHome == null || bHome == null) continue;
        if (a.room_id !== bHome || b.room_id !== aHome) continue;

        const without = sim.filter((x) => x.id !== a.id && x.id !== b.id);
        const aAtHome = { ...a, room_id: aHome };
        const bAtHome = { ...b, room_id: bHome };
        if (!canPlaceInRoom([...without, bAtHome], aAtHome, aHome, roomTypeById)) continue;
        if (!canPlaceInRoom([...without, aAtHome], bAtHome, bHome, roomTypeById)) continue;

        // Parking must fit A while B still sits in b.room (= aHome). Exclude both homes
        // so we don't park on the destination of either hop.
        const parkingRoomId = findParkingRoomId(sim, a, roomIds, roomTypeById, [aHome, bHome]);
        if (parkingRoomId == null) continue;

        const aFrom = a.room_id;
        const bFrom = b.room_id;
        a.room_id = aHome;
        b.room_id = bHome;
        swapPairs.push({
          a: { apptId: a.id, therapistId: a.therapist_id, fromRoomId: aFrom, toRoomId: aHome },
          b: { apptId: b.id, therapistId: b.therapist_id, fromRoomId: bFrom, toRoomId: bHome },
          parkingRoomId,
        });
        swapped = true;
        outer = true;
        break outerPair;
      }
    }
    if (!swapped && !outer) break;
  }

  const blockedMoves = sim
    .filter(needsHome)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "") || String(a.id).localeCompare(String(b.id)))
    .map((row) => ({
      apptId: row.id,
      therapistId: row.therapist_id,
      fromRoomId: row.room_id,
      toRoomId: home.get(row.therapist_id),
      reason: "room_full",
    }));

  return { rosterUpserts, safeMoves, swapPairs, blockedMoves };
}
