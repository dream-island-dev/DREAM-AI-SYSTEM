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

// Seed/upsert plan + per-appointment moves needed to align a day to home rooms.
// Never touches EZGO line ids and never proposes cancelling anything — it only
// describes room_id moves for appointments whose therapist already has a home
// room that differs from the appointment's current room.
export function planAlignDay(appointments, roster) {
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

  const moves = [];
  list.forEach((a) => {
    if (!a.therapist_id || a.status === "cancelled") return;
    const homeRoomId = home.get(a.therapist_id);
    if (homeRoomId != null && homeRoomId !== a.room_id) {
      moves.push({ apptId: a.id, therapistId: a.therapist_id, fromRoomId: a.room_id, toRoomId: homeRoomId });
    }
  });

  return { rosterUpserts, moves };
}
