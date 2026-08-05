// Doc2 mail import — one guests profile per booking + suite_rooms per physical room.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Doc2Record } from "./ezgoDoc2Parser.ts";
import {
  isCanonicalSuiteRoom,
  roomsCanonicallyMatch,
  resolveSuiteRoomFromEzgoLabel,
} from "./suiteNames.ts";
import type { Doc2GuestRow } from "./ezgoDoc2MailLineWorkflow.ts";
import { doc2RecordMatchesGuest } from "./ezgoDoc2RecordMatch.ts";
import { mergeAutomationScope } from "./importAutomationScope.ts";
import {
  addDepartureFromNights,
  isSuiteStayGuest,
  resolveMissingDepartureAlert,
} from "./guestDepartureGuard.ts";
import { buildDoc2RemarkGuestNotes } from "./ezgoDoc2RemarkIdentity.ts";
import { runGuestImportPipelineHooks } from "./guestImportPipelineHooks.ts";

const DOC2_MAIL_LINE_PREFIX = "doc2mail-";

export function splitCombinedRoomLabel(combined = ""): string[] {
  const s = String(combined ?? "").trim();
  if (!s) return [];
  if (s.includes(" · ")) return s.split(" · ").map((x) => x.trim()).filter(Boolean);
  return [s];
}

export function buildCombinedRoomLabel(labels: string[] = []): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = String(raw ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.join(" · ");
}

export function doc2MailResLineId(orderNumber: string | null | undefined, room: string): string {
  const order = String(orderNumber ?? "").trim() || "unknown";
  const canon = resolveSuiteRoomFromEzgoLabel(room) || String(room ?? "").trim();
  const slug = canon
    .replace(/['‘’׳]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${DOC2_MAIL_LINE_PREFIX}${order}-${slug || "room"}`;
}

export function guestRoomLabelsInclude(
  guestRoom: string | null | undefined,
  incomingRoom: string,
): boolean {
  const labels = splitCombinedRoomLabel(guestRoom || "");
  if (!labels.length && guestRoom) labels.push(String(guestRoom).trim());
  return labels.some((label) => roomsCanonicallyMatch(label, incomingRoom));
}

export function isSameDoc2Booking(rec: Doc2Record, guest: Doc2GuestRow): boolean {
  // Group/municipal rows share an order_number but each remark row is a
  // distinct occupant — never merge rooms onto one profile unless phone AND
  // resolved guest name both match (prevents 12-room איליה-style blobs).
  if (rec.is_remark_group_occupant) {
    if (!rec.phone || !guest.phone || rec.phone !== guest.phone) return false;
    if (!rec.guest_name || !guest.name) return false;
    return rec.guest_name.trim() === String(guest.name).trim();
  }

  // An explicit order-number mismatch is authoritative — a shared phone/date
  // between two genuinely different bookings (e.g. a repeat guest with a new
  // reservation) must never fall through to the softer phone/date heuristic
  // below and get silently merged as "another room" on the wrong profile.
  if (rec.order_number && guest.order_number) {
    if (rec.order_number !== guest.order_number) return false;
    // Same order_number is NOT sufficient on its own — group/municipal
    // bookings share one order_number across several genuinely different
    // occupants (different phone, different room). An explicit phone
    // mismatch when both are known must still block the merge (Mike, P0
    // 2026-08-05: never merge via order_number when phones differ).
    if (rec.phone && guest.phone && rec.phone !== guest.phone) return false;
    return true;
  }
  const recDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  const guestDate = guest.arrival_date ? String(guest.arrival_date).slice(0, 10) : null;
  if (!recDate || !guestDate || recDate !== guestDate) return false;
  if (rec.phone && guest.phone && rec.phone === guest.phone) return true;
  if (rec.guest_name && guest.name) {
    return rec.guest_name.trim() === String(guest.name).trim();
  }
  return false;
}

/** Whether an incoming Doc2 row should add a room to an existing guest (not group pile-on). */
export function shouldMergeDoc2RowOntoGuest(
  rec: Doc2Record,
  guest: Doc2GuestRow,
): boolean {
  if (!isSameDoc2Booking(rec, guest)) return false;
  if (rec.is_remark_group_occupant) {
    return !!rec.room && guestRoomLabelsInclude(guest.room, rec.room);
  }
  return true;
}

function pickEnrichValue(importVal: unknown, existingVal: unknown): unknown {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (existingVal === undefined || existingVal === null || existingVal === "") return importVal;
  return undefined;
}

/** Mirrors ezgoDoc2MailLineWorkflow.ts's isSuspectSuiteStayDates — 0-night bug signature. */
function isSuspectSuiteStayDates(guest: Doc2GuestRow): boolean {
  if (!isSuiteStayGuest({ room_type: guest.room_type, room: guest.room })) return false;
  if (!guest.departure_date) return true;
  return !!guest.arrival_date && guest.arrival_date === guest.departure_date;
}

function pickDoc2SnapshotValue(
  importVal: unknown,
  existingVal: unknown,
  { allowOverwrite }: { allowOverwrite: boolean },
): unknown {
  if (importVal === undefined || importVal === null || importVal === "") return undefined;
  if (allowOverwrite) return importVal;
  return pickEnrichValue(importVal, existingVal);
}

export function buildDoc2GuestEnrichPatch(
  rec: Doc2Record,
  guest: Doc2GuestRow,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (rec.order_number) {
    const picked = pickEnrichValue(rec.order_number, guest.order_number);
    if (picked !== undefined) patch.order_number = picked;
  }
  if (rec.arrival_date) {
    const picked = pickEnrichValue(rec.arrival_date, guest.arrival_date);
    if (picked !== undefined) patch.arrival_date = picked;
  }
  if (rec.departure_date) {
    const allowOverwrite = isSuspectSuiteStayDates(guest)
      && (!guest.arrival_date || rec.departure_date > guest.arrival_date);
    const picked = pickDoc2SnapshotValue(rec.departure_date, guest.departure_date, { allowOverwrite });
    if (picked !== undefined) patch.departure_date = picked;
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
  if (rec.automation_scope) {
    const merged = mergeAutomationScope(guest.automation_scope, rec.automation_scope);
    if (merged !== (guest.automation_scope ?? "full")) {
      patch.automation_scope = merged;
      patch.automation_muted = merged === "muted";
    }
  }
  return patch;
}

export async function findGuestForDoc2SuiteCreate(
  supabase: SupabaseClient,
  rec: Doc2Record,
  reportDateYmd: string | null,
): Promise<Doc2GuestRow | null> {
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
      const only = data[0] as Doc2GuestRow;
      if (rec.is_remark_group_occupant) {
        return shouldMergeDoc2RowOntoGuest(rec, only) ? only : null;
      }
      if (doc2RecordMatchesGuest(rec, only)) return only;
    }
    if (data && data.length > 1) {
      if (rec.is_remark_group_occupant) {
        const hit = data.find((g) => shouldMergeDoc2RowOntoGuest(rec, g as Doc2GuestRow));
        return (hit as Doc2GuestRow) ?? null;
      }
      if (rec.phone) {
        const hit = data.find((g) => g.phone === rec.phone);
        if (hit) return hit as Doc2GuestRow;
      }
    }
  }

  if (rec.phone) {
    const { data } = await supabase
      .from("guests")
      .select(select)
      .eq("phone", rec.phone)
      .eq("arrival_date", arrival)
      .neq("status", "cancelled")
      .limit(2);
    if (data?.length === 1) {
      const only = data[0] as Doc2GuestRow;
      if (rec.is_remark_group_occupant) {
        return shouldMergeDoc2RowOntoGuest(rec, only) ? only : null;
      }
      return only;
    }
  }

  return null;
}

async function fetchSuiteRoomLabels(
  supabase: SupabaseClient,
  guestId: number,
): Promise<string[]> {
  const { data } = await supabase
    .from("suite_rooms")
    .select("room_display, room_name")
    .eq("guest_id", guestId)
    .order("res_line_id", { ascending: true });
  const labels: string[] = [];
  for (const row of data ?? []) {
    const raw = String(row.room_display || row.room_name || "").trim();
    if (!raw) continue;
    // Defensive re-canonicalization (P0 2026-08-05): rows written before the
    // suite-first label fix may still hold a raw "X - בילוי יומי" string —
    // re-resolving recovers the real suite number where possible instead of
    // permanently baking the stale label into guests.room.
    labels.push(resolveSuiteRoomFromEzgoLabel(raw) || raw);
  }
  return labels;
}

export async function ensureGuestRoomsSeededToSuiteRooms(
  supabase: SupabaseClient,
  {
    guestId,
    rec,
    reportDateYmd,
    guestRoom,
  }: {
    guestId: number;
    rec: Doc2Record;
    reportDateYmd: string | null;
    guestRoom?: string | null;
  },
): Promise<void> {
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

export async function upsertDoc2SuiteRoomForGuest(
  supabase: SupabaseClient,
  {
    guestId,
    rec,
    reportDateYmd,
  }: {
    guestId: number;
    rec: Doc2Record;
    reportDateYmd: string | null;
  },
): Promise<{ added: boolean; roomLabel: string | null; skippedReason?: string }> {
  const room = rec.room ? String(rec.room).trim() : "";
  if (!room) return { added: false, roomLabel: null };

  // Hermetic guard (P0 2026-08-05): this file only ever writes suite_rooms for
  // suite bookings — resolveSuiteRoomFromEzgoLabel returns a canonical suite
  // name, "Premium Day 1/2", "בילוי יומי", or "" (never anything else), so a
  // day-pass label reaching here is always a stale/mis-parsed rec, not a
  // legitimate call. Skip instead of creating a phantom "בילוי יומי" chip on
  // a suite guest's room list.
  if (!isCanonicalSuiteRoom(room)) {
    console.warn(
      `[ezgoDoc2SuiteRoomSync] skipped non-canonical room "${room}" for guest ${guestId}`,
    );
    return { added: false, roomLabel: null, skippedReason: "non_canonical_room" };
  }

  const arrival = rec.arrival_date || reportDateYmd;
  const orderNumber = String(rec.order_number ?? "").trim()
    || `${DOC2_MAIL_LINE_PREFIX}${guestId}`;
  const resLineId = doc2MailResLineId(rec.order_number, room);

  // Dedupe by (guest_id, canonical room) FIRST — two insert paths for the same
  // guest+room (e.g. a doc2mail-<id> fallback order_number from seeding vs a
  // real order_number from a later reparse) must update the same row, not
  // create a second chip. (order_number, res_line_id) alone missed this
  // because the fallback order_number differs between calls.
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
    ? { data: null as { id: number } | null }
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
  };

  if (existing) {
    await supabase.from("suite_rooms").update(rowPatch).eq("id", existing.id);
    return { added: false, roomLabel: room };
  }

  const { error: insErr } = await supabase.from("suite_rooms").insert({
    ...rowPatch,
    res_line_id: resLineId,
    adults: 1,
    nights: rec.nights ?? 0,
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

export async function recomputeGuestCombinedRoom(
  supabase: SupabaseClient,
  guestId: number,
  fallbackRoom?: string | null,
): Promise<string | null> {
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

export async function applyDoc2SuiteRoomAdd(
  supabase: SupabaseClient,
  {
    guestId,
    rec,
    reportDateYmd,
  }: {
    guestId: number;
    rec: Doc2Record;
    reportDateYmd: string | null;
  },
): Promise<{ id: number; name: string | null; phone: string | null; room: string | null }> {
  const { data: guest, error: gErr } = await supabase
    .from("guests")
    .select("id, name, phone, order_number, arrival_date, departure_date, room, meal_location, meal_time, automation_scope")
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

  const enrichPatch = buildDoc2GuestEnrichPatch(rec, guest as Doc2GuestRow);
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
      phone: String(guest.phone).replace(/^\+/, ""),
      guest_name: rec.guest_name || guest.name || null,
      arrival_date: arrival,
      status: "expected",
      room_count: Math.max(labels.length, 1),
    }, { onConflict: "phone,arrival_date" });
  }

  await runGuestImportPipelineHooks(supabase, guestId);

  return {
    id: guestId,
    name: (enrichPatch.name as string) || guest.name,
    phone: guest.phone,
    room: combined || guest.room,
  };
}

export async function createDoc2SuiteArrival(
  supabase: SupabaseClient,
  rec: Doc2Record,
  reportDateYmd: string | null,
): Promise<{ id: number; name: string | null; phone: string | null }> {
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
  const automationScope = rec.automation_scope ?? "full";
  const isDayGuest = !!rec.is_day_guest || !!rec.is_premium_day;

  // FAIL VISIBLE (P0 2026-08-05): a suite create must never fall back to a
  // same-day departure just because nights failed to parse — that's exactly
  // the incident signature (arrival === departure, "0 nights" in the UI).
  // Prefer the nights-derived date; accept an explicitly parsed departure_date
  // only if it's genuinely after arrival; otherwise refuse the create.
  let departureDate: string | null = isDayGuest
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

  const insert: Record<string, unknown> = {
    phone: rec.phone,
    name: rec.guest_name || null,
    arrival_date: arrival,
    departure_date: departureDate,
    room: rec.room,
    room_type: rec.is_premium_day ? "premium_day_guest" : (rec.is_day_guest ? "day_guest" : "suite"),
    status: "expected",
    order_number: rec.order_number || null,
    meal_location: rec.meal_location || null,
    meal_time: rec.meal_time || null,
    automation_scope: automationScope,
    automation_muted: automationScope === "muted",
    guest_index: 1,
  };
  if (guestNotes) insert.guest_notes = guestNotes;

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

  await runGuestImportPipelineHooks(supabase, inserted.id as number);

  return inserted;
}
