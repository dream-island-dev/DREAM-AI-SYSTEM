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

import { normalizeActivitiesPhone, collectGuestNameHints, resolveSpaGuestDisplayName } from "./ezgoSpaActivitiesParser";

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
 * Looser Hebrew person match: all tokens of the shorter name appear in the
 * longer ("רעות לוי" ↔ "רעות לוי כהן"). Requires ≥2 tokens on the smaller set
 * so a single shared first name never steals another guest on a group phone.
 */
function namesLooselyMatch(a, b) {
  if (namesLikelyMatch(a, b)) return true;
  const ta = nameTokenSet(a);
  const tb = nameTokenSet(b);
  if (ta.size >= 2 && ta.size <= tb.size && [...ta].every((t) => tb.has(t))) return true;
  if (tb.size >= 2 && tb.size <= ta.size && [...tb].every((t) => ta.has(t))) return true;
  return false;
}

function guestMatchesNameHint(guest, hint) {
  if (!hint || !guest?.name) return false;
  return namesLooselyMatch(hint, guest.name);
}

/**
 * Disambiguates multiple guests.phone rows sharing one phone (couples/groups
 * on an organizer's number — expected, not an error). Tries the row's own
 * לקוח name AND group_label / Hebrew paren person name against each candidate
 * FIRST — without this, two guests sharing a phone with overlapping stay
 * windows (the normal couple case) would both resolve to the identical
 * candidate, and Latin nicknames like "limor (לימור סולומון)" would miss the
 * Golden Profile entirely. Falls back to stay-window containment, then
 * closest arrival_date. A single candidate is accepted as-is, never flagged.
 * Any multi-candidate outcome is still flagged suspicious=true — a shared
 * phone stays visible to staff even when confidently resolved by name.
 *
 * @param {string|null} [guestNameHint]
 * @param {string|null} [groupLabelHint] — parentheses text from parseGuestNameCell
 */
export function pickBestGuestMatch(candidates, appointmentDate, guestNameHint, groupLabelHint = null) {
  const list = candidates ?? [];
  if (list.length === 0) return { guest: null, suspicious: false, reason: null };
  if (list.length === 1) return { guest: list[0], suspicious: false, reason: null };

  const hints = collectGuestNameHints(guestNameHint, groupLabelHint);
  for (const hint of hints) {
    const nameMatches = list.filter((c) => guestMatchesNameHint(c, hint));
    if (nameMatches.length === 1) {
      return {
        guest: nameMatches[0],
        suspicious: true,
        reason: `${list.length} אורחים על אותו טלפון — זוהה לפי שם ("${hint}")`,
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
    // Therapist is part of the natural key so a couple booking (same room +
    // start + guest, two therapists) does not collapse to one appointment on
    // re-import when ezgo_line_id is missing.
    byNaturalKey.set(`${a.room_id}|${a.start_time}|${a.guest_id ?? ""}|${a.therapist_id ?? ""}`, a);
  }
  return { byLineId, byNaturalKey };
}

/**
 * Idempotency match for one parsed row against a day's existing appointments
 * — ezgo_line_id wins when present (stable per-row id from Ezgo); otherwise
 * falls back to (room, start_time, guest, therapist) so a re-import UPDATEs
 * instead of duplicating, including couple slots with two therapists.
 * Returns null when this is a genuinely new appointment.
 */
export function matchExistingAppointment(row, roomId, guestId, index, therapistId = null) {
  if (row.ezgo_line_id && index.byLineId.has(row.ezgo_line_id)) {
    return index.byLineId.get(row.ezgo_line_id);
  }
  if (roomId != null) {
    const hit = index.byNaturalKey.get(`${roomId}|${row.start_time}|${guestId ?? ""}|${therapistId ?? ""}`);
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

// Guards the guest auto-create path only — resolvePhoneVariants/matching is
// safe to run against a garbage phone (it just won't find anyone), but an
// INSERT into the Golden Profile must not happen off a phone-shaped column
// that actually contains OCR noise or a misaligned cell (e.g. a therapist
// name landing in the טלפון column). 972 + 8-9 digits covers Israeli mobile
// (05X-XXXXXXX → 972 + 9 digits) and landline (0X-XXXXXXX → 972 + 8 digits).
const PLAUSIBLE_ISRAELI_PHONE_RE = /^972\d{8,9}$/;

const MEAL_CONTEXT_RE = /(?:ארוחה|ארוחת|dinner|HB|Half[\s-]?Board|מסעדה|פנסיון|שולחן)/i;

/**
 * Explicit meal-time extraction from a spa row's note/extras text only —
 * mirrors the same conservative discipline as ArrivalImportPanel's
 * `_extractMealTime` (explicit meal keyword + clock time; bare evening times
 * without a meal-context word are never captured) but scoped to a single
 * free-text cell instead of a multi-line report block. Returns "HH:MM" or
 * null — never guesses from board-basis words alone (locked decision, Mike).
 */
export function extractSpaMealTime(text) {
  const clean = String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;

  let m = clean.match(/ארוחה[ת]?\s*(?:ערב|בוקר|צהריים)?\s*[-:]?\s*(\d{1,2}):(\d{2})/);
  if (!m && /(?:ערב|צהריים)/i.test(clean)) {
    m = clean.match(/מ-?\s*(\d{1,2}):(\d{2})/);
  }
  if (!m && /\b(?:HB|Half[\s-]?Board)\b/i.test(clean)) {
    m = clean.match(/(\d{1,2}):(\d{2})/);
  }
  if (!m && /\bDinner\b/i.test(clean)) {
    m = clean.match(/(\d{1,2}):(\d{2})/);
  }
  if (!m && /מסעדה/.test(clean)) {
    m = clean.match(/(\d{1,2}):(\d{2})/);
  }
  if (!m && MEAL_CONTEXT_RE.test(clean)) {
    const eveM = clean.match(/\b(1[89]|2[01]):(\d{2})\b/);
    if (eveM) {
      const h = parseInt(eveM[1], 10);
      const min = parseInt(eveM[2], 10);
      if (!(h === 21 && min > 30)) m = eveM;
    }
  }
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
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
export async function syncEzgoSpaActivities(parsedRows, appointmentDate, { supabase, skippedCancelled = 0 } = {}) {
  const summary = {
    created: 0, updated: 0, matched_guests: 0, unmatched: 0, room_unmapped: 0, conflicts: 0, suspicious: 0,
    guests_created: 0, not_in_file: 0, meal_time_set: 0, skipped_cancelled: skippedCancelled,
    appointment_date: appointmentDate,
  };
  if (!parsedRows.length) return summary;

  const [{ data: aliasRows }, { data: therapistRows }, { data: roomRows }, { data: existingAppts }] = await Promise.all([
    supabase.from("spa_room_aliases").select("ezgo_name, room_id"),
    supabase.from("spa_therapists").select("id, name"),
    supabase.from("spa_rooms").select("id, name"),
    // Cancelled appointments are deliberately excluded from the re-import
    // index — matching against one would silently "revive" a slot a staff
    // member intentionally cancelled (payload never sets status, so an
    // UPDATE would leave it cancelled forever while reporting success).
    supabase.from("spa_appointments").select("id, guest_id, room_id, therapist_id, ezgo_line_id, start_time").eq("appointment_date", appointmentDate).neq("status", "cancelled"),
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
  const matchedExistingIds = new Set();
  const mealTimeByGuestId = new Map();

  for (const row of parsedRows) {
    const roomId = row.room_raw ? aliasMap.get(row.room_raw) ?? null : null;
    const candidates = row.phone ? guestsByPhone.get(row.phone) ?? [] : [];
    let { guest, suspicious, reason } = pickBestGuestMatch(
      candidates,
      appointmentDate,
      row.guest_name,
      row.group_label
    );
    let coupleFlag = false;

    // Auto-create a day_guest profile (Mike, locked decision) when no
    // existing guest matches this phone but the row carries real identity —
    // gated on a valid time range too, since a genuinely malformed row
    // (no time) already fails classifyUnresolvedReason before it can reach
    // here regardless. Idempotent within a batch: the newly-created guest is
    // pushed into guestsByPhone immediately so a second row this same batch
    // for the same phone (e.g. two treatments same day) finds it as a
    // candidate instead of creating a duplicate profile.
    // Display name prefers Hebrew paren person over Latin nickname so the
    // Golden Profile stays readable for staff / bot context.
    const displayName = resolveSpaGuestDisplayName(row.guest_name, row.group_label);
    if (!guest && row.start_time && row.end_time && displayName && PLAUSIBLE_ISRAELI_PHONE_RE.test(row.phone ?? "")) {
      const { data: newGuest, error: newGuestErr } = await supabase
        .from("guests")
        .insert({
          phone: `+${row.phone}`,
          name: displayName,
          room_type: "day_guest",
          room: "Premium Day 1",
          arrival_date: appointmentDate,
          departure_date: appointmentDate,
          status: "expected",
          ...(row.group_label ? { guest_profile: { couple_shared_phone: true } } : {}),
        })
        .select("id, name, phone, arrival_date, departure_date, status")
        .maybeSingle();
      if (newGuestErr) {
        console.error("[spaActivitiesSyncEngine] guest auto-create failed:", row.phone, newGuestErr.message);
      } else if (newGuest) {
        guest = newGuest;
        summary.guests_created++;
        if (!guestsByPhone.has(row.phone)) guestsByPhone.set(row.phone, []);
        guestsByPhone.get(row.phone).push(newGuest);
        // Group cell ("Name (Group)") means a companion shares this phone but
        // has no name/phone of their own to create a second profile from —
        // flag for staff instead of silently representing only one person
        // (Mike, locked decision: one profile + flag, never a guessed second).
        if (row.group_label) coupleFlag = true;
      }
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

    // Tracked before the unresolved-reason check (independent of whether
    // THIS row can be fully written) so a row that references an existing
    // appointment via ezgo_line_id still marks it "in file" even when some
    // other part of the row (room/guest) can't resolve — otherwise a
    // resolvable-but-partial row would wrongly count that appointment as
    // missing from the file. Therapist is resolved first so the natural-key
    // fallback can distinguish the two halves of a couple booking.
    const existing = matchExistingAppointment(row, roomId, guest?.id, apptIndex, therapistId);
    if (existing) matchedExistingIds.add(existing.id);

    const unresolvedReason = classifyUnresolvedReason(row, guest, roomId);
    if (unresolvedReason) {
      if (unresolvedReason === "room_unmapped") summary.room_unmapped++;
      summary.unmatched++;
      unmatched.push(unmatchedRow(batchId, appointmentDate, row, unresolvedReason));
      continue;
    }

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
    if (coupleFlag) {
      summary.suspicious++;
      unmatched.push({
        ...unmatchedRow(batchId, appointmentDate, row, "suspicious_shared_phone"),
        guest_name: `${row.guest_name ?? "—"} (זוג/קבוצה על טלפון אחד — פרופיל שני לא נוצר: "${row.group_label}")`,
      });
    }

    // Explicit meal time from this row's note/extras only (never board-basis
    // guessing) — earliest match across the batch wins per guest, actual
    // write (and the "never overwrite existing meal_time" check) happens in
    // the write-through pass below where guests.meal_time is already fetched.
    const mealTime = extractSpaMealTime([row.note, row.extras].filter(Boolean).join(" "));
    if (mealTime) {
      const prevMeal = mealTimeByGuestId.get(guest.id);
      if (!prevMeal || mealTime < prevMeal) mealTimeByGuestId.set(guest.id, mealTime);
    }
  }

  summary.not_in_file = (existingAppts ?? []).filter((a) => !matchedExistingIds.has(a.id)).length;

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

    const { data: guestRow } = await supabase.from("guests").select("guest_profile, meal_time").eq("id", guestId).maybeSingle();
    const patch = buildGuestSpaProfilePatch(guestRow?.guest_profile, {
      appointment_date: appointmentDate,
      start_time: earliest.start_time,
      end_time: earliest.end_time,
      treatment_type: earliest.treatment_type,
      ezgo_line_id: earliest.ezgo_line_id,
      room: roomNameById.get(earliest.room_id) ?? null,
      therapist: earliest.spa_therapists?.name ?? null,
    });

    const updatePayload = { spa_date: appointmentDate, spa_time: earliest.start_time, guest_profile: patch };
    // Never overwrite an existing meal_time (locked decision, Mike) — only
    // fill it when this batch found an explicit meal mention AND the guest
    // didn't already have one from the primary ops-report source.
    const mealTime = mealTimeByGuestId.get(guestId);
    if (mealTime && !guestRow?.meal_time) {
      updatePayload.meal_time = mealTime;
      summary.meal_time_set++;
    }

    const { error: guestErr } = await supabase.from("guests").update(updatePayload).eq("id", guestId);
    if (guestErr) console.warn("[spaActivitiesSyncEngine] guest write-through failed:", guestId, guestErr.message);
  }

  return summary;
}
