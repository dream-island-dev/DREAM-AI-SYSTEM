// src/utils/ezgoParser.js
// ── Guest Extraction & Golden Guest Profile Aggregation ──────────────────────
// Pure data transformation — zero Supabase calls, zero side effects.
// Called from ArrivalImportPanel.js during the Suite CSV import preview step.
//
// Resilient Import Agent (session 9): extractGuestDetails()/aggregateGuestProfiles()
// no longer assume EZGO's exact column names. They take a `columnMapping` object
// — { orderNumber: "<actual header in this file>", resLineId: "...", remark: "...", ... } —
// produced by an AI-suggested mapping that the admin reviews/edits in
// MappingReviewPanel.js (see src/utils/importMapper.js for the role descriptor,
// and supabase/functions/suggest-import-mapping/index.ts for the AI proposal call).
// The cascades/classification logic below (phone priority, name extraction,
// day-guest detection) is unchanged — only the raw `row.<literal>` lookups became
// `row[columnMapping.<role>]` lookups, so a renamed/reordered source column no
// longer breaks the import.
//
// Two-stage pipeline:
//   Stage 1: extractGuestDetails(row, columnMapping)  — per-row, resolves TRUE identity
//   Stage 2: aggregateGuestProfiles(rows, columnMapping) — merges all rows into keyed profile Map
//   Stage 3: enrichProfilesFromExcel() — injects spa_time by order_number join (unchanged — operates
//            on already-extracted values, never touches source column names)

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
// (same pattern as ARRIVALS_SOURCE_RE in ArrivalImportPanel.js)
const SOURCE_RE = /^(Hotel\s+WebSite|Booking\s+Collect|Booking\.com|Booking|Expedia|Hotels\.com)\s*-\s*/i;

// EZGO dummy date sentinel — "01/01/2001" means "no real date assigned"
const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;

// Sales-dept corporate bookings: stored in DB, pipeline automation disabled.
const SALES_DEPT_LEAD_SOURCE = "מחלקת מכירות";

function isAutomationMutedLeadSource(leadSource) {
  return String(leadSource ?? "").trim() === SALES_DEPT_LEAD_SOURCE;
}

// Corporate/institutional coordinator names that mute automation even when no
// lead_source column is mapped at all — a municipal/bank/corporate group
// booking must never get automated WhatsApp pipeline messages, regardless of
// whether an individual occupant was resolved from the remark for this
// specific row. Deliberately duplicated (not imported) from
// guestImportIntelligence.js's isCorporateName/CORPORATE_NAME_PREFIXES — that
// file already imports from THIS one (extractPhonesFromText/
// extractNameFromRemark), so a reverse import here would create an import
// cycle between the two modules. Keep both lists in sync by hand.
const CORPORATE_MUTE_NAME_RE = /עיריית|עיירית|עירייה|עיריה|מחלקת מכירות|בנק לאומי/;

function isCorporateMuteCoordName(name) {
  return CORPORATE_MUTE_NAME_RE.test(String(name ?? ""));
}

// ─────────────────────────────────────────────────────────────────────────────
// § PHONE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes any matched IL_MOBILE_RE capture to E.164 "+972XXXXXXXXX".
 *
 * EZGO sRemark phones always have a leading "0" (domestic format).
 * EZGO sTel1 phones OMIT the leading "0" (9 digits starting with "5") —
 * but some exports (e.g. 24.6.csv) write sTel1 in international format
 * with spaces and a leading "+" ("+972 54 651 8772"). Stripping every
 * non-digit char up front (below) handles the spaces/hyphens/plus in one
 * place; the three branches then just need to recognize the resulting
 * digit-only sequence by length/prefix.
 */
function normalizeILMobile(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10 && digits.startsWith("0"))   return `+972${digits.slice(1)}`;
  if (digits.length === 9  && digits.startsWith("5"))   return `+972${digits}`;
  if (digits.length === 12 && digits.startsWith("972")) return `+${digits}`;
  return null;
}

const REPEATED_DIGIT_RE = /^(\d)\1+$/;

/**
 * Placeholder coordinator phones ("111", "000…") — not real guest numbers.
 * Shared with guestImportIntelligence.js (umbrella vs importable row).
 */
export function isDummyPhone(phone) {
  if (phone == null || phone === "") return true;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 7) return true;
  if (REPEATED_DIGIT_RE.test(digits)) return true;
  return false;
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
 *
 * Defensive cleanup (XOS Task 1): a mis-split CSV row can leak raw fragments
 * ahead of the real name — e.g. `רינת עקיבא 3 בחדר","6","11","גוש 12","עיריית
 * תל אביב",0506919808` when a free-text field like sRemark contains an
 * unescaped comma/quote that a naive CSV reader mis-splits across columns.
 * `","` is the telltale artifact of that mis-split (a quoted-field boundary
 * landing mid-string) — cut there so the leaked junk never becomes the guest
 * name, and cap length as a hard backstop against anything else that slips
 * through un-flagged.
 */
const CSV_ARTIFACT_RE_INDEX = '","';
const MAX_REMARK_NAME_LEN = 80;

// Free-text sRemark often carries room/payment notes after the occupant name.
// Cut at the first noise boundary so "רינת עקיבא 3 בחדר תוספת…" → "רינת עקיבא".
const REMARK_NAME_NOISE_RES = [
  /","/,
  /,\s*,/,
  /₪/,
  /\s+\d+\s*בחדר/,
  /\s+בחדר\b/,
  /\s+תוספת\b/,
  /\s+פרטי\b/,
  /\s+\d+\s*שח/,
  /\s+תשלום\b/,
  /\s+ביום\b/,
];

function trimRemarkNameNoise(text) {
  let s = String(text ?? "").trim();
  if (!s) return "";

  for (const re of REMARK_NAME_NOISE_RES) {
    const m = re.exec(s);
    if (m && m.index > 0) s = s.slice(0, m.index).trim();
  }

  s = s.replace(/[\s\-+/|,;"]+$/, "").trim();

  // "Name 3 …" / "Name 1000 …" — digit after words is room/qty/price, not part of name.
  const digitCut = s.match(/^(.+?)\s+\d/);
  if (digitCut) s = digitCut[1].trim();

  return s;
}

/** When sRemark lists several people ("א / ב - phone"), keep the segment beside the phone. */
function pickOccupantNameFromPrefix(namePart) {
  const segments = String(namePart ?? "")
    .split(/\s*[/+]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  const raw = segments.length > 1 ? segments[segments.length - 1] : String(namePart ?? "");
  return trimRemarkNameNoise(raw);
}

function remarkHasEmbeddedPhone(text) {
  if (!text || typeof text !== "string") return false;
  IL_MOBILE_RE.lastIndex = 0;
  const found = IL_MOBILE_RE.test(text);
  IL_MOBILE_RE.lastIndex = 0;
  return found;
}

/**
 * sRemark with occupant name but phone only in another column (sTel1).
 * "נילי הללי" / "Eric Yosef Cohen" — not a name source when remark also has a phone
 * (extractNameFromRemark handles that path).
 */
export function extractNameFromRemarkWithoutPhone(remark) {
  if (!remark?.trim() || remarkHasEmbeddedPhone(remark)) return null;
  const cleaned = pickOccupantNameFromPrefix(remark);
  if (!cleaned || isCorporateMuteCoordName(cleaned)) return null;
  if (!/^[\u0590-\u05FFa-zA-Z\s'"/+-]+$/.test(cleaned)) return null;
  if (_isSuspiciousGuestName(cleaned)) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 5) return null;
  return cleaned;
}

// Shared with ArrivalImportPanel — keep in sync (imported there for badge checks).
function _isSuspiciousGuestName(name) {
  const s = String(name ?? "");
  if (!s) return false;
  return (
    s.includes('","')
    || s.length > 120
    || /₪/.test(s)
    || /,\s*,/.test(s)
    || /\d+\s*בחדר/.test(s)
    || /\s+תשלום\b/.test(s)
  );
}

export function extractNameFromRemark(remark) {
  if (!remark || typeof remark !== "string") return null;
  const s = remark.trim();

  const phoneMatch = IL_MOBILE_RE.exec(s);
  // Reset lastIndex so repeated calls don't interfere
  IL_MOBILE_RE.lastIndex = 0;

  if (!phoneMatch) {
    return null; // sRemark without a phone is NOT a name source
  }

  let namePart = s.slice(0, phoneMatch.index);
  const artifactIdx = namePart.indexOf(CSV_ARTIFACT_RE_INDEX);
  if (artifactIdx >= 0) namePart = namePart.slice(0, artifactIdx);
  let clean = pickOccupantNameFromPrefix(namePart);
  if (clean.length > MAX_REMARK_NAME_LEN) clean = clean.slice(0, MAX_REMARK_NAME_LEN).trim();
  return clean || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// § MEAL TIME HELPER
// ─────────────────────────────────────────────────────────────────────────────

// EZGO remark meal-time shorthand: "א. ערב 19:30" ("ארוחת ערב" = dinner,
// abbreviated). Only the dinner-slot abbreviation observed in real exports so
// far — extend this regex if a breakfast/lunch shorthand ever shows up too.
const MEAL_TIME_REMARK_RE = /א\.?\s*ערב\s*(\d{1,2}:\d{2})/;

/**
 * Extracts a meal time embedded in an EZGO remark/opRemark string, e.g.
 * "א. ערב 19:30" → "19:30". Returns null when the shorthand is absent — this
 * is a best-effort enrichment, not every remark carries one.
 */
export function extractMealTimeFromRemark(remark) {
  if (!remark || typeof remark !== "string") return null;
  const m = remark.match(MEAL_TIME_REMARK_RE);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// § DATE HELPER (inline — mirrors parseEzgoDate from ArrivalImportPanel.js)
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
 * extractGuestDetails(row, columnMapping, fallbackDate?)
 *
 * Takes one raw CSV/Excel row (SheetJS object) and resolves the TRUE guest
 * identity using a priority cascade:
 *
 *   Phone priority:
 *     1. remark phone          ← actual room occupant (individual)
 *     2. opRemark phone        ← secondary notes (occasional)
 *     3. coordPhone            ← booking coordinator (group) / direct for solo
 *
 *   Name priority:
 *     1. Name extracted from remark (before the phone)
 *     2. Name extracted from opRemark
 *     3. coordName (coordinator / booking name)
 *
 * Returns a GuestProfile object (no DB writes — pure transform).
 *
 * @param {object} row          - SheetJS-parsed source row
 * @param {object} columnMapping - { orderNumber, resLineId, roomName, suiteType,
 *                                  coordName, coordPhone, remark, opRemark, adults,
 *                                  children, nights, checkinTime, checkoutTime,
 *                                  groupId, price, arrivalDate } → each value is the
 *                                  actual header name in THIS file (or null/undefined
 *                                  if that role has no matching column). Produced by
 *                                  the admin-approved mapping from MappingReviewPanel.js.
 * @param {string} fallbackDate - ISO date from filename ("2026-06-18"), used
 *                               when the mapped arrival-date column is absent/empty
 */
export function extractGuestDetails(row, columnMapping = {}, fallbackDate = null) {
  // ── Raw field extraction — via the approved mapping, not a literal header name ──
  const col = (role) => columnMapping[role];
  const val = (role) => { const h = col(role); return h ? row[h] : undefined; };

  const orderNumber  = String(val("orderNumber") ?? "").trim();
  const resLineId    = String(val("resLineId")    ?? "").trim(); // globally unique PMS ID — upsert key
  const roomName     = String(val("roomName")     ?? "").trim();
  const suiteType    = String(val("suiteType")    ?? "").trim();
  // SheetJS defval:"" makes missing fields "", not null — use || (not ??) so the
  // fallback actually fires when the primary field is an empty string.
  const coordNameRaw = String(val("coordName")  || "").trim();
  const coordPhoneRaw= String(val("coordPhone") || "").trim();
  const directPhoneRaw = String(val("guestPhone") || "").trim();
  const remark       = String(val("remark")     ?? "").trim();
  const opRemark     = String(val("opRemark")   ?? "").trim();
  const adults       = parseInt(val("adults") ?? "1") || 1;
  const children     = parseInt(val("children") ?? "0") || 0;
  const nights       = parseInt(val("nights") ?? "0") || 0;
  const checkinTime  = String(val("checkinTime")  ?? "").trim() || null;
  const checkoutTime = String(val("checkoutTime") ?? "").trim() || null;
  const groupId      = parseInt(val("groupId") ?? "0");
  const priceRaw     = val("price");
  const price        = parseFloat(String(priceRaw ?? "").replace(/[^\d.-]/g, "")) || 0;
  const leadSource   = String(val("leadSource") ?? "").trim() || null;
  const automationMuted = isAutomationMutedLeadSource(leadSource) || isCorporateMuteCoordName(coordNameRaw);

  // ── Arrival date ─────────────────────────────────────────────────────────
  const arrivalDate = parseDate(val("arrivalDate")) ?? fallbackDate;

  // ── Coordinator phone (source value may be 9-digit without leading 0) ────
  const coordE164 = normalizeILMobile(
    /^\d{9}$/.test(coordPhoneRaw) ? `0${coordPhoneRaw}` : coordPhoneRaw
  );
  const directE164 = normalizeILMobile(
    /^\d{9}$/.test(directPhoneRaw) ? `0${directPhoneRaw}` : directPhoneRaw
  );

  // ── Phone priority cascade ────────────────────────────────────────────────
  // Remark-first (Guest Import Intelligence Sprint 1 fix): a remark phone
  // paired with a resolvable name is the ACTUAL room occupant — it must win
  // over a mapped "direct" guestPhone column. In the real EZGO export that
  // direct column is sTel1, the booking COORDINATOR's phone (shared across
  // every room in a group booking) — letting it short-circuit remark
  // resolution silently routed every individual's WhatsApp messages to the
  // group organizer instead of the actual guest. This restores remark as the
  // true identity source this function's own docstring above always
  // documented it to be.
  const remarkPhones   = extractPhonesFromText(remark);
  const opRemarkPhones = extractPhonesFromText(opRemark);
  const remarkNameCandidate =
    extractNameFromRemark(remark)
    ?? extractNameFromRemarkWithoutPhone(remark)
    ?? extractNameFromRemark(opRemark)
    ?? extractNameFromRemarkWithoutPhone(opRemark);

  let guestPhone;
  let phoneSource; // "individual" | "coordinator"

  if (remarkPhones.length > 0 && remarkNameCandidate) {
    guestPhone   = remarkPhones[0];
    phoneSource  = "individual";
  } else if (remarkNameCandidate && directE164 && !isDummyPhone(directE164)) {
    // Name in sRemark, mobile in mapped guestPhone column (not embedded in remark text).
    guestPhone   = directE164;
    phoneSource  = "individual";
  } else if (remarkNameCandidate && coordE164 && !isDummyPhone(coordE164)) {
    // Common EZGO shape: "נילי הללי" in sRemark, 05x in sTel1 — same occupant.
    guestPhone   = coordE164;
    phoneSource  = "individual";
  } else if (directE164 && !isDummyPhone(directE164)) {
    guestPhone  = directE164;
    phoneSource = "individual";
  } else if (remarkPhones.length > 0) {
    guestPhone   = remarkPhones[0];
    phoneSource  = "individual";
  } else if (opRemarkPhones.length > 0) {
    guestPhone   = opRemarkPhones[0];
    phoneSource  = "individual";
  } else if (coordE164 && !isDummyPhone(coordE164)) {
    guestPhone   = coordE164;
    phoneSource  = "coordinator";
  } else {
    guestPhone   = null;
    phoneSource  = null;
  }

  // ── Name priority cascade ─────────────────────────────────────────────────
  const remarkName    = remarkNameCandidate ?? extractNameFromRemark(opRemark);
  const coordName     = coordNameRaw.replace(SOURCE_RE, "").trim() || null;
  const guestName     = remarkName ?? coordName;

  // ── Meal time (best-effort, remark shorthand only) ────────────────────────
  const mealTime = extractMealTimeFromRemark(remark) ?? extractMealTimeFromRemark(opRemark);

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

    // ── Room ─────────────────────────────────────────────────────────────
    roomName,           // "8", "21 סוויטה נגישה", "חבילת פרימיום בילוי יומי"
    suiteType,          // "סוויטת אמטיסט", "Premium Day 2"

    // ── TRUE identity (resolved) ─────────────────────────────────────────
    guestName,          // actual occupant name or coordinator name
    guestPhone,         // E.164 — individual occupant or coordinator fallback
    coordPhone: coordE164,
    coordPhoneRaw: coordPhoneRaw || null,
    phoneSource,        // "individual" | "coordinator"

    // ── Booking details ───────────────────────────────────────────────────
    adults,
    children,
    nights,
    arrivalDate,        // ISO "2026-06-18" or null
    checkinTime,        // "10:00" or null
    checkoutTime,       // "19:00" or null
    price,
    mealTime,           // "19:30" from remark shorthand ("א. ערב HH:MM"), or null

    // ── Category ─────────────────────────────────────────────────────────
    isDayGuest,
    isGroupCoordinator,

    // ── Lead source / automation muzzle (advanced PMS export) ────────────
    leadSource,
    automationMuted,

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
 * aggregateGuestProfiles(rows, columnMapping, fallbackDate?)
 *
 * Processes ALL rows from the source file into one profile PER ROW, keyed by
 * row index (NOT by phone — see hotfix Sprint 3.4: row-index key guarantees
 * 1 profile per CSV row, so two guests who happen to share a coordinator's
 * phone never collapse into one profile and silently lose a row). Each
 * profile's `rooms` array therefore always has exactly one entry at this
 * stage — grouping multiple rows under one stay, if ever needed, is a
 * decision for a future, explicit feature, not an implicit side effect here.
 *
 * orderNumbers is a Set so enrichProfilesFromExcel() can do a correct JOIN.
 *
 * Returns: Map<"row_<index>", ConsolidatedProfile>
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
 *
 * @param {object} columnMapping - same shape as extractGuestDetails() expects;
 *                                 threaded straight through to it for every row.
 */
export function aggregateGuestProfiles(rows, columnMapping = {}, fallbackDate = null) {
  const profiles = new Map();

  // Key = absolute row index — 1 CSV row = 1 profile, zero merging.
  // Phone duplication (two guests sharing a number, e.g. group members) must NOT
  // collapse rows — the DB upsert layer handles deduplication by phone at write time.
  rows.forEach((row, index) => {
    const g = extractGuestDetails(row, columnMapping, fallbackDate);
    // Only skip completely blank rows (header artifacts, trailing newlines, etc.)
    if (!g.guestPhone && !g.guestName && !g.resLineId && !g.orderNumber) return;

    profiles.set(`row_${index}`, {
      guestPhone:      g.guestPhone,
      coordPhone:      g.coordPhone,
      guestName:       g.guestName,
      phoneSource:     g.phoneSource,
      arrivalDate:     g.arrivalDate,
      isDayGuest:      g.isDayGuest,

      rooms: [{
        resLineId:    g.resLineId,
        orderNumber:  g.orderNumber,
        roomName:     g.roomName,
        suiteType:    g.suiteType,
        adults:       g.adults,
        children:     g.children,
        nights:       g.nights,
        checkinTime:  g.checkinTime,
        checkoutTime: g.checkoutTime,
        price:        g.price,
        isDayGuest:   g.isDayGuest,
      }],

      orderNumbers:    g.orderNumber ? new Set([g.orderNumber]) : new Set(),
      hasSuite:        !g.isDayGuest,
      hasDayBooking:   g.isDayGuest,
      spa_time:        null,
      treatment_count: 0,
      treatment_type:  null,
      meal_plan:       null,
      meal_time:       null,
      leadSource:      g.leadSource ?? null,
      automationMuted: !!g.automationMuted,
    });
  });

  console.log("[aggregateGuestProfiles] raw rows:", rows.length, "→ profiles:", profiles.size);
  return profiles;
}

// ─────────────────────────────────────────────────────────────────────────────
// § STAGE 3 — EXCEL ENRICHMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * enrichProfilesFromExcel(profiles, excelRecords)
 *
 * Merges spa_time and treatment data from the comprehensive Excel report
 * (parsed by parseComprehensiveReport() in ArrivalImportPanel.js) into the in-memory
 * profiles built by aggregateGuestProfiles().
 *
 * JOIN strategy:
 *   1. profile.orderNumbers ∩ excelRecord.order_number (primary)
 *   2. profile.guestPhone ∩ excelRecord.phone when no order row matched (Doc 1 dedupes by phone)
 *   - One order may span multiple rooms → all those rooms get the same spa_time
 *   - When multiple Excel records match, keep earliest spa_time, sum treatment_count
 *
 * Mutates profiles Map in place. Returns the same Map.
 */
export function enrichProfilesFromExcel(profiles, excelRecords) {
  const applyExcelFields = (profile, rec) => {
    if (rec.spa_time) {
      if (!profile.spa_time || rec.spa_time < profile.spa_time) {
        profile.spa_time = rec.spa_time;
      }
    }
    if (rec.meal_location && !profile.meal_location) {
      profile.meal_location = rec.meal_location;
    }
    if (rec.meal_time && (!profile.meal_time || rec.meal_time < profile.meal_time)) {
      profile.meal_time = rec.meal_time;
    }
    profile.treatment_count += (rec.treatment_count ?? 0);
    if (!profile.treatment_type && rec.treatment_type) {
      profile.treatment_type = rec.treatment_type;
    }
  };

  // Index Excel by order_number for O(1) lookup
  const excelByOrder = new Map();
  const excelByPhone = new Map();
  for (const rec of excelRecords) {
    if (rec.order_number) {
      if (!excelByOrder.has(rec.order_number)) {
        excelByOrder.set(rec.order_number, rec);
      } else {
        const ex = excelByOrder.get(rec.order_number);
        if (rec.spa_time && (!ex.spa_time || rec.spa_time < ex.spa_time)) ex.spa_time = rec.spa_time;
        if (rec.meal_time && (!ex.meal_time || rec.meal_time < ex.meal_time)) {
          ex.meal_time = rec.meal_time;
          if (rec.meal_location && !ex.meal_location) ex.meal_location = rec.meal_location;
        }
        ex.treatment_count = (ex.treatment_count ?? 0) + (rec.treatment_count ?? 0);
      }
    }
    if (rec.phone) {
      if (!excelByPhone.has(rec.phone)) {
        excelByPhone.set(rec.phone, rec);
      } else {
        const ex = excelByPhone.get(rec.phone);
        if (rec.spa_time && (!ex.spa_time || rec.spa_time < ex.spa_time)) ex.spa_time = rec.spa_time;
        if (rec.meal_time && (!ex.meal_time || rec.meal_time < ex.meal_time)) {
          ex.meal_time = rec.meal_time;
          if (rec.meal_location && !ex.meal_location) ex.meal_location = rec.meal_location;
        }
        ex.treatment_count = (ex.treatment_count ?? 0) + (rec.treatment_count ?? 0);
      }
    }
  }

  for (const profile of profiles.values()) {
    let matchedByOrder = false;
    for (const orderNum of profile.orderNumbers) {
      const rec = excelByOrder.get(orderNum);
      if (!rec) continue;
      matchedByOrder = true;
      applyExcelFields(profile, rec);
    }
    // Phone fallback when order_number join missed (Doc 1 dedupes by phone)
    if (!matchedByOrder && profile.guestPhone) {
      const rec = excelByPhone.get(profile.guestPhone);
      if (rec) applyExcelFields(profile, rec);
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
