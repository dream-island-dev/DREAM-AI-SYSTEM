// src/utils/spaStickyRoom.js
// Smart Spa Board — therapist sticky-room (migration 193 companion).
// Align: home room = singles only. Couple bookings stay a locked pair in a
// couple room; the therapist walks there for that slot only. Times never change.
export function inferHomeRoomByTherapist(appointments) {
  const sorted = [...(appointments ?? [])]
    .filter((a) => a.therapist_id && a.status !== "cancelled" && a.start_time)
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  const countByTherapistRoom = new Map();
  const firstRoom = new Map();
  for (const a of sorted) {
    if (!firstRoom.has(a.therapist_id)) firstRoom.set(a.therapist_id, a.room_id);
    const key = `${a.therapist_id}:${a.room_id}`;
    countByTherapistRoom.set(key, (countByTherapistRoom.get(key) || 0) + 1);
  }
  const bestCount = new Map();
  const home = new Map();
  for (const [key, n] of countByTherapistRoom) {
    const [tid, rid] = key.split(":");
    const therapistId = Number(tid) || tid;
    const roomId = Number(rid) || rid;
    const prev = bestCount.get(therapistId) || 0;
    if (n > prev) {
      bestCount.set(therapistId, n);
      home.set(therapistId, roomId);
    }
  }
  for (const [tid, room] of firstRoom) {
    if (!home.has(tid)) home.set(tid, room);
  }
  return home;
}

// Merges first-touch inference with an existing roster — roster rows win.
export function resolveHomeRoomMap(appointments, roster) {
  const home = inferHomeRoomByTherapist(appointments);
  (roster ?? []).forEach((r) => home.set(r.therapist_id, r.room_id));
  return home;
}

export function assignExclusiveHomeRooms(appointments, roster, roomTypeById = {}, allRoomIds = []) {
  const preferred = resolveHomeRoomMap(appointments, roster);
  const rostered = new Set((roster ?? []).map((r) => r.therapist_id));
  const slotCount = new Map();
  const roomsUsed = new Map();
  for (const a of appointments ?? []) {
    if (!a.therapist_id || a.status === "cancelled") continue;
    slotCount.set(a.therapist_id, (slotCount.get(a.therapist_id) || 0) + 1);
    if (!roomsUsed.has(a.therapist_id)) roomsUsed.set(a.therapist_id, new Map());
    const used = roomsUsed.get(a.therapist_id);
    used.set(a.room_id, (used.get(a.room_id) || 0) + 1);
  }
  const therapists = [...preferred.keys()].sort((a, b) => {
    const ra = rostered.has(a) ? 1 : 0;
    const rb = rostered.has(b) ? 1 : 0;
    if (rb !== ra) return rb - ra;
    return (slotCount.get(b) || 0) - (slotCount.get(a) || 0);
  });
  const roomPool = [...new Set([
    ...(allRoomIds ?? []),
    ...(appointments ?? []).map((a) => a.room_id).filter((id) => id != null),
  ])];
  const busy = new Set((appointments ?? []).map((a) => a.room_id).filter((id) => id != null));
  const rankedPool = [
    ...roomPool.filter((rid) => !busy.has(rid)),
    ...roomPool.filter((rid) => busy.has(rid)),
  ];
  const load = new Map();
  const home = new Map();
  const lookup = (id) =>
    roomTypeById instanceof Map ? roomTypeById.get(id) : roomTypeById?.[id];
  const canClaim = (roomId) => {
    if (roomId == null) return false;
    return (load.get(roomId) || 0) < roomCapacity(lookup(roomId) ?? "single");
  };
  for (const tid of therapists) {
    const candidates = [];
    const pref = preferred.get(tid);
    if (pref != null) candidates.push(pref);
    const ranked = [...(roomsUsed.get(tid)?.entries() ?? [])]
      .sort((x, y) => y[1] - x[1])
      .map(([rid]) => rid);
    for (const rid of ranked) if (!candidates.includes(rid)) candidates.push(rid);
    for (const rid of rankedPool) if (!candidates.includes(rid)) candidates.push(rid);
    const pick = candidates.find((rid) => canClaim(rid));
    if (pick != null) {
      home.set(tid, pick);
      load.set(pick, (load.get(pick) || 0) + 1);
    } else if (pref != null) {
      home.set(tid, pref);
    }
  }
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

/**
 * Occupancy of a room during `appt`'s time window (excludes that appointment).
 * Used by Move Guest UI to label free vs full options.
 */
export function roomOccupancyAtSlot(simAppts, appt, targetRoomId, roomTypeById) {
  const lookup = (id) =>
    roomTypeById instanceof Map ? roomTypeById.get(id) : roomTypeById?.[id];
  const roomType = lookup(targetRoomId) ?? "single";
  const capacity = roomCapacity(roomType);
  let used = 0;
  for (const a of simAppts ?? []) {
    if (!appt || a.id === appt.id || a.status === "cancelled") continue;
    if (a.room_id !== targetRoomId) continue;
    if (timesOverlap(a.start_time, a.end_time, appt.start_time, appt.end_time)) used += 1;
  }
  const openSlots = Math.max(0, capacity - used);
  return { used, capacity, openSlots, free: openSlots > 0, roomType };
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

function lookupRoomType(roomTypeById, id) {
  return roomTypeById instanceof Map ? roomTypeById.get(id) : roomTypeById?.[id];
}

function collectRoomIds(appointments, allRoomIds) {
  return [...new Set([
    ...(allRoomIds ?? []),
    ...(appointments ?? []).map((a) => a.room_id).filter((id) => id != null),
  ])];
}

function clockKey(appt) {
  return `${String(appt.start_time || "").slice(0, 5)}|${String(appt.end_time || "").slice(0, 5)}`;
}

/**
 * Couple booking = two overlapping appointments with different therapists
 * in a couple room (EZGO exports one row per attendant). Also reunites a
 * pair that shares the same clock window when at least one side is already
 * in a couple room (after a bad prior align).
 */
export function findCoupleLockGroups(appointments, roomTypeById = {}) {
  const list = (appointments ?? []).filter((a) => a.status !== "cancelled" && a.start_time);
  const groups = [];
  const seen = new Set();

  const byRoom = new Map();
  for (const a of list) {
    if ((lookupRoomType(roomTypeById, a.room_id) ?? "single") !== "couple") continue;
    if (!byRoom.has(a.room_id)) byRoom.set(a.room_id, []);
    byRoom.get(a.room_id).push(a);
  }
  for (const [roomId, rows] of byRoom) {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (!a.therapist_id || !b.therapist_id || a.therapist_id === b.therapist_id) continue;
        if (!timesOverlap(a.start_time, a.end_time, b.start_time, b.end_time)) continue;
        const key = [a.id, b.id].sort().join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        groups.push({ ids: [a.id, b.id], roomId });
      }
    }
  }

  const bySlot = new Map();
  for (const a of list) {
    const k = clockKey(a);
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push(a);
  }
  for (const rows of bySlot.values()) {
    if (rows.length !== 2) continue;
    const [a, b] = rows;
    if (!a.therapist_id || !b.therapist_id || a.therapist_id === b.therapist_id) continue;
    const key = [a.id, b.id].sort().join(":");
    if (seen.has(key)) continue;
    const aCouple = (lookupRoomType(roomTypeById, a.room_id) ?? "single") === "couple";
    const bCouple = (lookupRoomType(roomTypeById, b.room_id) ?? "single") === "couple";
    if (!aCouple && !bCouple) continue;
    seen.add(key);
    groups.push({ ids: [a.id, b.id], roomId: aCouple ? a.room_id : b.room_id });
  }
  return groups;
}

export function coupleLockedAppointmentIds(appointments, roomTypeById = {}) {
  const ids = new Set();
  for (const g of findCoupleLockGroups(appointments, roomTypeById)) {
    g.ids.forEach((id) => ids.add(id));
  }
  return ids;
}

function activeByTherapist(appointments) {
  const byTherapist = new Map();
  for (const a of appointments ?? []) {
    if (!a.therapist_id || a.status === "cancelled" || !a.start_time) continue;
    if (!byTherapist.has(a.therapist_id)) byTherapist.set(a.therapist_id, []);
    byTherapist.get(a.therapist_id).push(a);
  }
  return byTherapist;
}

function therapistsOverlapAt(byTherapist, therapistId, start, end) {
  return (byTherapist.get(therapistId) ?? []).some((a) =>
    timesOverlap(a.start_time, a.end_time, start, end)
  );
}

/** True if `tid` can use `roomId` as all-day home given therapists already pinned there. */
function canShareHomeRoom(partialHome, tid, roomId, byTherapist, roomTypeById) {
  if (roomId == null) return false;
  const cap = roomCapacity(lookupRoomType(roomTypeById, roomId) ?? "single");
  for (const appt of byTherapist.get(tid) ?? []) {
    let used = 1;
    for (const [otherId, otherRoom] of partialHome) {
      if (otherRoom !== roomId) continue;
      if (therapistsOverlapAt(byTherapist, otherId, appt.start_time, appt.end_time)) {
        used += 1;
        if (used > cap) return false;
      }
    }
  }
  return true;
}

function rankRoomsForTherapist(tid, partialHome, byTherapist, roomIds, roomTypeById, rosterHome) {
  const usedCounts = new Map();
  for (const a of byTherapist.get(tid) ?? []) {
    if (a.room_id == null) continue;
    usedCounts.set(a.room_id, (usedCounts.get(a.room_id) || 0) + 1);
  }
  const usedRanked = [...usedCounts.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
  const couplePartners = [];
  for (const [otherId, otherRoom] of partialHome) {
    if ((lookupRoomType(roomTypeById, otherRoom) ?? "single") !== "couple") continue;
    const shares = (byTherapist.get(tid) ?? []).some((a) =>
      therapistsOverlapAt(byTherapist, otherId, a.start_time, a.end_time)
    );
    if (shares) couplePartners.push(otherRoom);
  }
  const ordered = [];
  const push = (id) => {
    if (id == null || !roomIds.includes(id) || ordered.includes(id)) return;
    ordered.push(id);
  };
  push(rosterHome.get(tid));
  usedRanked.forEach(push);
  couplePartners.forEach(push);
  for (const rid of roomIds) {
    if ((lookupRoomType(roomTypeById, rid) ?? "single") === "couple") push(rid);
  }
  roomIds.forEach(push);
  return ordered;
}

function greedyFillHomes(pinned, therapists, byTherapist, roomIds, roomTypeById, rosterHome) {
  const home = new Map(pinned);
  for (const tid of therapists) {
    if (home.has(tid)) continue;
    const ranked = rankRoomsForTherapist(tid, home, byTherapist, roomIds, roomTypeById, rosterHome);
    const legal = ranked.find((rid) => canShareHomeRoom(home, tid, rid, byTherapist, roomTypeById));
    const pick = legal ?? ranked[0];
    if (pick != null) home.set(tid, pick);
  }
  return home;
}

function scoreHomeBetter(a, b) {
  if (!b) return true;
  if (a.blocked !== b.blocked) return a.blocked < b.blocked;
  if (a.scatter !== b.scatter) return a.scatter < b.scatter;
  if (a.moves !== b.moves) return a.moves < b.moves;
  if (a.rosterHits !== b.rosterHits) return a.rosterHits > b.rosterHits;
  return false;
}

function countSingleScatter(appointments, roomByApptId, locked) {
  const rooms = new Map();
  for (const a of appointments ?? []) {
    if (!a.therapist_id || a.status === "cancelled") continue;
    if (locked.has(a.id)) continue;
    if (!rooms.has(a.therapist_id)) rooms.set(a.therapist_id, new Set());
    const rid = roomByApptId.get(a.id) ?? a.room_id;
    if (rid != null) rooms.get(a.therapist_id).add(rid);
  }
  let scatter = 0;
  for (const set of rooms.values()) scatter += Math.max(0, set.size - 1);
  return scatter;
}

function roomByIdAfterPlan(appointments, plan) {
  const roomById = new Map((appointments ?? []).map((a) => [a.id, a.room_id]));
  for (const m of plan.safeMoves ?? []) roomById.set(m.apptId, m.toRoomId);
  for (const pair of plan.swapPairs ?? []) {
    roomById.set(pair.a.apptId, pair.a.toRoomId);
    roomById.set(pair.b.apptId, pair.b.toRoomId);
  }
  return roomById;
}

function scoreHomeAssignment(appointments, home, rosterHome, roomTypeById, roomIds) {
  const locked = coupleLockedAppointmentIds(appointments, roomTypeById);
  const plan = planMovesTowardHome(appointments, home, roomTypeById, roomIds);
  let moves = plan.safeMoves.length;
  for (const pair of plan.swapPairs) {
    void pair;
    moves += 2;
  }
  let rosterHits = 0;
  home.forEach((rid, tid) => {
    if (rosterHome.get(tid) === rid) rosterHits += 1;
  });
  return {
    blocked: plan.blockedMoves.length,
    scatter: countSingleScatter(appointments, roomByIdAfterPlan(appointments, plan), locked),
    moves,
    rosterHits,
    home: new Map(home),
  };
}

/**
 * Home rooms for single treatments only. Couple pairs stay locked in a couple
 * room (walk exception). Roster is a preference, not a lock.
 */
export function optimizeTherapistHomeRooms(appointments, roster, roomTypeById = {}, allRoomIds = []) {
  const locked = coupleLockedAppointmentIds(appointments, roomTypeById);
  const singleAppts = (appointments ?? []).filter(
    (a) => a.therapist_id && a.status !== "cancelled" && !locked.has(a.id)
  );
  const byTherapist = activeByTherapist(singleAppts);
  const therapists = [...byTherapist.keys()].sort(
    (a, b) => (byTherapist.get(b)?.length || 0) - (byTherapist.get(a)?.length || 0)
  );
  const roomIds = collectRoomIds(appointments, allRoomIds);
  const singleRoomIds = roomIds.filter((rid) => (lookupRoomType(roomTypeById, rid) ?? "single") === "single");
  const homePool = singleRoomIds.length > 0 ? singleRoomIds : roomIds;
  const rosterHome = new Map();
  for (const r of roster ?? []) {
    if (homePool.includes(r.room_id)) rosterHome.set(r.therapist_id, r.room_id);
  }
  if (therapists.length === 0 || homePool.length === 0) return new Map();

  const seeds = [];
  const pushSeed = (home) => {
    if (!home || home.size === 0) return;
    seeds.push(home);
  };
  pushSeed(greedyFillHomes(new Map(), therapists, byTherapist, homePool, roomTypeById, rosterHome));
  if (rosterHome.size > 0) {
    pushSeed(greedyFillHomes(rosterHome, therapists, byTherapist, homePool, roomTypeById, rosterHome));
  }
  pushSeed(assignExclusiveHomeRooms(singleAppts, [], roomTypeById, homePool));
  pushSeed(assignExclusiveHomeRooms(singleAppts, roster, roomTypeById, homePool));
  for (const tid of therapists) {
    const used = new Set((byTherapist.get(tid) ?? []).map((a) => a.room_id).filter((id) => homePool.includes(id)));
    for (const rid of used) {
      pushSeed(greedyFillHomes(new Map([[tid, rid]]), therapists, byTherapist, homePool, roomTypeById, rosterHome));
    }
  }

  let best = null;
  for (const seed of seeds) {
    const scored = scoreHomeAssignment(appointments, seed, rosterHome, roomTypeById, roomIds);
    if (scoreHomeBetter(scored, best)) best = scored;
  }

  const relocateRounds = 5;
  for (let round = 0; round < relocateRounds; round += 1) {
    if (!best) break;
    let improved = false;
    const base = best.home;
    for (const tid of therapists) {
      for (const rid of homePool) {
        if (base.get(tid) === rid) continue;
        const trial = new Map(base);
        trial.set(tid, rid);
        const scored = scoreHomeAssignment(appointments, trial, rosterHome, roomTypeById, roomIds);
        if (scoreHomeBetter(scored, best)) {
          best = scored;
          improved = true;
        }
      }
    }
    for (let i = 0; i < therapists.length; i += 1) {
      for (let j = i + 1; j < therapists.length; j += 1) {
        const a = therapists[i];
        const b = therapists[j];
        const trial = new Map(base);
        const ra = trial.get(a);
        const rb = trial.get(b);
        if (ra == null || rb == null || ra === rb) continue;
        trial.set(a, rb);
        trial.set(b, ra);
        const scored = scoreHomeAssignment(appointments, trial, rosterHome, roomTypeById, roomIds);
        if (scoreHomeBetter(scored, best)) {
          best = scored;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return best?.home ?? new Map();
}

function runGreedySafeMoves(sim, home, roomTypeById, safeMoves, lockedIds) {
  let progressed = true;
  let any = false;
  while (progressed) {
    progressed = false;
    const pending = sim
      .filter((row) => {
        if (!row.therapist_id || row.status === "cancelled") return false;
        if (lockedIds.has(row.id)) return false;
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

function planMovesTowardHome(appointments, home, roomTypeById, allRoomIds = []) {
  const list = appointments ?? [];
  const lockedIds = coupleLockedAppointmentIds(list, roomTypeById);
  const lockGroups = findCoupleLockGroups(list, roomTypeById);
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
    if (lockedIds.has(row.id)) return false;
    const homeRoomId = home.get(row.therapist_id);
    return homeRoomId != null && homeRoomId !== row.room_id;
  };

  const safeMoves = [];
  const swapPairs = [];
  const roomIds =
    allRoomIds.length > 0
      ? allRoomIds
      : [...new Set(sim.map((a) => a.room_id).filter((id) => id != null))];

  for (const g of lockGroups) {
    for (const apptId of g.ids) {
      const row = sim.find((x) => x.id === apptId);
      if (!row || row.room_id === g.roomId) continue;
      if (!canPlaceInRoom(sim, row, g.roomId, roomTypeById)) continue;
      const fromRoomId = row.room_id;
      row.room_id = g.roomId;
      safeMoves.push({
        apptId: row.id,
        therapistId: row.therapist_id,
        fromRoomId,
        toRoomId: g.roomId,
      });
    }
  }

  let outer = true;
  while (outer) {
    outer = false;
    if (runGreedySafeMoves(sim, home, roomTypeById, safeMoves, lockedIds)) outer = true;

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

  const blockedHome = sim
    .filter(needsHome)
    .map((row) => ({
      apptId: row.id,
      therapistId: row.therapist_id,
      fromRoomId: row.room_id,
      toRoomId: home.get(row.therapist_id),
      reason: "room_full",
    }));

  const blockedCouple = [];
  for (const g of lockGroups) {
    for (const apptId of g.ids) {
      const row = sim.find((x) => x.id === apptId);
      if (!row || row.room_id === g.roomId) continue;
      blockedCouple.push({
        apptId: row.id,
        therapistId: row.therapist_id,
        fromRoomId: row.room_id,
        toRoomId: g.roomId,
        reason: "couple_split",
      });
    }
  }

  const blockedMoves = [...blockedHome, ...blockedCouple].sort(
    (a, b) => String(a.apptId).localeCompare(String(b.apptId))
  );

  return { safeMoves, swapPairs, blockedMoves };
}

/**
 * Home for singles, then move those guests (never times). Couple pairs stay
 * together in a couple room. Parking swaps keep sequential DB updates legal.
 */
export function planAlignDay(appointments, roster, roomTypeById = {}, allRoomIds = []) {
  const list = appointments ?? [];
  const rosterList = roster ?? [];
  const date =
    list.find((a) => a.appointment_date)?.appointment_date ??
    rosterList.find((r) => r.appointment_date)?.appointment_date ??
    null;

  const roomIds = collectRoomIds(list, allRoomIds);
  const home = optimizeTherapistHomeRooms(list, rosterList, roomTypeById, roomIds);
  const { safeMoves, swapPairs, blockedMoves } = planMovesTowardHome(list, home, roomTypeById, roomIds);

  const rosterUpserts = [];
  if (date) {
    home.forEach((roomId, therapistId) => {
      rosterUpserts.push({ appointment_date: date, room_id: roomId, therapist_id: therapistId });
    });
  }

  return { rosterUpserts, safeMoves, swapPairs, blockedMoves };
}
