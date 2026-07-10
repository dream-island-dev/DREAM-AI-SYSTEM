// src/utils/spaActivitiesSyncEngine.js
// ── Ezgo Activities sync engine — Phase 2 of the Smart Spa Board full sync ──
// Consumes parseEzgoActivitiesReport() rows (ezgoSpaActivitiesParser.js) and
// resolves+writes them: spa_appointments upsert, guests.spa_date/spa_time +
// guest_profile.spa write-through (Golden Profile, CLAUDE.md §0.5), and
// spa_import_unmatched staging for anything that can't be fully resolved
// (ZERO DATA LOSS — CLAUDE.md §0.1). Not yet wired to any button — that's
// Phase 3 (SpaBoard.js import UI).
//
// Split deliberately into pure decision helpers (exported + unit tested
// below) and one orchestration function that talks to Supabase — the
// heuristics (which guest wins on a shared phone, which existing appointment
// a re-imported row should update instead of duplicate) are the parts most
// likely to have a subtle bug, so those are the parts kept testable without
// mocking a database.
//
// Reviewed by an external Plan-agent pass before being wired to anything
// (playbook §6 step 5b — write-through to the Golden Profile is high-stakes).
// Fixed as a result: shared-phone rows now disambiguate by the row's own
// לקוח name first (previously two guests sharing one phone could both get
// written with the SAME guest_id); cancelled appointments are excluded from
// re-import matching instead of being silently revived; guest.phone is
// canonicalized the same way row.phone already is before the map lookup
// (previously a guest stored in a different phone shape than expected could
// silently miss every match); unmatched reasons are now picked by an
// explicit priority so a missing-time row isn't mislabeled "room_unmapped".

import { normalizeActivitiesPhone } from "./ezgoSpaActivitiesParser";

/** "972XXXXXXXXX" (Phase 1's normalized shape) → every phone spelling guests.phone might be stored as ("+972…", "972…", "0…" — CLAUDE.md §3 phone format rule). */
export function resolvePhoneVariants(phone972) {
  if (!phone972) return [];
  const variants = new Set([phone972, `+${phone972}`]);
  if (phone972.startsWith("972")) variants.add("0" + phone972.slice(3));
  return [...variants];
}

function nameTokenSet(name) {
  return new Set(String(name ?? "").trim().split(/\s+/).filter(Boolean));
}

/** Word-set equality so "דיין חיים" matches a guest stored as "חיים דיין" (order-insensitive) without pulling in a fuzzy-match library for one heuristic. */
function namesLikelyMatch(a, b) {
  const ta = nameTokenSet(a);
  const tb = nameTokenSet(b);
  if (!ta.size || ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}

/**
 * Disambiguates multiple guests.phone rows sharing one phone (couples/groups
 * on an organizer's number — expected, not an error). Tries the row's own
 * לקוח name against each candidate FIRST — without this, two guests sharing
 * a phone with overlapping stay windows (the normal couple case) would both
 * resolve to the identical candidate, silently writing the wrong person's
 * guest_id on one of the two appointments. Falls back to stay-window
 * containment, then closest arrival_date. A single candidate is accepted
 * as-is, never flagged. Any multi-candidate outcome is still flagged
 * suspicious=true — a shared phone stays visible to staff even when
 * confidently resolved by name.
 */
export function pickBestGuestMatch(candidates, appointmentDate, guestNameHint) {
  const list = candidates ?? [];
  if (list.length === 0) return { guest: null, suspicious: false, reason: null };
  if (list.length === 1) return { guest: list[0], suspicious: false, reason: null };

  if (guestNameHint) {
    const nameMatches = list.filter((c) => namesLikelyMatch(guestNameHint, c.name));
    if (nameMatches.length === 1) {
      return {
        guest: nameMatches[0],
        suspicious: true,
        reason: `${list.length} אורחים על אותו טלפון — זוהה לפי שם ("${guestNameHint}")`,
      };
    }
  }

  const inStay = list.filter(
    (c) => c.arrival_date && c.departure_date && c.arrival_date <= appointmentDate && appointmentDate <= c.departure_date
  );
  if (inStay.length === 1) {
    return {
      guest: inStay[0],
      suspicious: true,
      reason: `${list.length} אורחים על אותו טלפון — נבחר לפי טווח שהות תואם`,
    };
  }

  const withArrival = (inStay.length > 1 ? inStay : list).filter((c) => c.arrival_date);
  if (withArrival.length) {
    const target = new Date(appointmentDate).getTime();
    const sorted = [...withArrival].sort(
      (a, b) => Math.abs(new Date(a.arrival_date).getTime() - target) - Math.abs(new Date(b.arrival_date).getTime() - target)
    );
    return {
      guest: sorted[0],
      suspicious: true,
      reason: `${list.length} אורחים על אותו טלפון — נבחר הקרוב ביותר בתאריך הגעה`,
    };
  }

  return {
    guest: list[0],
    suspicious: true,
    reason: `${list.length} אורחים על אותו טלפון — לא ניתן לקבוע לפי תאריכים`,
  };
}

/** Indexes a day's existing spa_appointments for O(1) re-import matching. */
export function buildExistingApptIndex(existingAppts) {
  const byLineId = new Map();
  const byNaturalKey = new Map();
  for (const a of existingAppts ?? []) {
    if (a.ezgo_line_id) byLineId.set(a.ezgo_line_id, a);
    byNaturalKey.set(`${a.room_id}|${a.start_time}|${a.guest_id ?? ""}`, a);
  }
  return { byLineId, byNaturalKey };
}

/**
 * Idempotency match for one parsed row against a day's existing appointments
 * — ezgo_line_id wins when present (stable per-row id from Ezgo); otherwise
 * falls back to (room, start_time, guest) so a re-import UPDATEs instead of
 * duplicating. Returns null when this is a genuinely new appointment.
 */
export function matchExistingAppointment(row, roomId, guestId, index) {
  if (row.ezgo_line_id && index.byLineId.has(row.ezgo_line_id)) {
    return index.byLineId.get(row.ezgo_line_id);
  }
  if (roomId != null) {
    const hit = index.byNaturalKey.get(`${roomId}|${row.start_time}|${guestId ?? ""}`);
    if (hit) return hit;
  }
  return null;
}

/** Builds the guests.guest_profile JSONB patch — merges into whatever profile keys already exist (vip_status/occasion/dietary etc., guestProfile.ts's shape), never replaces the whole object. */
export function buildGuestSpaProfilePatch(existingProfile, appt) {
  const profile = existingProfile && typeof existingProfile === "object" ? existingProfile : {};
  return {
    ...profile,
    spa: {
      date: appt.appointment_date ?? null,
      time: appt.start_time ?? null,
      end_time: appt.end_time ?? null,
      room: appt.room ?? null,
      therapist: appt.therapist ?? null,
      treatment_type: appt.treatment_type ?? null,
      ezgo_line_id: appt.ezgo_line_id ?? null,
      imported_at: new Date().toISOString(),
    },
  };
}

/** Priority order matters — a row missing start/end time is not a room problem, and a room problem is not a guest problem; each must land in the reason a staff member can actually act on. */
function classifyUnresolvedReason(row, guest, roomId) {
  if (!row.start_time || !row.end_time) return "invalid_time_range";
  if (!guest) return "no_guest_match";
  if (!roomId) return "room_unmapped";
  return null;
}

function unmatchedRow(batchId, appointmentDate, row, reason) {
  return {
    import_batch: batchId,
    appointment_date: appointmentDate,
    raw_row: row.raw,
    reason,
    phone: row.phone_raw,
    guest_name: row.guest_name,
    room_raw: row.room_raw,
    start_time: row.start_time,
  };
}

/**
 * Full sync for one day's parsed Activities rows. Upserts present rows only
 * — appointments not represented in this batch are left untouched (no
 * auto-cancel), matching the locked "upsert-only" default from the planning
 * doc. Returns a summary matching the Phase 3 import-toast shape.
 */
export async function syncEzgoSpaActivities(parsedRows, appointmentDate, { supabase }) {
  const summary = { created: 0, updated: 0, matched_guests: 0, unmatched: 0, room_unmapped: 0, conflicts: 0, suspicious: 0 };
  if (!parsedRows.length) return summary;

  const [{ data: aliasRows }, { data: therapistRows }, { data: roomRows }, { data: existingAppts }] = await Promise.all([
    supabase.from("spa_room_aliases").select("ezgo_name, room_id"),
    supabase.from("spa_therapists").select("id, name"),
    supabase.from("spa_rooms").select("id, name"),
    // Cancelled appointments are deliberately excluded from the re-import
    // index — matching against one would silently "revive" a slot a staff
    // member intentionally cancelled (payload never sets status, so an
    // UPDATE would leave it cancelled forever while reporting success).
    supabase.from("spa_appointments").select("id, guest_id, room_id, ezgo_line_id, start_time").eq("appointment_date", appointmentDate).neq("status", "cancelled"),
  ]);
  const aliasMap = new Map((aliasRows ?? []).map((r) => [r.ezgo_name, r.room_id]));
  const therapistMap = new Map((therapistRows ?? []).map((t) => [t.name, t.id]));
  const roomNameById = new Map((roomRows ?? []).map((r) => [r.id, r.name]));
  const apptIndex = buildExistingApptIndex(existingAppts);

  const phones = [...new Set(parsedRows.map((r) => r.phone).filter(Boolean))];
  const phoneVariants = [...new Set(phones.flatMap(resolvePhoneVariants))];
  const { data: guestRows } = phoneVariants.length
    ? await supabase.from("guests").select("id, name, phone, arrival_date, departure_date, status").in("phone", phoneVariants)
    : { data: [] };
  // Canonicalize guest.phone the SAME way Phase 1 canonicalizes row.phone
  // (bare "972…", no +) before indexing — guests.phone is supposed to always
  // be "+972…" (CLAUDE.md §3) but this must not silently miss a match if a
  // row was ever saved in a different shape (FAIL VISIBLE > assuming format).
  const guestsByPhone = new Map();
  for (const g of guestRows ?? []) {
    const bare = normalizeActivitiesPhone(g.phone);
    if (!bare) continue;
    if (!guestsByPhone.has(bare)) guestsByPhone.set(bare, []);
    guestsByPhone.get(bare).push(g);
  }

  const batchId = crypto.randomUUID();
  const unmatched = [];
  const touchedGuestIds = new Set();

  for (const row of parsedRows) {
    const roomId = row.room_raw ? aliasMap.get(row.room_raw) ?? null : null;
    const candidates = row.phone ? guestsByPhone.get(row.phone) ?? [] : [];
    const { guest, suspicious, reason } = pickBestGuestMatch(candidates, appointmentDate, row.guest_name);

    const unresolvedReason = classifyUnresolvedReason(row, guest, roomId);
    if (unresolvedReason) {
      if (unresolvedReason === "room_unmapped") summary.room_unmapped++;
      summary.unmatched++;
      unmatched.push(unmatchedRow(batchId, appointmentDate, row, unresolvedReason));
      continue;
    }

    let therapistId = therapistMap.get(row.therapist_name) ?? null;
    if (row.therapist_name && !therapistId) {
      const { data: newTherapist, error: newTherapistErr } = await supabase
        .from("spa_therapists")
        .insert({ name: row.therapist_name })
        .select("id")
        .maybeSingle();
      if (newTherapistErr) {
        console.warn("[spaActivitiesSyncEngine] therapist create failed:", row.therapist_name, newTherapistErr.message);
      } else if (newTherapist) {
        therapistId = newTherapist.id;
        therapistMap.set(row.therapist_name, therapistId);
      }
    }

    const existing = matchExistingAppointment(row, roomId, guest.id, apptIndex);
    const payload = {
      guest_id: guest.id,
      room_id: roomId,
      therapist_id: therapistId,
      appointment_date: appointmentDate,
      start_time: row.start_time,
      end_time: row.end_time,
      notes: row.note,
      ezgo_line_id: row.ezgo_line_id,
      phone_snapshot: row.phone_raw,
      treatment_type: row.treatment_type,
    };

    const { error } = existing
      ? await supabase.from("spa_appointments").update(payload).eq("id", existing.id)
      : await supabase.from("spa_appointments").insert(payload);

    if (error) {
      if (error.code === "23P01") {
        summary.conflicts++;
        unmatched.push(unmatchedRow(batchId, appointmentDate, row, "conflict_23P01"));
        continue;
      }
      console.error("[spaActivitiesSyncEngine] appointment write failed:", error.message);
      summary.unmatched++;
      unmatched.push(unmatchedRow(batchId, appointmentDate, row, "write_failed"));
      continue;
    }

    existing ? summary.updated++ : summary.created++;
    summary.matched_guests++;
    touchedGuestIds.add(guest.id);

    if (suspicious) {
      summary.suspicious++;
      unmatched.push({ ...unmatchedRow(batchId, appointmentDate, row, "suspicious_shared_phone"), guest_name: `${row.guest_name ?? "—"} (${reason})` });
    }
  }

  if (unmatched.length) {
    const { error: unmatchedErr } = await supabase.from("spa_import_unmatched").insert(unmatched);
    if (unmatchedErr) console.error("[spaActivitiesSyncEngine] unmatched staging insert failed:", unmatchedErr.message);
  }

  // Write-through guests.spa_date/spa_time (earliest non-cancelled appointment
  // that day WINS — queried fresh, not just from this batch, so a guest whose
  // earlier appointment wasn't touched by this re-import still stays correct)
  // + guest_profile.spa context for the WhatsApp bot (buildGuestStageContext).
  for (const guestId of touchedGuestIds) {
    const { data: earliestRows } = await supabase
      .from("spa_appointments")
      .select("start_time, end_time, room_id, treatment_type, ezgo_line_id, spa_therapists(name)")
      .eq("guest_id", guestId)
      .eq("appointment_date", appointmentDate)
      .neq("status", "cancelled")
      .order("start_time")
      .limit(1);
    const earliest = earliestRows?.[0];
    if (!earliest) continue;

    const { data: guestRow } = await supabase.from("guests").select("guest_profile").eq("id", guestId).maybeSingle();
    const patch = buildGuestSpaProfilePatch(guestRow?.guest_profile, {
      appointment_date: appointmentDate,
      start_time: earliest.start_time,
      end_time: earliest.end_time,
      treatment_type: earliest.treatment_type,
      ezgo_line_id: earliest.ezgo_line_id,
      room: roomNameById.get(earliest.room_id) ?? null,
      therapist: earliest.spa_therapists?.name ?? null,
    });

    const { error: guestErr } = await supabase
      .from("guests")
      .update({ spa_date: appointmentDate, spa_time: earliest.start_time, guest_profile: patch })
      .eq("id", guestId);
    if (guestErr) console.warn("[spaActivitiesSyncEngine] guest write-through failed:", guestId, guestErr.message);
  }

  return summary;
}
