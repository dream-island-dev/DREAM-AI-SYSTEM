// src/utils/ezgoParser.js
// ── EZGO Guest Extraction & Golden Guest Profile Aggregation ─────────────────
// Pure data transformation — zero Supabase calls, zero side effects.
// Called from DataUpload.js during the SUITE CSV import preview step.
//
// Two-stage pipeline:
//   Stage 1: extractGuestDetails(row)  — per-row, resolves TRUE identity
//   Stage 2: aggregateGuestProfiles()  — merges all rows into keyed profile Map
//   Stage 3: enrichProfilesFromExcel() — injects spa_time by order_number join

// ─────────────────────────────────────────────────────────────────────────────
// § REGEX
// ─────────────────────────────────────────────────────────────────────────────

// Israeli mobile — matches ALL formats found in EZGO sRemark:
//   052-5778390      → prefix (3) + dash + block3 + block4
//   0526651629       → 10 digits, no separator
//   054-5252850      → standard with dash
//   0502302181       → 050 prefix, no separator
//   052-6651626      → with trailing space (handled by (?!\d))
//
// Capture group [1] = full matched number (raw, with any dashes/spaces).
// The (?!\d) negative lookahead prevents matching the middle of a longer number.
//
// NOT matched: +972-52-... (international prefix) — not present in EZGO sRemark.
// If needed, add: /\+972[-. ]?5\d[-. ]?\d{7}/ as a second pass.
const IL_MOBILE_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/g;

// EZGO booking source aliases to strip from name strings
// (same pattern as ARRIVALS_SOURCE_RE in DataUpload.js)
const SOURCE_RE = /^(Hotel\s+WebSite|Booking\s+Collect|Booking\.com|Booking|Expedia|Hotels\.com)\s*-\s*/i;

// EZGO dummy date sentinel — "01/01/2001" means "no real date assigned"
const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;

// ─────────────────────────────────────────────────────────────────────────────
// § PHONE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes any matched IL_MOBILE_RE capture to E.164 "+972XXXXXXXXX".
 *
 * EZGO sRemark phones always have a leading "0" (domestic format).
 * EZGO sTel1 phones OMIT the leading "0" (9 digits starting with "5").
 * Both cases are handled here.
 */
function normalizeILMobile(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `+972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5"))  return `+972${digits}`;
  return null;
}

/**
 * Extracts every valid Israeli mobile number from arbitrary text.
 * Returns an array of E.164 strings, deduped.
 * Returns [] when none found.
 */
export function extractPhonesFromText(text) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  for (const m of text.matchAll(IL_MOBILE_RE)) {
    const e164 = normalizeILMobile(m[1]);
    if (e164) out.push(e164);
  }
  return [...new Set(out)];
}

// ─────────────────────────────────────────────────────────────────────────────
// § NAME HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the guest name from an EZGO sRemark string.
 *
 * EZGO sRemark formats observed:
 *   "מוחמד עדילה/ ראמי עדילה052-5778390"     → name before the phone (no separator)
 *   "יוסי יוסף / איגור גרינבאום - 0526651629"  → name + " - " + phone
 *   "גלעד אהרוני /מתן טויטו - 054-5252850"     → "/" as name separator
 *   "ארז לבנון+ חגיי קריק 0526651633"          → "+" as name separator
 *   "מור דורו 0502302181"                       → space before phone
 *
 * Algorithm:
 *   1. Find the phone in the string using IL_MOBILE_RE
 *   2. Take everything BEFORE that match position
 *   3. Strip trailing separators (" - ", " / ", " + ", space)
 *   4. Clean internal multi-slash sequences to a single " / "
 */
export function extractNameFromRemark(remark) {
  if (!remark || typeof remark !== "string") return null;
  const s = remark.trim();

  const phoneMatch = IL_MOBILE_RE.exec(s);
  // Reset lastIndex so repeated calls don't interfere
  IL_MOBILE_RE.lastIndex = 0;

  if (!phoneMatch) {
    return null; // sRemark without a phone is NOT a name source
  }

  const namePart = s.slice(0, phoneMatch.index);
  // Strip trailing noise: dashes, slashes, plus signs, spaces
  const clean = namePart.replace(/[\s\-+/|,;]+$/, "").trim();
  return clean || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// § DATE HELPER (inline — mirrors parseEzgoDate from DataUpload.js)
// ─────────────────────────────────────────────────────────────────────────────

function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  if (!s || DUMMY_DATE_RE.test(s)) return null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 40000) {
    const d = new Date(Math.round((serial - 25569) * 86_400_000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// § STAGE 1 — PER-ROW EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * extractGuestDetails(row, fallbackDate?)
 *
 * Takes one raw EZGO SUITE CSV row (SheetJS object) and resolves the TRUE
 * guest identity using a priority cascade:
 *
 *   Phone priority:
 *     1. sRemark phone          ← actual room occupant (individual)
 *     2. sOperationRemark phone ← secondary notes (occasional)
 *     3. sTel1                  ← booking coordinator (group) / direct for solo
 *
 *   Name priority:
 *     1. Name extracted from sRemark (before the phone)
 *     2. Name extracted from sOperationRemark
 *     3. sClientFullName / sGroupName (coordinator / booking name)
 *
 * Returns a GuestProfile object (no DB writes — pure transform).
 *
 * @param {object} row         - SheetJS-parsed EZGO CSV row
 * @param {string} fallbackDate - ISO date from filename ("2026-06-18"), used
 *                               when dtCheckIn is absent or a dummy sentinel
 */
export function extractGuestDetails(row, fallbackDate = null) {
  // ── Raw field extraction ─────────────────────────────────────────────────
  const orderNumber  = String(row.iOrderId             ?? "").trim();
  const resLineId    = String(row.iReservationsLineId   ?? "").trim(); // globally unique PMS ID
  const seqLineId    = String(row.iResLineId            ?? "").trim(); // sequential within booking
  const roomName     = String(row.sRoomName             ?? "").trim();
  const suiteType    = String(row.sSubItemName          ?? "").trim();
  const coordNameRaw = String(row.sClientFullName       ?? row.sGroupName ?? "").trim();
  const coordPhoneRaw= String(row.sTel1                 ?? "").trim();
  const remark       = String(row.sRemark               ?? "").trim();
  const opRemark     = String(row.sOperationRemark      ?? "").trim();
  const adults       = parseInt(row.iAdults ?? "1") || 1;
  const children     = parseInt(row.iChilds ?? "0") || 0;
  const nights       = parseInt(row.iNights ?? "0") || 0;
  const checkinTime  = String(row.sCheckInTime  ?? "").trim() || null;
  const checkoutTime = String(row.sCheckOutTime ?? "").trim() || null;
  const groupId      = parseInt(row.Group_Id    ?? "0");
  const price        = parseFloat(row.cPrice    ?? "0") || 0;

  // ── Arrival date ─────────────────────────────────────────────────────────
  const arrivalDate = parseDate(row.dtCheckIn) ?? fallbackDate;

  // ── Coordinator phone (sTel1 — may be 9-digit without leading 0) ─────────
  const coordE164 = normalizeILMobile(
    /^\d{9}$/.test(coordPhoneRaw) ? `0${coordPhoneRaw}` : coordPhoneRaw
  );

  // ── Phone priority cascade ────────────────────────────────────────────────
  const remarkPhones   = extractPhonesFromText(remark);
  const opRemarkPhones = extractPhonesFromText(opRemark);

  let guestPhone;
  let phoneSource; // "individual" | "coordinator"

  if (remarkPhones.length > 0) {
    guestPhone   = remarkPhones[0];
    phoneSource  = "individual";
  } else if (opRemarkPhones.length > 0) {
    guestPhone   = opRemarkPhones[0];
    phoneSource  = "individual";
  } else {
    guestPhone   = coordE164;
    phoneSource  = "coordinator";
  }

  // ── Name priority cascade ─────────────────────────────────────────────────
  const remarkName    = extractNameFromRemark(remark) ?? extractNameFromRemark(opRemark);
  const coordName     = coordNameRaw.replace(SOURCE_RE, "").trim() || null;
  const guestName     = remarkName ?? coordName;

  // ── Category detection ────────────────────────────────────────────────────
  const isDayGuest = (
    groupId === 1                              // EZGO day-guest flag
    || nights === 0                            // zero nights = same-day
    || /premium\s*day|day\s*guest|בילוי.*יומי/i.test(suiteType)
  );

  // A booking is "group-level" when no individual phone was found and the
  // coordinator manages multiple rooms under the same sTel1.
  const isGroupCoordinator = (phoneSource === "coordinator");

  return {
    // ── Identifiers ──────────────────────────────────────────────────────
    orderNumber,
    resLineId,          // globally unique per room — the safe upsert key
    seqLineId,          // position within booking (iResLineId)

    // ── Room ─────────────────────────────────────────────────────────────
    roomName,           // "8", "21 סוויטה נגישה", "חבילת פרימיום בילוי יומי"
    suiteType,          // "סוויטת אמטיסט", "Premium Day 2"

    // ── TRUE identity (resolved) ─────────────────────────────────────────
    guestName,          // actual occupant name or coordinator name
    guestPhone,         // E.164 — individual occupant or coordinator fallback
    coordPhone: coordE164,
    phoneSource,        // "individual" | "coordinator"

    // ── Booking details ───────────────────────────────────────────────────
    adults,
    children,
    nights,
    arrivalDate,        // ISO "2026-06-18" or null
    checkinTime,        // "10:00" or null
    checkoutTime,       // "19:00" or null
    price,

    // ── Category ─────────────────────────────────────────────────────────
    isDayGuest,
    isGroupCoordinator,

    // ── Raw originals (keep for diagnostics / future audit) ──────────────
    _remark:    remark    || null,
    _opRemark:  opRemark  || null,
    _coordName: coordName || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § STAGE 2 — PROFILE AGGREGATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * aggregateGuestProfiles(rows, fallbackDate?)
 *
 * Processes ALL rows from the SUITE CSV and merges them into one unified
 * in-memory profile per TRUE phone number.
 *
 * Key merge rules:
 *   - Individual phone (from sRemark) ALWAYS gets its own separate profile.
 *   - Coordinator phone is used ONLY when no individual phone is found.
 *   - Multiple rooms under one coordinator phone are all grouped together.
 *   - orderNumbers is a Set so the Excel enrichment step can do a correct JOIN.
 *
 * Returns: Map<E164_or_fallbackKey, ConsolidatedProfile>
 *
 * Example output for group booking 266932, room 8 occupant:
 * {
 *   guestPhone:   "+972525778390",
 *   coordPhone:   "+972548340919",
 *   guestName:    "מוחמד עדילה / ראמי עדילה",
 *   phoneSource:  "individual",
 *   arrivalDate:  "2026-06-18",
 *   rooms: [{ roomName:"8", suiteType:"סוויטת אמטיסט", adults:2, ... }],
 *   orderNumbers: Set {"266932"},
 *   hasSuite:     true,
 *   hasDayBooking:false,
 *   spa_time:     null,           ← populated by enrichProfilesFromExcel()
 *   treatment_count: 0,
 * }
 */
export function aggregateGuestProfiles(rows, fallbackDate = null) {
  const profiles = new Map();

  for (const row of rows) {
    const g = extractGuestDetails(row, fallbackDate);
    if (!g.guestPhone && !g.guestName) continue;

    // Stable key: prefer phone (E.164), fall back to resLineId (globally unique PMS ID)
    // so every phoneless row gets its own profile — never silently merge two separate rooms
    const key = g.guestPhone ?? `res:${g.resLineId || g.seqLineId || Math.random()}`;

    if (!profiles.has(key)) {
      profiles.set(key, {
        // Identity (set on first encounter — individual phone wins)
        guestPhone:        g.guestPhone,
        coordPhone:        g.coordPhone,
        guestName:         g.guestName,
        phoneSource:       g.phoneSource,
        arrivalDate:       g.arrivalDate,
        isDayGuest:        g.isDayGuest,

        // Rooms belonging to this profile
        rooms:             [],

        // All order numbers seen — used for Excel spa-time JOIN
        orderNumbers:      new Set(),

        // Category roll-up
        hasSuite:          false,
        hasDayBooking:     false,

        // Enrichment slots (Stage 3 populates these)
        spa_time:          null,
        treatment_count:   0,
        treatment_type:    null,
        meal_plan:         null,
      });
    }

    const profile = profiles.get(key);

    // Keep first non-null arrival date; individual phone takes precedence
    if (!profile.arrivalDate && g.arrivalDate) profile.arrivalDate = g.arrivalDate;
    if (g.phoneSource === "individual" && profile.phoneSource !== "individual") {
      profile.guestName  = g.guestName;
      profile.phoneSource = "individual";
    }

    // Collect order numbers (Set prevents duplicates)
    if (g.orderNumber) profile.orderNumbers.add(g.orderNumber);

    // Append room to this guest's profile
    profile.rooms.push({
      resLineId:   g.resLineId,
      orderNumber: g.orderNumber,
      roomName:    g.roomName,
      suiteType:   g.suiteType,
      adults:      g.adults,
      children:    g.children,
      nights:      g.nights,
      checkinTime: g.checkinTime,
      checkoutTime: g.checkoutTime,
      price:       g.price,
      isDayGuest:  g.isDayGuest,
    });

    // Category roll-up
    if (g.isDayGuest) profile.hasDayBooking = true;
    else              profile.hasSuite       = true;
  }

  return profiles;
}

// ─────────────────────────────────────────────────────────────────────────────
// § STAGE 3 — EXCEL ENRICHMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * enrichProfilesFromExcel(profiles, excelRecords)
 *
 * Merges spa_time and treatment data from the comprehensive Excel report
 * (parsed by parseComprehensiveReport() in DataUpload.js) into the in-memory
 * profiles built by aggregateGuestProfiles().
 *
 * JOIN strategy: profile.orderNumbers ∩ excelRecord.order_number
 *   - One order may span multiple rooms → all those rooms get the same spa_time
 *   - When multiple Excel records match, keep earliest spa_time, sum treatment_count
 *
 * Mutates profiles Map in place. Returns the same Map.
 */
export function enrichProfilesFromExcel(profiles, excelRecords) {
  // Index Excel by order_number for O(1) lookup
  const excelByOrder = new Map();
  for (const rec of excelRecords) {
    if (!rec.order_number) continue;
    if (!excelByOrder.has(rec.order_number)) {
      excelByOrder.set(rec.order_number, rec);
    } else {
      // Merge: keep earliest time, sum counts
      const ex = excelByOrder.get(rec.order_number);
      if (rec.spa_time && (!ex.spa_time || rec.spa_time < ex.spa_time)) ex.spa_time = rec.spa_time;
      ex.treatment_count = (ex.treatment_count ?? 0) + (rec.treatment_count ?? 0);
    }
  }

  for (const profile of profiles.values()) {
    for (const orderNum of profile.orderNumbers) {
      const rec = excelByOrder.get(orderNum);
      if (!rec) continue;

      // Spa time: keep earliest
      if (rec.spa_time) {
        if (!profile.spa_time || rec.spa_time < profile.spa_time) {
          profile.spa_time = rec.spa_time;
        }
      }
      // Treatment count: accumulate across all orders
      profile.treatment_count += (rec.treatment_count ?? 0);
      // Treatment type: take first found
      if (!profile.treatment_type && rec.treatment_type) {
        profile.treatment_type = rec.treatment_type;
      }
    }
  }

  return profiles;
}

// ─────────────────────────────────────────────────────────────────────────────
// § EXPORT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * profilesToArray(profiles)
 * Converts the Map to a plain array sorted by guestName for display/upload.
 * orderNumbers Set is converted to a serializable array.
 */
export function profilesToArray(profiles) {
  return [...profiles.values()]
    .map((p) => ({ ...p, orderNumbers: [...p.orderNumbers] }))
    .sort((a, b) => (a.guestName ?? "").localeCompare(b.guestName ?? "", "he"));
}
