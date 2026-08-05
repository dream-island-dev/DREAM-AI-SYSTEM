// Central write gate for guest room/room_type consistency + duplicate
// prevention (Mike, P0 2026-08-05 — hermetic guest classification).
//
// Split-brain bug class this closes: a guest whose `room` is a canonical
// physical suite (SUITE_REGISTRY) ends up with room_type=day_guest/
// premium_day_guest (or vice versa — a day-pass row gets created for a phone
// that already has an active suite stay covering the date). Every path that
// INSERTs or UPDATEs a `guests` row's room/room_type/phone+arrival_date must
// call these asserts first — Fail Visible: throw with a Hebrew message
// staff can act on, never silently skip or half-write.
import { SUITE_REGISTRY } from "../data/suiteRegistry";
import { isCanonicalSuiteRoom, isEffectiveSuiteGuest } from "./pipelineSegment";
import { normalizeWhatsAppPhone } from "./ezgoParser";

export { isCanonicalSuiteRoom };

/** Canonical E.164-ish key for phone-equality checks — falls back to digits-only. */
export function normalizeGuestPhoneForLookup(phone) {
  if (!phone) return null;
  const e164 = normalizeWhatsAppPhone(phone);
  if (e164) return e164;
  const digits = String(phone).replace(/[^\d]/g, "");
  return digits || null;
}

/**
 * guests.phone is stored two ways across this codebase (CLAUDE.md §3):
 * "+972…" (guests table) vs bare digits "972…" (bookings/webhook). A lookup
 * that only tries one form misses the other and lets a split-brain profile
 * slip past the guard — so every DB query below tries both.
 */
function phoneLookupVariants(phone) {
  const normalized = normalizeGuestPhoneForLookup(phone);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  if (normalized.startsWith("+")) variants.add(normalized.slice(1));
  else variants.add(`+${normalized}`);
  return [...variants];
}

/** Throws when a canonical suite room is paired with a day-pass room_type. */
export function assertGuestSegmentConsistent({ room, room_type }) {
  const isDayType = room_type === "day_guest" || room_type === "premium_day_guest";
  if (isDayType && isCanonicalSuiteRoom(room)) {
    const typeLabel = room_type === "premium_day_guest" ? "Premium Day" : "בילוי יומי";
    throw new Error(
      `שילוב לא עקבי: "${room}" הוא חדר סוויטה קנוני אבל סוג האורח הוא ${typeLabel} — לא ניתן לשמור`,
    );
  }
}

/**
 * Hermetic day-pass create gate (moved here from ezgoMailLineWorkflow.js's
 * P1.5 2026-08-05 fix so every create path shares it, not just Doc1 mail
 * import). A mail/import/paste row can be mis-resolved as a day visit for a
 * guest who already has an active suite stay covering that date — that used
 * to insert a phantom "בילוי יומי" duplicate profile, split-brain with the
 * real suite profile. Window-overlap match (not exact arrival_date) so a
 * stray day-pass row anywhere inside an existing multi-night suite stay is
 * still caught, not just an exact-date collision.
 */
export async function assertNoConflictingSuiteProfile(supabase, phone, arrivalDate) {
  const variants = phoneLookupVariants(phone);
  if (!variants.length || !arrivalDate) return;
  const { data, error } = await supabase
    .from("guests")
    .select("id, name, room, room_type, arrival_date, departure_date")
    .in("phone", variants)
    .neq("status", "cancelled")
    .lte("arrival_date", arrivalDate)
    .or(`departure_date.is.null,departure_date.gte.${arrivalDate}`);
  if (error) throw error;
  const conflict = (data || []).find((g) => isEffectiveSuiteGuest(g));
  if (conflict) {
    throw new Error(
      `לא ניתן ליצור פרופיל בילוי יומי — קיים כבר פרופיל סוויטה פעיל (${conflict.name || phone}${conflict.room ? ` · ${conflict.room}` : ""}) לאותו טלפון בתאריך זה`,
    );
  }
}

/**
 * Catches a duplicate guest profile the DB's guests_phone_arrival_unique
 * constraint would NOT — that constraint only blocks an exact phone-string +
 * arrival_date collision, so a "+972…" vs "972…" formatting mismatch between
 * two creation paths still slips a second row past it.
 */
export async function assertNoDuplicateGuest(supabase, phone, arrivalDate, { excludeId } = {}) {
  const variants = phoneLookupVariants(phone);
  if (!variants.length || !arrivalDate) return;
  const { data, error } = await supabase
    .from("guests")
    .select("id, name, phone, arrival_date, status")
    .in("phone", variants)
    .eq("arrival_date", arrivalDate)
    .neq("status", "cancelled");
  if (error) throw error;
  const dup = (data || []).find((g) => g.id !== excludeId);
  if (dup) {
    throw new Error(
      `כבר קיים פרופיל אורח לאותו טלפון + תאריך הגעה (${dup.name || dup.phone} · ${arrivalDate}, מזהה #${dup.id})`,
    );
  }
}

/** Split-brain rows: room_type says day-pass but room is an actual physical suite. */
export async function fetchSplitBrainSuiteGuests(supabase) {
  if (!supabase) return { guests: [], error: null };
  const { data, error } = await supabase
    .from("guests")
    .select("id, name, phone, room, room_type, status, arrival_date, departure_date")
    .in("room_type", ["day_guest", "premium_day_guest"])
    .order("arrival_date", { ascending: false });
  if (error) return { guests: [], error };
  const guests = (data ?? []).filter((g) => isCanonicalSuiteRoom(g.room));
  return { guests, error: null };
}

/** Bulk-fix: flip mistagged rows to room_type='suite'. Never touches room/status/checked_in. */
export async function bulkFixSplitBrainSuiteGuests(supabase, guestIds) {
  if (!supabase || !guestIds?.length) return { updated: 0, error: null };
  const { error } = await supabase
    .from("guests")
    .update({ room_type: "suite" })
    .in("id", guestIds);
  if (error) return { updated: 0, error };
  return { updated: guestIds.length, error: null };
}

function staysOverlap(a, b) {
  const aArr = a.arrival_date;
  const aDep = a.departure_date || a.arrival_date;
  const bArr = b.arrival_date;
  const bDep = b.departure_date || b.arrival_date;
  if (!aArr || !bArr) return false;
  return aArr <= bDep && bArr <= aDep;
}

/**
 * Same normalized phone + overlapping stay window across 2+ guests rows —
 * a duplicate profile pair for staff to review and delete one side of
 * (never auto-deletes — Fail Visible, human picks which row survives).
 * Bounded to a date window so this stays a cheap scan on a boutique-resort
 * table, not a full-history crawl.
 */
export async function fetchDuplicateGuestPairs(supabase, { fromDate, toDate } = {}) {
  if (!supabase) return { pairs: [], error: null };
  let query = supabase
    .from("guests")
    .select("id, name, phone, room, room_type, status, arrival_date, departure_date")
    .not("phone", "is", null)
    .not("arrival_date", "is", null)
    .neq("status", "cancelled");
  if (fromDate) query = query.gte("arrival_date", fromDate);
  if (toDate) query = query.lte("arrival_date", toDate);
  const { data, error } = await query.order("arrival_date", { ascending: false });
  if (error) return { pairs: [], error };

  const byPhone = new Map();
  for (const g of data ?? []) {
    const key = normalizeGuestPhoneForLookup(g.phone);
    if (!key) continue;
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key).push(g);
  }

  const pairs = [];
  for (const rows of byPhone.values()) {
    if (rows.length < 2) continue;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (staysOverlap(rows[i], rows[j])) {
          pairs.push([rows[i], rows[j]]);
        }
      }
    }
  }
  return { pairs, error: null };
}

/** Wraps delete_guest_profile RPC (migration 141) — cancels pending tasks, hard-deletes the row. */
export async function deleteGuestProfileById(supabase, guestId) {
  if (!supabase || !guestId) return { ok: false, error: "missing_guest_id" };
  const { data, error } = await supabase.rpc("delete_guest_profile", { p_guest_id: guestId });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error || "unknown_error" };
  return { ok: true, phone: data.phone, name: data.name };
}

// Re-export for callers that only need the registry (avoids a second import).
export { SUITE_REGISTRY };
