// src/utils/spaStickyRoom.js
// Smart Spa Board — therapist sticky-room pure logic (migration 193 companion).
// Align Day: one home room per therapist (global search). Couple rooms may
// host two therapists together. Guest times never change — only room_id.
// Roster is a preference, not a lock. No Supabase here — SpaBoard.js applies.
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
  if (a.moves !== b.moves) return a.moves < b.moves;
  if (a.alreadyHome !== b.alreadyHome) return a.alreadyHome > b.alreadyHome;
  if (a.rosterHits !== b.rosterHits) return a.rosterHits > b.rosterHits;
  return false;
}

function countAlreadyHome(appointments, home) {
  let n = 0;
  for (const a of appointments ?? []) {
    if (!a.therapist_id || a.status === "cancelled") continue;
    if (home.get(a.therapist_id) === a.room_id) n += 1;
  }
  return n;
}

function scoreHomeAssignment(appointments, home, rosterHome, roomTypeById, roomIds) {
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
    moves,
    alreadyHome: countAlreadyHome(appointments, home),
    rosterHits,
    home: new Map(home),
  };
}

/**
 * Search therapist → one home room for the whole day (times never change).
 * Couple rooms may host two overlapping therapists; singles may not.
 * Roster is a preference (tried first), not a lock — leftover EZGO scatter
 * must not freeze a bad home.
 */
export function optimizeTherapistHomeRooms(appointments, roster, roomTypeById = {}, allRoomIds = []) {
  const byTherapist = activeByTherapist(appointments);
  const therapists = [...byTherapist.keys()].sort(
    (a, b) => (byTherapist.get(b)?.length || 0) - (byTherapist.get(a)?.length || 0)
  );
  const roomIds = collectRoomIds(appointments, allRoomIds);
  const rosterHome = new Map((roster ?? []).map((r) => [r.therapist_id, r.room_id]));
  if (therapists.length === 0 || roomIds.length === 0) return new Map();

  const seeds = [];
  const pushSeed = (home) => {
    if (!home || home.size === 0) return;
    seeds.push(home);
  };
  pushSeed(greedyFillHomes(new Map(), therapists, byTherapist, roomIds, roomTypeById, rosterHome));
  if (rosterHome.size > 0) {
    pushSeed(greedyFillHomes(rosterHome, therapists, byTherapist, roomIds, roomTypeById, rosterHome));
  }
  pushSeed(assignExclusiveHomeRooms(appointments, [], roomTypeById, roomIds));
  pushSeed(assignExclusiveHomeRooms(appointments, roster, roomTypeById, roomIds));
  for (const tid of therapists) {
    const used = new Set((byTherapist.get(tid) ?? []).map((a) => a.room_id).filter((id) => id != null));
    for (const rid of used) {
      pushSeed(greedyFillHomes(new Map([[tid, rid]]), therapists, byTherapist, roomIds, roomTypeById, rosterHome));
    }
  }

  const coupleRooms = roomIds.filter((rid) => (lookupRoomType(roomTypeById, rid) ?? "single") === "couple");
  const overlapPairs = [];
  for (let i = 0; i < therapists.length; i += 1) {
    for (let j = i + 1; j < therapists.length; j += 1) {
      const a = therapists[i];
      const b = therapists[j];
      const overlaps = (byTherapist.get(a) ?? []).some((appt) =>
        therapistsOverlapAt(byTherapist, b, appt.start_time, appt.end_time)
      );
      if (overlaps) overlapPairs.push([a, b]);
    }
  }
  for (const cr of coupleRooms) {
    for (const [a, b] of overlapPairs) {
      const pinned = new Map([
        [a, cr],
        [b, cr],
      ]);
      if (!canShareHomeRoom(new Map([[a, cr]]), b, cr, byTherapist, roomTypeById)) continue;
      pushSeed(greedyFillHomes(pinned, therapists, byTherapist, roomIds, roomTypeById, rosterHome));
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
      for (const rid of roomIds) {
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

function planMovesTowardHome(appointments, home, roomTypeById, allRoomIds = []) {
  const list = appointments ?? [];
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

  return { safeMoves, swapPairs, blockedMoves };
}

/**
 * Pick one home room per therapist (global search), then move guests — never
 * times — into that room. Couple rooms may keep two therapists together.
 * Cascade + parking swaps so sequential DB updates stay legal. Blocked leftovers
 * never hit the DB — FAIL VISIBLE list for manual «העבר אורח».
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
