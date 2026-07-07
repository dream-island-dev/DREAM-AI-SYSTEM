// Parse signals from the housekeeping WhatsApp group (צ'ק אין צ'ק אאוט).
// Ready: N✅ / ready / מוכן → bell (ממתין לאישור).
// Check-in: N צ'ק אין / check in → guests.checked_in + room תפוס.
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

/** Per-line exclusions for READY parser only (check-in has its own parser). */
const READY_EXCLUDE_LINE_RE =
  /ממתין|\bcheck\s*[- ]?\s*out\b|\bco\b|\bout\b|יצאו/i;

/** צ'ק אין / check in — must not match check out. */
const CHECKIN_LINE_RE =
  /^(?:room\s*)?(\d{1,2})\s*(?:צ['׳']ק\s*אין|צק\s*אין|\bcheck\s*[- ]?\s*in\b)/i;

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
