// Multi-room suite context — Inbox picker + Ops Board disambiguation.
// Selected room persists in guests.guest_profile.inbox.selected_suite_room.

import { resolveSuiteFromEzgoFields } from "../data/suiteRegistry";

export function suiteRoomCanonicalLabel(row) {
  if (!row) return "";
  const resolved = resolveSuiteFromEzgoFields(row.room_name, row.suite_type, row.is_day_guest);
  return (resolved || row.room_display || row.suite_type || row.room_name || "").trim();
}

export function isAmbiguousCombinedRoom(roomLabel) {
  return String(roomLabel ?? "").includes(" · ");
}

export function taskNeedsRoomDisambiguation(task, suiteRoomLabels) {
  if (!task?.guest_id || (suiteRoomLabels?.length ?? 0) < 2) return false;
  const rn = String(task.room_number ?? "").trim();
  if (!rn || rn.startsWith("TBD") || isAmbiguousCombinedRoom(rn)) return true;
  const matches = suiteRoomLabels.filter(
    (label) => label === rn || label.endsWith(` ${rn}`) || rn.endsWith(label),
  );
  return matches.length !== 1;
}

export function readSelectedSuiteRoomFromProfile(guestProfile) {
  const p = guestProfile && typeof guestProfile === "object" ? guestProfile : {};
  const inbox = p.inbox && typeof p.inbox === "object" ? p.inbox : {};
  const v = String(inbox.selected_suite_room ?? "").trim();
  return v || null;
}

export function mergeGuestProfileSelectedRoom(existingProfile, roomLabel) {
  const base = existingProfile && typeof existingProfile === "object" ? { ...existingProfile } : {};
  const inbox = base.inbox && typeof base.inbox === "object" ? { ...base.inbox } : {};
  if (roomLabel) inbox.selected_suite_room = roomLabel;
  else delete inbox.selected_suite_room;
  if (Object.keys(inbox).length) base.inbox = inbox;
  else delete base.inbox;
  return base;
}

export function selectedSuiteRoomSessionKey(guestId, phone) {
  return `xos_inbox_suite_room:${guestId || phone || "unknown"}`;
}

export function readSelectedSuiteRoomSession(guestId, phone) {
  try {
    const raw = sessionStorage.getItem(selectedSuiteRoomSessionKey(guestId, phone));
    return raw ? String(raw).trim() || null : null;
  } catch {
    return null;
  }
}

export function writeSelectedSuiteRoomSession(guestId, phone, roomLabel) {
  try {
    const key = selectedSuiteRoomSessionKey(guestId, phone);
    if (roomLabel) sessionStorage.setItem(key, roomLabel);
    else sessionStorage.removeItem(key);
  } catch {
    /* sessionStorage unavailable */
  }
}

export function resolveEffectiveSelectedSuiteRoom({
  guestProfile,
  guestId,
  phone,
  fallbackRoom,
}) {
  const fromProfile = readSelectedSuiteRoomFromProfile(guestProfile);
  if (fromProfile) return fromProfile;
  const fromSession = readSelectedSuiteRoomSession(guestId, phone);
  if (fromSession) return fromSession;
  const fb = String(fallbackRoom ?? "").trim();
  if (fb && !isAmbiguousCombinedRoom(fb)) return fb;
  return null;
}
