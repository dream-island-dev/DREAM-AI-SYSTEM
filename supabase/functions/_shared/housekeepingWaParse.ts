// Parse signals from the housekeeping WhatsApp group (צ'ק אין צ'ק אאוט).
// Ready: N✅ / ready / מוכן → bell (ממתין לאישור).
// Check-in: N צ'ק אין / check in → guests.checked_in + room תפוס.
// Check-out: Co N / N co / צ'ק אאוט → guests.checked_out + room לניקיון.
//
// ✅ is the primary, authoritative signal that a room is clean/ready — it always
// wins. A line that happens to mention "צ'ק אין" (check-in) alongside a ✅ is
// still a READY signal, not a check-in one: in practice ✅ always arrives first
// (room turned over), and staff only type "N צ'ק אין" later, in its own message
// with no ✅, once the guest actually walks in. So: line has ✅ → ready only,
// never check-in. Line has check-in phrasing with NO ✅ → check-in only.

const MIN_ROOM = 1;
const MAX_ROOM = 26;

/** Whole-message skip (forwarded bubbles). */
const FORWARDED_RE = /הועברה/i;

/** ✅ always takes priority over check-in phrasing in the same line — see header note. */
const HAS_CHECKMARK_RE = /✅/;

/** Per-line exclusions for READY parser only (check-in / check-out have their own parsers). */
const READY_EXCLUDE_LINE_RE =
  /ממתין|\bcheck\s*[- ]?\s*out\b|\bco\b|\bout\b|יצאו|צ['׳']ק\s*אא?וט|צק\s*אא?וט/i;

/** צ'ק אין / check in — must not match check out. */
const CHECKIN_LINE_RE =
  /^(?:room\s*)?(\d{1,2})\s*(?:צ['׳']ק\s*אין|צק\s*אין|\bcheck\s*[- ]?\s*in\b)/i;

// Hebrew has no JS \w word-chars — never put \b after Hebrew alternatives.
const CHECKOUT_TOKEN_PREFIX =
  "(?:co|check\\s*[- ]?\\s*out|צ['׳']ק\\s*אא?וט|צק\\s*אא?וט)";
const CHECKOUT_TOKEN_SUFFIX =
  "(?:co\\b|check\\s*[- ]?\\s*out\\b|צ['׳']ק\\s*אא?וט|צק\\s*אא?וט)";

/** "Co 23" / "check out 16" / "צ'ק אאוט 24" */
const CHECKOUT_PREFIX_RE = new RegExp(
  `^(?:room\\s*)?${CHECKOUT_TOKEN_PREFIX}\\s+(\\d{1,2})$`,
  "i",
);

/** "24 co" / "16 check out" / "23 צ'ק אאוט" */
const CHECKOUT_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(\\d{1,2})\\s+${CHECKOUT_TOKEN_SUFFIX}`,
  "i",
);

function inSuiteRange(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_ROOM && n <= MAX_ROOM;
}

function addRoom(rooms: Set<number>, raw: string | undefined): void {
  const n = parseInt(String(raw ?? ""), 10);
  if (inSuiteRange(n)) rooms.add(n);
}

/** Exported for tests via src/utils mirror — keep patterns in sync. */
export function parseHousekeepingCheckInRoomNumbers(text: string): number[] {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set<number>();
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    // ✅ wins — a line with a checkmark is a ready signal, not a check-in one.
    if (HAS_CHECKMARK_RE.test(t)) continue;
    const m = t.match(CHECKIN_LINE_RE);
    if (m) addRoom(rooms, m[1]);
  }
  return [...rooms].sort((a, b) => a - b);
}

/** "Co 23" / "24 co" / Hebrew צ'ק אאוט — staff physical checkout signal. */
export function parseHousekeepingCheckOutRoomNumbers(text: string): number[] {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set<number>();
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (HAS_CHECKMARK_RE.test(t)) continue;
    // Never steal a check-in line.
    if (CHECKIN_LINE_RE.test(t)) continue;

    let m = t.match(CHECKOUT_PREFIX_RE);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }
    m = t.match(CHECKOUT_SUFFIX_RE);
    if (m) addRoom(rooms, m[1]);
  }
  return [...rooms].sort((a, b) => a - b);
}

export function parseHousekeepingReadyRoomNumbers(text: string): number[] {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set<number>();

  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || READY_EXCLUDE_LINE_RE.test(t)) continue;
    // Skip lines that are check-in-only (handled separately) — but ✅ always
    // overrides check-in phrasing in the same line (see header note).
    if (CHECKIN_LINE_RE.test(t) && !HAS_CHECKMARK_RE.test(t)) continue;
    // Skip checkout-only lines (handled by check-out parser).
    if (CHECKOUT_PREFIX_RE.test(t) || CHECKOUT_SUFFIX_RE.test(t)) continue;

    // "14✅", "7 ✅", "Room 14 ✅"
    let m = t.match(/^(?:room\s*)?(\d{1,2})\s*✅/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    // "14 מוכן", "22 ready", "Room 2 is ready ✅", "6 si ready ✅"
    m = t.match(/^(?:room\s*)?(\d{1,2})\s*(?:מוכן|ready|is\s+ready|si\s+ready)\b/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    // "Room 7 ✅" / "Room 10 ✅" (number after Room)
    m = t.match(/^room\s+(\d{1,2})\s*✅/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    // Inline: "22 ready ✅" mid-sentence
    m = t.match(/(?:^|\s)(?:room\s*)?(\d{1,2})\s+(?:מוכן|ready|is\s+ready|si\s+ready)\s*✅?/i);
    if (m) {
      addRoom(rooms, m[1]);
    }
  }

  return [...rooms].sort((a, b) => a - b);
}
