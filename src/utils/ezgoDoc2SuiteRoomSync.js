// Mirror of supabase/functions/_shared/ezgoDoc2SuiteRoomSync.ts (frontend).

import { roomsCanonicallyMatch, resolveSuiteFromEzgoFields } from "../data/suiteRegistry";
import { buildCombinedRoomLabel, splitCombinedRoomLabel } from "./guestImportIntelligence";
import { isCanonicalSuiteRoom } from "./pipelineSegment";
import {
  addDepartureFromNights,
  isSuiteStayGuest,
  resolveMissingDepartureAlert,
} from "./departureDateGuard";
import {
  assertGuestSegmentConsistent,
  assertNoConflictingSuiteProfile,
  assertNoDuplicateGuest,
  normalizeGuestPhoneForLookup,
  phoneLookupVariants,
} from "./guestSegmentGuard";
import { buildDoc2RemarkGuestNotes } from "./ezgoDoc2RemarkIdentity";
import { runGuestImportPipelineHooks } from "./guestImportPipelineHooks";

const DOC2_MAIL_LINE_PREFIX = "doc2mail-";

function adultsFromDoc2GuestCount(raw, fallback = 2) {
  const n = parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nightsForSuiteRoomRow(rec, arrival) {
  const parsed = parseInt(String(rec.nights ?? ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  if (rec.departure_date && arrival && rec.departure_date > arrival) {
    const ms = new Date(`${rec.departure_date}T12:00:00`).getTime()
      - new Date(`${arrival}T12:00:00`).getTime();
    const days = Math.round(ms / 86400000);
    if (days > 0) return days;
  }
  return 0;
}

function resolveSuiteRoomFromEzgoLabel(raw) {
  return resolveSuiteFromEzgoFields(raw, raw, false) || String(raw ?? "").trim();
}

export function doc2MailResLineId(orderNumber, room) {
  const order = String(orderNumber ?? "").trim() || "unknown";
  const canon = resolveSuiteRoomFromEzgoLabel(room) || String(room ?? "").trim();
  const slug = canon
    .replace(/['‘’׳]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${DOC2_MAIL_LINE_PREFIX}${order}-${slug || "room"}`;
}

export { splitCombinedRoomLabel, buildCombinedRoomLabel };

export function guestRoomLabelsInclude(guestRoom, incomingRoom) {
  const labels = splitCombinedRoomLabel(guestRoom || "");
  if (!labels.length && guestRoom) labels.push(String(guestRoom).trim());
  return labels.some((label) => roomsCanonicallyMatch(label, incomingRoom));
}

// Restrictiveness rank, mirrors public.merge_automation_scope (migration 154) /
// _shared/importAutomationScope.ts. Applied client-side because this file writes
// directly via the Supabase JS client, not through the sync_suite_arrivals RPC.
// Never lets an enrichment write loosen an already-muted guest back toward full.
function mergeAutomationScope(existing, incoming) {
  const rank = (s) => (s === "muted" ? 2 : s === "courtesy_only" ? 1 : 0);
  const r = Math.max(rank(existing), rank(incoming));
  return r === 2 ? "muted" : r === 1 ? "courtesy_only" : "full";
}

const CORPORATE_MUTE_NAME_RE = /עיריית|עיירית|עירייה|עיריה|מחלקת מכירות|בנק לאומי/;

export function normalizeDoc2PersonName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\.\s+/g, ".")
    .toLowerCase();
}

export function doc2PhonesMatch(a, b) {
  const na = normalizeGuestPhoneForLookup(a);
  const nb = normalizeGuestPhoneForLookup(b);
  if (!na || !nb) return false;
  return na.replace(/^\+/, "") === nb.replace(/^\+/, "");
}

export function doc2NamesMatch(a, b) {
  if (!a || !b) return false;
  return normalizeDoc2PersonName(a) === normalizeDoc2PersonName(b);
}

/** Same human (normalized name+phone) — not a different group occupant. */
export function isDoc2SamePerson(rec, guest) {
  return doc2PhonesMatch(rec?.phone, guest?.phone) && doc2NamesMatch(rec?.guest_name, guest?.name);
}

function isCorporateMuteCoordName(name) {
  return CORPORATE_MUTE_NAME_RE.test(String(name ?? ""));
}

/** Individual stay → full pipeline. Distinct group occupant keeps courtesy/mute. */
export function doc2CreateAutomationScope(rec) {
  const distinctOccupant = rec?.is_remark_group_occupant
    && rec.coord_name
    && rec.guest_name
    && !doc2NamesMatch(rec.guest_name, rec.coord_name);
  if (distinctOccupant) return rec.automation_scope || "courtesy_only";
  if (isCorporateMuteCoordName(rec?.guest_name) || isCorporateMuteCoordName(rec?.coord_name)) {
    return rec.automation_scope || "muted";
  }
  return "full";
}

export function isSameDoc2Booking(rec, guest) {
  // Group/municipal rows share an order_number but each remark row is a
  // distinct occupant — never merge rooms onto one profile unless phone AND
  // resolved guest name both match (prevents 12-room איליה-style blobs).
  if (rec.is_remark_group_occupant) {
    if (!doc2PhonesMatch(rec.phone, guest.phone)) return false;
    return doc2NamesMatch(rec.guest_name, guest.name);
  }

  // An explicit order-number mismatch is authoritative — never fall through to
  // the softer phone/date heuristic below (would silently merge two different
  // bookings). Same order_number is NOT sufficient on its own either — group/
  // municipal bookings share one order_number across genuinely different
  // occupants; an explicit phone mismatch when both are known must still block
  // the merge (Mike, P0 2026-08-05: never merge via order_number when phones differ).
  if (rec.order_number && guest.order_number) {
    if (rec.order_number !== guest.order_number) return false;
    if (rec.phone && guest.phone && !doc2PhonesMatch(rec.phone, guest.phone)) return false;
    return true;
  }
  const recDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  const guestDate = guest.arrival_date ? String(guest.arrival_date).slice(0, 10) : null;
  if (!recDate || !guestDate || recDate !== guestDate) return false;
  if (rec.phone && guest.phone && doc2PhonesMatch(rec.phone, guest.phone)) return true;
  if (rec.guest_name && guest.name) {
    return rec.guest_name.trim() === String(guest.name).trim();
  }
  return false;
}

/** Whether an incoming Doc2 row should add a room to an existing guest (not group pile-on). */
export function shouldMergeDoc2RowOntoGuest(rec, guest) {
  if (!isSameDoc2Booking(rec, guest)) return false;
  if (rec.is_remark_group_occupant && !isDoc2SamePerson(rec, guest)) {
    return !!rec.room && guestRoomLabelsInclude(guest.room, rec.room);
  }
  return true;
}

function pickEnrichValue(importVal, existingVal) {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (existingVal === undefined || existingVal === null || existingVal === "") return importVal;
  return undefined;
}

// Mirrors _shared/ezgoDoc2SuiteRoomSync.ts's isSuspectSuiteStayDates — 0-night bug signature.
function isSuspectSuiteStayDates(guest) {
  if (!isSuiteStayGuest({ room_type: guest.room_type, room: guest.room })) return false;
  if (!guest.departure_date) return true;
  return !!guest.arrival_date && guest.arrival_date === guest.departure_date;
}

function pickDoc2SnapshotValue(importVal, existingVal, { allowOverwrite }) {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (allowOverwrite) return importVal;
  return pickEnrichValue(importVal, existingVal);
}

export function buildDoc2GuestEnrichPatch(rec, guest) {
  const patch = {};
  if (rec.order_number) {
    const picked = pickEnrichValue(rec.order_number, guest.order_number);
    if (picked !== undefined) patch.order_number = picked;
  }
  if (rec.arrival_date) {
    const allowArrivalOverwrite = isSuiteStayGuest(guest)
      && isSameDoc2Booking(rec, guest)
      && rec.arrival_date !== guest.arrival_date;
    const picked = pickDoc2SnapshotValue(rec.arrival_date, guest.arrival_date, {
      allowOverwrite: allowArrivalOverwrite,
    });
    if (picked !== undefined) patch.arrival_date = picked;
  }
  if (rec.departure_date) {
    const arrival = String(rec.arrival_date || guest.arrival_date || "").slice(0, 10);
    const allowOverwrite = (!arrival || rec.departure_date > arrival) && (
      isSuspectSuiteStayDates(guest)
      || (
        isSuiteStayGuest(guest)
        && isSameDoc2Booking(rec, guest)
        && rec.departure_date !== guest.departure_date
      )
    );
    const picked = pickDoc2SnapshotValue(rec.departure_date, guest.departure_date, { allowOverwrite });
    if (picked !== undefined) patch.departure_date = picked;
  }
  const suiteRoom = rec.room || guest.room;
  if (
    isCanonicalSuiteRoom(suiteRoom)
    && (guest.room_type === "day_guest" || guest.room_type === "premium_day_guest")
  ) {
    patch.room_type = "suite";
  }
  if (rec.meal_location) {
    const picked = pickEnrichValue(rec.meal_location, guest.meal_location);
    if (picked !== undefined) patch.meal_location = picked;
  }
  if (rec.guest_name) {
    const picked = pickEnrichValue(rec.guest_name, guest.name);
    if (picked !== undefined) patch.name = picked;
  }
  if (rec.meal_time) {
    const picked = pickEnrichValue(rec.meal_time, guest.meal_time);
    if (picked !== undefined) patch.meal_time = picked;
  }
  if (rec.automation_scope && !isDoc2SamePerson(rec, guest)) {
    const merged = mergeAutomationScope(guest.automation_scope, rec.automation_scope);
    if (merged !== (guest.automation_scope || "full")) {
      patch.automation_scope = merged;
      patch.automation_muted = merged === "muted";
    }
  }
  return patch;
}

export async function findGuestForDoc2SuiteCreate(supabase, rec, reportDateYmd) {
  const arrival = rec.arrival_date || reportDateYmd;
  if (!arrival) return null;

  const select =
    "id, name, phone, order_number, arrival_date, departure_date, room, room_type, meal_location, meal_time, automation_scope";

  if (rec.order_number) {
    const { data } = await supabase
      .from("guests")
      .select(select)
      .eq("order_number", rec.order_number)
      .eq("arrival_date", arrival)
      .neq("status", "cancelled")
      .limit(3);
    if (data?.length === 1) {
      const only = data[0];
      if (rec.is_remark_group_occupant) {
        return shouldMergeDoc2RowOntoGuest(rec, only) ? only : null;
      }
      return only;
    }
    if (data?.length > 1) {
      if (rec.is_remark_group_occupant) {
        const hit = data.find((g) => shouldMergeDoc2RowOntoGuest(rec, g));
        return hit ?? null;
      }
      if (rec.phone) {
        const hit = data.find((g) => doc2PhonesMatch(g.phone, rec.phone));
        if (hit) return hit;
      }
    }
  }

  if (rec.phone) {
    const variants = phoneLookupVariants(rec.phone);
    let q = supabase
      .from("guests")
      .select(select)
      .eq("arrival_date", arrival)
      .neq("status", "cancelled")
      .limit(2);
    q = variants.length ? q.in("phone", variants) : q.eq("phone", rec.phone);
    const { data } = await q;
    if (data?.length === 1) {
      const only = data[0];
      if (rec.is_remark_group_occupant) {
        return shouldMergeDoc2RowOntoGuest(rec, only) ? only : null;
      }
      return only;
    }
  }

  return null;
}

async function fetchSuiteRoomLabels(supabase, guestId) {
  const { data } = await supabase
    .from("suite_rooms")
    .select("room_display, room_name")
    .eq("guest_id", guestId)
    .order("res_line_id", { ascending: true });
  const labels = [];
  for (const row of data ?? []) {
    const raw = String(row.room_display || row.room_name || "").trim();
    if (!raw) continue;
    // Defensive re-canonicalization (P0 2026-08-05): rows written before the
    // suite-first label fix may still hold a raw "X - בילוי יומי" string —
    // re-resolving recovers the real suite number where possible instead of
    // permanently baking the stale label into guests.room.
    labels.push(resolveSuiteRoomFromEzgoLabel(raw));
  }
  return labels;
}

export async function ensureGuestRoomsSeededToSuiteRooms(supabase, {
  guestId,
  rec,
  reportDateYmd,
  guestRoom,
}) {
  const existingLabels = await fetchSuiteRoomLabels(supabase, guestId);
  if (existingLabels.length) return;

  const seedLabels = splitCombinedRoomLabel(guestRoom || "");
  if (!seedLabels.length) return;

  for (const label of seedLabels) {
    await upsertDoc2SuiteRoomForGuest(supabase, {
      guestId,
      rec: { ...rec, room: label },
      reportDateYmd,
    });
  }
}

export async function upsertDoc2SuiteRoomForGuest(supabase, { guestId, rec, reportDateYmd }) {
  const room = rec.room ? String(rec.room).trim() : "";
  if (!room) return { added: false, roomLabel: null };

  // Hermetic guard (P0 2026-08-05): this file only ever writes suite_rooms for
  // suite bookings — a day-pass/Premium Day label reaching here is always a
  // stale/mis-parsed rec, not a legitimate call. Skip instead of creating a
  // phantom "בילוי יומי" chip on a suite guest's room list. Mirrors
  // _shared/ezgoDoc2SuiteRoomSync.ts.
  if (!isCanonicalSuiteRoom(room)) {
    console.warn(`[ezgoDoc2SuiteRoomSync] skipped non-canonical room "${room}" for guest ${guestId}`);
    return { added: false, roomLabel: null, skippedReason: "non_canonical_room" };
  }

  const arrival = rec.arrival_date || reportDateYmd;
  const orderNumber = String(rec.order_number ?? "").trim()
    || `${DOC2_MAIL_LINE_PREFIX}${guestId}`;
  const resLineId = doc2MailResLineId(rec.order_number, room);

  // Dedupe by (guest_id, canonical room) FIRST — two insert paths for the same
  // guest+room (e.g. a doc2mail-<id> fallback order_number from seeding vs a
  // real order_number from a later reparse) must update the same row, not
  // create a second chip.
  // .limit(1) not .maybeSingle(): pre-existing duplicate rows for this exact
  // guest_id+room (the very data shape this dedupe is meant to clean up) would
  // make .maybeSingle() throw "multiple rows returned" instead of just picking
  // one to consolidate onto (P1 QA fix, 2026-08-05).
  const { data: existingByRoomRows } = await supabase
    .from("suite_rooms")
    .select("id")
    .eq("guest_id", guestId)
    .eq("room_display", room)
    .limit(1);
  const existingByRoom = existingByRoomRows?.[0] ?? null;

  const { data: existingByLine } = existingByRoom
    ? { data: null }
    : await supabase
      .from("suite_rooms")
      .select("id, room_display, room_name")
      .eq("order_number", orderNumber)
      .eq("res_line_id", resLineId)
      .maybeSingle();

  const existing = existingByRoom || existingByLine;

  const rowPatch = {
    guest_id: guestId,
    guest_phone: rec.phone || null,
    guest_name: rec.guest_name || null,
    order_number: orderNumber,
    arrival_date: arrival || null,
    room_display: room,
    room_name: room,
    is_day_guest: false,
    adults: adultsFromDoc2GuestCount(rec.guest_count),
    nights: nightsForSuiteRoomRow(rec, arrival),
  };

  if (existing) {
    await supabase.from("suite_rooms").update(rowPatch).eq("id", existing.id);
    return { added: false, roomLabel: room };
  }

  const { error: insErr } = await supabase.from("suite_rooms").insert({
    ...rowPatch,
    res_line_id: resLineId,
    nights: nightsForSuiteRoomRow(rec, arrival),
  });

  if (insErr?.code === "23505") {
    // Unique-constraint race — another concurrent call already created the
    // row for this guest+room; update it in place rather than failing.
    await supabase
      .from("suite_rooms")
      .update(rowPatch)
      .eq("guest_id", guestId)
      .eq("room_display", room);
    return { added: false, roomLabel: room };
  }
  if (insErr) throw insErr;

  return { added: true, roomLabel: room };
}

export async function reconcileDoc2GuestRoomsToReport(supabase, guestId, reportRooms) {
  const wanted = [...new Set((reportRooms || []).map((r) => String(r || "").trim()).filter(isCanonicalSuiteRoom))];
  if (!wanted.length) return;
  const current = await fetchSuiteRoomLabels(supabase, guestId);
  for (const label of current) {
    if (!isCanonicalSuiteRoom(label)) continue;
    if (wanted.includes(label)) continue;
    await supabase.from("suite_rooms").delete().eq("guest_id", guestId).eq("room_display", label);
  }
  await recomputeGuestCombinedRoom(supabase, guestId, wanted[0]);
}

export async function recomputeGuestCombinedRoom(supabase, guestId, fallbackRoom) {
  let labels = await fetchSuiteRoomLabels(supabase, guestId);
  if (!labels.length && fallbackRoom) labels = [fallbackRoom];
  const combined = buildCombinedRoomLabel(labels);
  if (!combined) return null;

  const { data: guest } = await supabase
    .from("guests")
    .select("room")
    .eq("id", guestId)
    .maybeSingle();

  if (guest?.room === combined) return combined;

  await supabase.from("guests").update({ room: combined }).eq("id", guestId);
  return combined;
}

export async function applyDoc2SuiteRoomAdd(supabase, { guestId, rec, reportDateYmd }) {
  const { data: guest, error: gErr } = await supabase
    .from("guests")
    .select("id, name, phone, order_number, arrival_date, departure_date, room, room_type, meal_location, meal_time, automation_scope")
    .eq("id", guestId)
    .maybeSingle();
  if (gErr || !guest) throw gErr || new Error("אורח לא נמצא");

  await ensureGuestRoomsSeededToSuiteRooms(supabase, {
    guestId,
    rec,
    reportDateYmd,
    guestRoom: guest.room,
  });

  await upsertDoc2SuiteRoomForGuest(supabase, { guestId, rec, reportDateYmd });
  const combined = await recomputeGuestCombinedRoom(supabase, guestId, rec.room);

  const enrichPatch = buildDoc2GuestEnrichPatch(rec, guest);
  if (isDoc2SamePerson(rec, guest) && doc2CreateAutomationScope(rec) === "full") {
    if ((guest.automation_scope || "full") !== "full") {
      enrichPatch.automation_scope = "full";
      enrichPatch.automation_muted = false;
    }
  }
  if (Object.keys(enrichPatch).length) {
    await supabase.from("guests").update(enrichPatch).eq("id", guestId);
    if (enrichPatch.departure_date) {
      await resolveMissingDepartureAlert(supabase, guestId);
    }
  }

  if (guest.phone) {
    const arrival = rec.arrival_date || reportDateYmd;
    const labels = splitCombinedRoomLabel(combined || guest.room || "");
    await supabase.from("bookings").upsert({
      phone: guest.phone.replace(/^\+/, ""),
      guest_name: rec.guest_name || guest.name || null,
      arrival_date: arrival,
      status: "expected",
      room_count: Math.max(labels.length, 1),
    }, { onConflict: "phone,arrival_date" });
  }

  await runGuestImportPipelineHooks(supabase, guestId);

  return {
    id: guestId,
    name: enrichPatch.name || guest.name,
    phone: guest.phone,
    room: combined || guest.room,
  };
}

export async function createDoc2SuiteArrival(supabase, rec, reportDateYmd) {
  const existing = await findGuestForDoc2SuiteCreate(supabase, rec, reportDateYmd);
  if (existing && shouldMergeDoc2RowOntoGuest(rec, existing)) {
    const result = await applyDoc2SuiteRoomAdd(supabase, {
      guestId: existing.id,
      rec,
      reportDateYmd,
    });
    return { id: result.id, name: result.name, phone: result.phone };
  }

  const arrival = rec.arrival_date || reportDateYmd;
  const automationScope = doc2CreateAutomationScope(rec);
  const suiteRoom = isCanonicalSuiteRoom(rec.room);
  const isDayGuest = !suiteRoom && (!!rec.is_day_guest || !!rec.is_premium_day);
  const roomType = rec.is_premium_day && !suiteRoom
    ? "premium_day_guest"
    : (isDayGuest ? "day_guest" : "suite");

  assertGuestSegmentConsistent({ room: rec.room, room_type: roomType });
  if (roomType !== "suite") {
    await assertNoConflictingSuiteProfile(supabase, rec.phone, arrival);
  }
  await assertNoDuplicateGuest(supabase, rec.phone, arrival);

  // FAIL VISIBLE (P0 2026-08-05): never fall back to same-day departure for a
  // suite just because nights failed to parse (the 0-night suite
  // incident — arrival===departure, "0 nights" in the UI). Mirrors
  // supabase/functions/_shared/ezgoDoc2SuiteRoomSync.ts.
  let departureDate = isDayGuest
    ? arrival
    : addDepartureFromNights(arrival, rec.nights, { isDayGuest: false });
  if (!departureDate && !isDayGuest && rec.departure_date && arrival && rec.departure_date > arrival) {
    departureDate = rec.departure_date;
  }
  if (!departureDate) {
    throw new Error(
      `חסר מספר לילות — לא ניתן ליצור סוויטה (${rec.guest_name || rec.phone || "ללא שם"})`,
    );
  }

  const guestNotes = buildDoc2RemarkGuestNotes(
    rec.notes,
    rec.coord_name ?? null,
    rec.coord_phone ?? null,
    rec.guest_name,
    rec.phone,
  );

  const insert = {
    phone: rec.phone,
    name: rec.guest_name || null,
    arrival_date: arrival,
    departure_date: departureDate,
    room: rec.room,
    room_type: roomType,
    status: "expected",
    order_number: rec.order_number || null,
    meal_location: rec.meal_location || null,
    meal_time: rec.meal_time || null,
    automation_scope: automationScope,
    automation_muted: automationScope === "muted",
    guest_index: 1,
    ...(guestNotes ? { guest_notes: guestNotes } : {}),
  };

  const { data: inserted, error } = await supabase
    .from("guests")
    .insert(insert)
    .select("id, name, phone")
    .maybeSingle();
  if (error) throw error;
  if (!inserted) throw new Error("יצירת אורח נכשלה");

  await upsertDoc2SuiteRoomForGuest(supabase, {
    guestId: inserted.id,
    rec,
    reportDateYmd,
  });
  await recomputeGuestCombinedRoom(supabase, inserted.id, rec.room);

  if (inserted.phone) {
    await supabase.from("bookings").upsert({
      phone: inserted.phone.replace(/^\+/, ""),
      guest_name: rec.guest_name || null,
      arrival_date: arrival,
      status: "expected",
      room_count: 1,
    }, { onConflict: "phone,arrival_date" });
  }

  await runGuestImportPipelineHooks(supabase, inserted.id);

  return inserted;
}
