// Per-room room_ready helpers — multi-suite guests share one guests row.

import { buildCombinedRoomLabel } from "./guestImportIntelligence";
import { resolveSuiteFromEzgoFields, guestRoomMatchesSuiteId } from "../data/suiteRegistry";
import { fetchGuestSuiteRooms } from "./guestStaySummary";

const MANUAL_LINE_PREFIX = "manual-";
const MAX_MANUAL_SUITE_ROOMS = 8;

function isManualSuiteRoomRow(row) {
  return String(row?.res_line_id ?? "").toLowerCase().startsWith(MANUAL_LINE_PREFIX);
}

function manualResLineId(guestId, index) {
  return `${MANUAL_LINE_PREFIX}${guestId}-${index + 1}`;
}

function manualOrderNumber(guestId, orderNumber) {
  const order = String(orderNumber ?? "").trim();
  return order || `${MANUAL_LINE_PREFIX}${guestId}`;
}

function dedupeRoomLabels(labels = []) {
  const seen = new Set();
  const out = [];
  for (const raw of labels) {
    const label = String(raw ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function resolveSuiteRoomDisplayLabel(row) {
  if (!row) return "";
  const display = String(row.room_display ?? "").trim();
  if (display) return display;
  const resolved = resolveSuiteFromEzgoFields(
    row.room_name,
    row.suite_type,
    !!row.is_day_guest,
  );
  if (resolved) return resolved;
  return String(row.room_name ?? row.suite_type ?? "").trim();
}

export function isSuiteRoomReadySent(row) {
  return !!(row?.room_ready_notified || row?.msg_room_ready_sent);
}

export function groupSuiteRoomsByGuestId(rows) {
  const map = {};
  for (const row of rows ?? []) {
    const gid = row?.guest_id;
    if (!gid) continue;
    if (!map[gid]) map[gid] = [];
    map[gid].push(row);
  }
  return map;
}

export async function fetchSuiteRoomsForGuestIds(supabase, guestsOrIds) {
  if (!supabase || !guestsOrIds?.length) return {};

  const guests = guestsOrIds.map((item) => (
    typeof item === "object" && item !== null ? item : { id: item }
  ));
  const ids = [...new Set(guests.map((g) => Number(g.id)).filter(Boolean))];
  const map = {};

  if (ids.length) {
    const { data, error } = await supabase
      .from("suite_rooms")
      .select(
        "id, guest_id, res_line_id, order_number, room_name, suite_type, room_display, adults, nights, arrival_date, room_ready_notified, msg_room_ready_sent, is_day_guest",
      )
      .in("guest_id", ids)
      .order("res_line_id", { ascending: true });
    if (error) console.warn("[fetchSuiteRoomsForGuestIds]", error.message);
    Object.assign(map, groupSuiteRoomsByGuestId(data ?? []));
  }

  const missing = guests.filter((g) => g.id && !map[g.id]?.length);
  await Promise.all(missing.map(async (guest) => {
    const rows = await fetchGuestSuiteRooms(supabase, guest);
    if (rows.length) map[guest.id] = rows;
  }));

  return map;
}

export async function sendGuestRoomReadyMessage(supabase, { guestId, roomLabel }) {
  return supabase.functions.invoke("whatsapp-send", {
    body: { trigger: "room_ready", guestId, roomId: roomLabel || undefined },
  });
}

export function findSuiteRoomRowForLabel(rows, roomLabel) {
  const target = String(roomLabel ?? "").trim();
  if (!target || !rows?.length) return null;
  const exact = rows.find((r) => resolveSuiteRoomDisplayLabel(r) === target);
  if (exact) return exact;
  return rows.find((r) =>
    guestRoomMatchesSuiteId(
      { room: resolveSuiteRoomDisplayLabel(r), suite_name: r.suite_type },
      target,
    ),
  ) ?? null;
}

/**
 * Manual AddGuestModal save → suite_rooms (per-room room_ready source of truth).
 * Never deletes EZGO import rows — only manual-* res_line_id extras.
 */
export async function syncGuestSuiteRoomsFromSelection(supabase, {
  guestId,
  guestPhone,
  guestName,
  orderNumber,
  arrivalDate,
  roomLabels,
  isDayGuest = false,
}) {
  if (!supabase || !guestId) return { ok: false, error: "guest חסר" };

  const labels = dedupeRoomLabels(roomLabels).slice(0, MAX_MANUAL_SUITE_ROOMS);

  let query = supabase
    .from("suite_rooms")
    .select("id, res_line_id, room_display, guest_id")
    .order("res_line_id", { ascending: true });

  const { data: byGuestId, error: byGuestErr } = await query.eq("guest_id", guestId);
  if (byGuestErr) return { ok: false, error: byGuestErr.message };

  let existing = byGuestId ?? [];
  if (!existing.length && guestPhone) {
    let fallback = supabase
      .from("suite_rooms")
      .select("id, res_line_id, room_display, guest_id")
      .eq("guest_phone", guestPhone)
      .order("res_line_id", { ascending: true });
    if (arrivalDate) fallback = fallback.eq("arrival_date", arrivalDate);
    if (orderNumber) fallback = fallback.eq("order_number", orderNumber);
    const { data: byPhone, error: byPhoneErr } = await fallback;
    if (byPhoneErr) return { ok: false, error: byPhoneErr.message };
    existing = byPhone ?? [];
  }

  const manualRows = existing.filter(isManualSuiteRoomRow);
  const importRows = existing.filter((r) => !isManualSuiteRoomRow(r));

  if (isDayGuest || labels.length === 0) {
    const manualIds = manualRows.map((r) => r.id);
    if (manualIds.length) {
      const { error } = await supabase.from("suite_rooms").delete().in("id", manualIds);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true, synced: 0 };
  }

  const order = manualOrderNumber(guestId, orderNumber);
  const keptManualIds = new Set();

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const target =
      importRows[i]
      ?? manualRows.find((r) => !keptManualIds.has(r.id))
      ?? null;

    const rowPatch = {
      guest_id: guestId,
      guest_phone: guestPhone || null,
      guest_name: guestName || null,
      order_number: order,
      arrival_date: arrivalDate || null,
      room_display: label,
      room_name: label,
      is_day_guest: false,
    };

    if (target) {
      keptManualIds.add(target.id);
      const { error } = await supabase.from("suite_rooms").update(rowPatch).eq("id", target.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const resLineId = manualResLineId(guestId, i);
      const { error: insErr } = await supabase.from("suite_rooms").insert({
        ...rowPatch,
        res_line_id: resLineId,
        adults: 1,
        nights: 0,
      });
      if (insErr?.code === "23505") {
        const { error: upErr } = await supabase
          .from("suite_rooms")
          .update(rowPatch)
          .eq("order_number", order)
          .eq("res_line_id", resLineId);
        if (upErr) return { ok: false, error: upErr.message };
      } else if (insErr) {
        return { ok: false, error: insErr.message };
      }
    }
  }

  const deleteIds = manualRows.filter((r) => !keptManualIds.has(r.id)).map((r) => r.id);
  if (deleteIds.length) {
    const { error } = await supabase.from("suite_rooms").delete().in("id", deleteIds);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true, synced: labels.length, combined: buildCombinedRoomLabel(labels) };
}
