// src/utils/guestImportIntelligence.js
// ── Guest Import Intelligence Layer — canonical contract (Sprint 0) ──────────
// Pure data transformation — zero Supabase calls, zero side effects, zero DOM.
//
// Purpose: merge the three raw guest-import sources this app already parses
// separately —
//   "arrivals" — Suite CSV rows already run through ezgoParser.js's
//                extractGuestDetails(row, columnMapping) (remark/coordinator
//                phone+name cascade, one candidate per CSV row — never merged
//                by order number, see ezgoParser.js's row-index-keyed
//                aggregation for why)
//   "ops"      — the Doc1 "Daily Report" order-line format ("N: name - phone",
//                see ArrivalImportPanel.js's parseComprehensiveReport/
//                _orderLineFromCell). Accepts either a raw line string or an
//                already-parsed record shaped like parseComprehensiveReport's
//                output ({order_number, guest_name, phone, ...}).
//   "detailed" — rows from detailedReservationParser.js's
//                parseDetailedReservationRows() (structured PMS export —
//                its own standalone, authoritative import path)
// — into one canonical GuestImportCandidate[] the DB-write layer can classify
// against existing `guests` rows.
//
// This file does NOT replace ezgoParser.js/detailedReservationParser.js's
// row-level extraction — it consumes their output and layers cross-source
// merge + real-vs-noise classification on top (municipal/corporate "umbrella"
// group bookings that arrive with a placeholder phone and a room count
// instead of a real individual guest).
//
// Sprint 0 scope: build the contract + pure helpers. ArrivalImportPanel.js
// and ezgoParser.js are NOT wired to this file yet — that is a later sprint.

import { extractPhonesFromText, extractNameFromRemark } from "./ezgoParser";

// ─────────────────────────────────────────────────────────────────────────────
// § TYPES (JSDoc only — this codebase has no TypeScript on the frontend)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} GuestImportCandidate
 * @property {string|null} guestName        - resolved display name
 * @property {string|null} guestPhone       - resolved E.164 phone, or null when unresolvable
 * @property {string|null} _rawPhone        - best-effort raw phone-ish value even when it
 *                                             failed E.164 normalization (dummy/placeholder
 *                                             detection needs this — a normalized-away dummy
 *                                             like "111" must not silently look like "no phone
 *                                             at all", it must still register as a REAL dummy)
 * @property {string|null} phoneSource      - "individual" | "coordinator" | null
 * @property {string|null} orderNumber      - PMS order/reservation number (primary cross-source join key)
 * @property {string|null} resLineId        - globally unique room-line id (arrivals/detailed only)
 * @property {string|null} room             - suite/room label — arrivals-only field (see FIELD_SOURCE_PRIORITY.room)
 * @property {string|null} arrivalDate      - ISO "YYYY-MM-DD"
 * @property {string|null} spa_time         - ops-only field (see FIELD_SOURCE_PRIORITY.spa)
 * @property {number}      treatment_count
 * @property {string|null} meal_time
 * @property {string|null} meal_location
 * @property {number|null} price
 * @property {number|null} nights
 * @property {number}      roomsCount       - rooms under this order/coordinator — feeds isUmbrellaRow()
 * @property {boolean}     isDayGuest
 * @property {string|null} leadSource
 * @property {boolean}     automationMuted
 * @property {Object}      _sources         - which raw source(s) contributed, e.g. { arrivals:true, ops:true }
 * @property {Object}      _fieldOrigins    - diagnostic: which source last won each merged field
 */

/**
 * Per-field cross-source priority order. Read as "left wins over right when
 * both sources have a usable value for this field." Categories mirror the
 * fields a GuestImportCandidate actually carries — not every source
 * contributes every category (e.g. only "arrivals" ever carries `room`).
 *
 * The merge rules in mergeCandidates() are hand-written to match this table
 * rather than routed through a generic priority-dispatch engine — with only
 * three known sources and a handful of fields, a dynamic dispatcher would be
 * more machinery than the problem currently needs (see FIELD_SOURCE_PRIORITY
 * usage in mergeCandidates()/resolveIdentity() below for where each row is
 * actually applied). Revisit if a 4th source or many more fields show up.
 */
export const FIELD_SOURCE_PRIORITY = {
  identity: ["remark", "ops", "detailed"],
  room: ["arrivals"],
  spa: ["ops"],
  meal: ["ops", "detailed"],
  price: ["detailed", "arrivals"],
  nights: ["detailed", "arrivals"],
  lead_source: ["detailed", "arrivals"],
  automation_muted: ["detailed", "arrivals"],
};

// ─────────────────────────────────────────────────────────────────────────────
// § DUMMY / CORPORATE / UMBRELLA DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const REPEATED_DIGIT_RE = /^(\d)\1+$/;

/**
 * True when `phone` is missing, too short, or an obviously-repeated
 * placeholder digit sequence — the kind of value municipal/corporate group
 * bookings use in a phone column instead of a real guest number ("111",
 * "0000000000", etc). Deliberately generous: a false "dummy" just routes a
 * row to human review (unimportable), it never silently drops real data.
 */
export function isDummyPhone(phone) {
  if (phone == null || phone === "") return true;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 7) return true;
  if (REPEATED_DIGIT_RE.test(digits)) return true;
  return false;
}

// Hebrew institutional/corporate name prefixes — municipalities, nonprofits,
// companies, schools, government offices. A booking coordinator named this
// way is a group organizer, not an individual guest.
const CORPORATE_NAME_PREFIXES = [
  "עיריית", "עיירית", "עירייה", "עיריה",
  "עמותת", "עמותה",
  "חברת", "חברה",
  "מועצה מקומית", "מועצת", "מועצה",
  "משרד",
  "בית ספר", "ביה\"ס",
  "ארגון",
  "מוסד",
  "בנק לאומי",
];

/** True when `name` starts with a recognized corporate/institutional prefix. */
export function isCorporateName(name) {
  if (!name) return false;
  const s = String(name).trim();
  return CORPORATE_NAME_PREFIXES.some((p) => s.startsWith(p));
}

/**
 * True when a row represents a group/institutional "umbrella" booking rather
 * than a single guest — a placeholder phone AND (a corporate-looking name OR
 * more than one room under it). Requires the dummy-phone signal first: a real
 * individual guest can share a surname with a company or book many rooms for
 * family reasons, but a REAL phone number rules out "this is just noise."
 */
export function isUmbrellaRow({ phone, roomsCount, name } = {}) {
  if (!isDummyPhone(phone)) return false;
  const corporate = isCorporateName(name);
  const manyRooms = Number(roomsCount) > 1;
  return corporate || manyRooms;
}

// ─────────────────────────────────────────────────────────────────────────────
// § IDENTITY RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merges same-guest identity fragments coming from different import sources
 * into one resolved identity, per FIELD_SOURCE_PRIORITY.identity
 * (remark > ops > detailed). Only a fragment with a non-dummy phone can win
 * the phone slot; a dummy-phone fragment can still supply a fallback name
 * when nothing better is available, but never wins outright.
 *
 * @param {Array<{source:string, name?:string|null, phone?:string|null}>} fragments
 * @returns {{ name: string|null, phone: string|null, source: string|null }}
 */
export function resolveIdentity(fragments = []) {
  const priority = FIELD_SOURCE_PRIORITY.identity;
  const rank = (source) => {
    const i = priority.indexOf(source);
    return i === -1 ? priority.length : i;
  };

  const usable = fragments
    .filter((f) => f && !isDummyPhone(f.phone))
    .sort((a, b) => rank(a.source) - rank(b.source));

  const winner = usable[0] ?? null;
  const bestName = winner?.name ?? fragments.find((f) => f?.name)?.name ?? null;

  return {
    name: bestName,
    phone: winner?.phone ?? null,
    source: winner?.source ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § SOURCE → FRAGMENT NORMALIZERS (internal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits an ops order-line's free-text tail ("name - phone") using the exact
 * same IL-mobile regex ezgoParser.js uses for remark parsing — no second
 * phone dialect invented here. Falls back to a raw name/phone guess (used
 * only for diagnostics, never treated as a usable identity) when no
 * recognizable IL mobile is present in the tail.
 */
function _splitOpsNamePhone(text) {
  const phones = extractPhonesFromText(text);
  const name = extractNameFromRemark(text);
  if (phones.length > 0 && name) {
    return { name, phone: phones[0] };
  }
  const dashIdx = text.lastIndexOf(" - ");
  const rawName = dashIdx >= 0 ? text.slice(0, dashIdx).trim() : text.trim();
  const rawPhone = dashIdx >= 0 ? text.slice(dashIdx + 3).trim() : null;
  return { name: rawName || null, phone: null, _rawPhone: rawPhone };
}

/**
 * Normalizes one "ops" input — either a raw "N: name - phone" line, or an
 * already-parsed record shaped like ArrivalImportPanel.js's
 * parseComprehensiveReport() output — into a common fragment shape.
 */
function _opsInputToFragment(input) {
  if (typeof input === "string") {
    const m = input.match(/^\s*(\d+)\s*:\s*(.+)$/);
    const orderNumber = m ? m[1] : null;
    const rest = (m ? m[2] : input).trim();
    const { name, phone, _rawPhone } = _splitOpsNamePhone(rest);
    return {
      orderNumber,
      guestName: name,
      guestPhone: phone,
      _rawPhone: phone ?? _rawPhone ?? null,
      arrivalDate: null,
      spa_time: null,
      treatment_count: 0,
      meal_time: null,
      meal_location: null,
    };
  }
  return {
    orderNumber: input.order_number ?? input.orderNumber ?? null,
    guestName: input.guest_name ?? input.guestName ?? null,
    guestPhone: input.phone ?? input.guestPhone ?? null,
    _rawPhone: input.phone ?? input.guestPhone ?? null,
    arrivalDate: input.arrival_date ?? input.arrivalDate ?? null,
    spa_time: input.spa_time ?? null,
    treatment_count: input.treatment_count ?? 0,
    meal_time: input.meal_time ?? null,
    meal_location: input.meal_location ?? null,
  };
}

/** Normalizes one detailedReservationParser.js row into a common fragment shape. */
function _detailedInputToFragment(row) {
  return {
    orderNumber: row.orderNumber || null,
    resLineId: row.resLineId || null,
    guestName: row.guestName ?? null,
    guestPhone: row.guestPhone ?? null,
    _rawPhone: row.guestPhone ?? null,
    arrivalDate: row.arrivalDate ?? null,
    price: row.price ?? null,
    nights: row.nights ?? null,
    roomsCount: row.rooms_count ?? row.roomsCount ?? null,
    meal_location: row.meal_location ?? null,
    leadSource: row.leadSource ?? null,
    automationMuted: !!row.automationMuted,
    isDayGuest: !!row.isDayGuest,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § MERGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mergeCandidates({ arrivals, ops, detailed })
 *
 * @param {object} sources
 * @param {object[]} [sources.arrivals] - ezgoParser.js's extractGuestDetails() output, one per CSV row
 * @param {(string|object)[]} [sources.ops] - raw "N: name - phone" lines, or parseComprehensiveReport()-shaped records
 * @param {object[]} [sources.detailed] - detailedReservationParser.js's parseDetailedReservationRows().rows
 * @returns {GuestImportCandidate[]}
 */
export function mergeCandidates({ arrivals = [], ops = [], detailed = [] } = {}) {
  const byOrder = new Map(); // orderNumber → candidate[], for ops/detailed enrichment joins

  // ── 1. Arrivals — the authoritative, Zero-Data-Loss source. One candidate
  // per row, never collapsed with a sibling row sharing an order number (a
  // group booking's individual occupants must stay distinct — mirrors
  // ezgoParser.js's row-index-keyed aggregation). roomsCount defaults to how
  // many arrivals rows share this order, but an explicit row.roomsCount
  // (e.g. a summary row's own "rooms" column) always wins — that is what a
  // municipal umbrella booking looks like: one row, an explicit room count. ──
  const roomsByOrder = new Map();
  for (const row of arrivals) {
    const orderNumber = row.orderNumber || null;
    if (orderNumber) roomsByOrder.set(orderNumber, (roomsByOrder.get(orderNumber) ?? 0) + 1);
  }

  const candidates = [];

  for (const row of arrivals) {
    const orderNumber = row.orderNumber || null;
    const roomsCount = row.roomsCount ?? (orderNumber ? roomsByOrder.get(orderNumber) : 1) ?? 1;
    const candidate = {
      guestName: row.guestName ?? null,
      guestPhone: row.guestPhone ?? null,
      _rawPhone: row.guestPhone ?? row.coordPhone ?? null,
      phoneSource: row.phoneSource ?? null,
      orderNumber,
      resLineId: row.resLineId || null,
      room: row.roomName || row.suiteType || null,
      arrivalDate: row.arrivalDate ?? null,
      spa_time: null,
      treatment_count: 0,
      // ezgoParser.js's extractGuestDetails() best-effort remark-shorthand
      // extraction ("א. ערב 19:30") — a real value here beats the null every
      // other source starts from; the ops enrichment loop below can still
      // overwrite it (earliest-wins merge) when a Doc1 record also carries one.
      meal_time: row.mealTime ?? null,
      meal_location: null,
      price: row.price ?? null,
      nights: row.nights ?? null,
      roomsCount,
      isDayGuest: !!row.isDayGuest,
      leadSource: row.leadSource ?? null,
      automationMuted: !!row.automationMuted,
      _sources: { arrivals: true },
      _fieldOrigins: { identity: "remark" },
    };
    candidates.push(candidate);
    if (orderNumber) {
      if (!byOrder.has(orderNumber)) byOrder.set(orderNumber, []);
      byOrder.get(orderNumber).push(candidate);
    }
  }

  // ── 2. Ops (Doc1 daily report) — enrichment-first, per FIELD_SOURCE_PRIORITY.spa
  // (ops is the only source that ever carries spa_time) and .meal (ops beats
  // detailed — this loop runs first, and detailed below only fills meal_location
  // when still blank). Joins every arrivals candidate under a shared order
  // number (same convention as ezgoParser.js's enrichProfilesFromExcel). Only
  // spawns a standalone candidate when it carries a real, resolvable phone —
  // ops never originates guest rows in the live pipeline today (it purely
  // enriches an existing doc2 profile map), so a dummy/unreadable ops line
  // with nothing to attach to is dropped, not surfaced as a row of its own. ──
  for (const raw of ops) {
    const frag = _opsInputToFragment(raw);
    const matches = frag.orderNumber ? byOrder.get(frag.orderNumber) : null;

    if (matches?.length) {
      for (const c of matches) {
        if (frag.spa_time && (!c.spa_time || frag.spa_time < c.spa_time)) c.spa_time = frag.spa_time;
        c.treatment_count += frag.treatment_count || 0;
        if (frag.meal_time && (!c.meal_time || frag.meal_time < c.meal_time)) c.meal_time = frag.meal_time;
        if (frag.meal_location && !c.meal_location) c.meal_location = frag.meal_location;

        const identity = resolveIdentity([
          { source: "remark", name: c.guestName, phone: c.guestPhone },
          { source: "ops", name: frag.guestName, phone: frag.guestPhone },
        ]);
        c.guestName = identity.name;
        c.guestPhone = identity.phone;
        c._fieldOrigins.identity = identity.source ?? c._fieldOrigins.identity;

        c._sources.ops = true;
      }
      continue;
    }

    if (!isDummyPhone(frag.guestPhone) && frag.guestPhone) {
      candidates.push({
        guestName: frag.guestName,
        guestPhone: frag.guestPhone,
        _rawPhone: frag._rawPhone,
        phoneSource: "individual",
        orderNumber: frag.orderNumber,
        resLineId: null,
        room: null,
        arrivalDate: frag.arrivalDate,
        spa_time: frag.spa_time,
        treatment_count: frag.treatment_count,
        meal_time: frag.meal_time,
        meal_location: frag.meal_location,
        price: null,
        nights: null,
        roomsCount: 1,
        isDayGuest: false,
        leadSource: null,
        automationMuted: false,
        _sources: { ops: true },
        _fieldOrigins: { identity: "ops" },
      });
    }
    // else: no matching arrivals row AND no usable phone → not a profile, dropped.
  }

  // ── 3. Detailed reservation report — a complete, standalone import path in
  // its own right (ArrivalImportPanel.js's importSource==="detailed" mode),
  // so unlike ops it DOES spawn its own candidate when nothing else claims
  // it. price/nights/lead_source/automation_muted all prioritize detailed
  // over arrivals per FIELD_SOURCE_PRIORITY — overwritten unconditionally
  // when detailed provides a value. ──
  for (const row of detailed) {
    const frag = _detailedInputToFragment(row);
    const matches = frag.orderNumber ? byOrder.get(frag.orderNumber) : null;

    if (matches?.length) {
      for (const c of matches) {
        if (frag.price != null) c.price = frag.price;
        if (frag.nights != null) c.nights = frag.nights;
        if (frag.meal_location && !c.meal_location) c.meal_location = frag.meal_location;
        if (frag.leadSource) {
          c.leadSource = frag.leadSource;
          c.automationMuted = frag.automationMuted;
        }
        c._sources.detailed = true;
      }
      continue;
    }

    candidates.push({
      guestName: frag.guestName,
      guestPhone: frag.guestPhone,
      _rawPhone: frag._rawPhone,
      phoneSource: "individual",
      orderNumber: frag.orderNumber,
      resLineId: frag.resLineId,
      room: null,
      arrivalDate: frag.arrivalDate,
      spa_time: null,
      treatment_count: 0,
      meal_time: null,
      meal_location: frag.meal_location,
      price: frag.price,
      nights: frag.nights,
      roomsCount: frag.roomsCount ?? 1,
      isDayGuest: frag.isDayGuest,
      leadSource: frag.leadSource,
      automationMuted: frag.automationMuted,
      _sources: { detailed: true },
      _fieldOrigins: { identity: "detailed" },
    });
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// § DB-MATCH CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * classifyDbMatch(candidate, existingGuestRow)
 *
 * @param {GuestImportCandidate} candidate
 * @param {{phone?:string, name?:string, room?:string, order_number?:string, arrival_date?:string}|null} existingGuestRow
 * @returns {"new"|"existing"|"conflict"|"unimportable"}
 */
export function classifyDbMatch(candidate, existingGuestRow) {
  if (!candidate) return "unimportable";

  const umbrella = isUmbrellaRow({
    phone: candidate._rawPhone ?? candidate.guestPhone,
    roomsCount: candidate.roomsCount,
    name: candidate.guestName,
  });
  if (umbrella || (!candidate.guestPhone && !candidate.guestName)) {
    return "unimportable";
  }

  if (!existingGuestRow) return "new";

  const phoneMatches = !!candidate.guestPhone && candidate.guestPhone === existingGuestRow.phone;
  const orderMatches = !!candidate.orderNumber && candidate.orderNumber === existingGuestRow.order_number;
  if (!phoneMatches && !orderMatches) return "new";

  const nameConflict =
    !!candidate.guestName && !!existingGuestRow.name &&
    candidate.guestName.trim() !== String(existingGuestRow.name).trim();
  const roomConflict =
    !!candidate.room && !!existingGuestRow.room &&
    candidate.room.trim() !== String(existingGuestRow.room).trim();
  const dateConflict =
    !!candidate.arrivalDate && !!existingGuestRow.arrival_date &&
    candidate.arrivalDate !== existingGuestRow.arrival_date;

  return (nameConflict || roomConflict || dateConflict) ? "conflict" : "existing";
}
