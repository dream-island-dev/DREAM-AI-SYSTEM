// supabase/functions/_shared/suiteNames.ts
//
// Deno-side mirror of src/data/suiteRegistry.js — the 26 canonical physical
// suites + Premium Day inventory slots. Duplicated across the front/back
// boundary by repo convention; when a suite is added/renamed, update BOTH files.
//
// Single server-side truth for automation routing (checkEligibility,
// whatsapp-send gates, automation-queue segmentation).
//
// Rules (P0, 2026-07-19):
//   • Suite pipeline  → canonical suite room ONLY (not room_type alone).
//   • Day-pass pipeline → Premium Day room OR day_guest/premium_day_guest
//     room_type with a non-empty, non-suite room label.
//   • No valid assignment → missing_room_assignment (all cron stages blocked).
//   • Canonical suite room wins over day-pass room_type (session 125).
//   • Premium Day room wins over room_type=suite (mis-import fix).

export const CANONICAL_SUITE_NAMES = [
  "ג׳ספר 1",  "ג׳ספר 2",  "ג׳ספר 3",  "ג׳ספר 4",  "ג׳ספר 5",  "ג׳ספר 6",
  "אוניקס 7",  "אמטיסט 8",  "אמטיסט 9",  "אמטיסט 10", "אמטיסט 11", "אוניקס 12",
  "רובי 13",   "רובי 14",   "רובי 15",   "רובי 16",
  "אמרלד 17",  "אמרלד 18",  "אמרלד 19",  "אמרלד 20",
  "אקווה מרין 21", "אקווה מרין 22", "אקווה מרין 23",
  "אקווה מרין 24", "אקווה מרין 25", "אקווה מרין 26",
];

export const PREMIUM_DAY_ROOM_NAMES = ["Premium Day 1", "Premium Day 2"] as const;

const DAY_PASS_ROOM_TYPES = new Set(["day_guest", "premium_day_guest"]);
const PREMIUM_DAY_SET = new Set<string>(PREMIUM_DAY_ROOM_NAMES);

/** Unify geresh/apostrophe variants + strip optional "סוויטת" prefix so
 * "ג'ספר 3" / "סוויטת ג׳ספר 3" both match the canonical "ג׳ספר 3". */
function normalizeRoomName(room: unknown): string {
  return String(room ?? "")
    .trim()
    .replace(/^סוויטת\s+/, "")
    .replace(/['‘’׳]/g, "׳")
    .replace(/\s+/g, " ");
}

const CANONICAL_SET = new Set(CANONICAL_SUITE_NAMES.map(normalizeRoomName));

export function isCanonicalSuiteRoom(room: unknown): boolean {
  const n = normalizeRoomName(room);
  return n !== "" && CANONICAL_SET.has(n);
}

export function isPremiumDayRoom(room: unknown): boolean {
  return PREMIUM_DAY_SET.has(String(room ?? "").trim());
}

const EZGO_SUITE_BRAND_ALIASES: Record<string, string> = {
  "אקוומרין": "אקווה מרין",
  "אקווהמרין": "אקווה מרין",
};

/** Map EZGO mail/CSV room label ("סוויטת אמטיסט - 8") → canonical SUITE_REGISTRY name. */
export function resolveSuiteRoomFromEzgoLabel(raw: unknown): string {
  const label = String(raw ?? "").trim();
  if (!label) return "";
  if (/premium\s*day\s*2|פרימיום.*2/i.test(label)) return "Premium Day 2";
  if (/premium\s*day\s*1|פרימיום/i.test(label)) return "Premium Day 1";
  if (/בילוי\s*יומי/i.test(label)) return "בילוי יומי";

  let text = label.replace(/^סוויטת\s+/i, "").trim();
  for (const [alias, canon] of Object.entries(EZGO_SUITE_BRAND_ALIASES)) {
    if (text.includes(alias)) text = text.replace(alias, canon);
  }

  const numMatch = text.match(/(?:^|[\s\-–])(\d{1,2})(?:\s|$|סוויטה)/)
    ?? text.match(/(\d{1,2})\s*$/);
  const num = numMatch?.[1];
  if (!num) return "";

  const candidates = CANONICAL_SUITE_NAMES.filter((s) => s.endsWith(` ${num}`));
  if (candidates.length === 1) return candidates[0];

  const brandChunk = text.split(/[-–]/)[0]?.trim() || text;
  const brandNorm = normalizeRoomName(brandChunk);
  const narrowed = candidates.filter((s) => {
    const suiteBrand = normalizeRoomName(s.replace(/ \d+$/, ""));
    return suiteBrand.includes(brandNorm) || brandNorm.includes(suiteBrand);
  });
  if (narrowed.length === 1) return narrowed[0];
  return "";
}

export function roomsCanonicallyMatch(incoming: unknown, stored: unknown): boolean {
  const a = String(incoming ?? "").trim();
  const b = String(stored ?? "").trim();
  if (!a || !b) return true;
  if (a === b) return true;
  const canonA = resolveSuiteRoomFromEzgoLabel(a) || a;
  const canonB = resolveSuiteRoomFromEzgoLabel(b) || b;
  if (canonA && canonB && canonA === canonB) return true;
  const numA = a.match(/(\d+)\s*$/)?.[1];
  const numB = b.match(/(\d+)\s*$/)?.[1];
  return !!(numA && numB && numA === numB);
}

export interface GuestRoomFields {
  room?: unknown;
  room_type?: unknown;
}

/** Effective suite — canonical physical suite room only. Premium Day slots and
 * bare room_type='suite' without a room are NOT suite guests for automation. */
export function isEffectiveSuiteGuest(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!guest) return false;
  if (isPremiumDayRoom(guest.room)) return false;
  return isCanonicalSuiteRoom(guest.room);
}

/** Effective day-pass — Premium Day room OR day-pass room_type with a filled-in
 * non-suite room label. Canonical suite room always routes as SUITE instead. */
export function isEffectiveDayPassGuest(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!guest) return false;
  if (isCanonicalSuiteRoom(guest.room)) return false;
  if (isPremiumDayRoom(guest.room)) return true;
  if (!DAY_PASS_ROOM_TYPES.has(String(guest.room_type ?? ""))) return false;
  return String(guest.room ?? "").trim() !== "";
}

/** Cron / whatsapp-send gate — block all pipeline stages when neither suite nor
 * day-pass assignment is resolvable. Manual inbox + room_ready are exempt at
 * the caller (whatsapp-send MANUAL_TRIGGERS / room_ready). */
export function getMissingRoomAssignmentSkipReason(
  guest: GuestRoomFields | null | undefined,
): string | null {
  if (isEffectiveSuiteGuest(guest) || isEffectiveDayPassGuest(guest)) return null;
  return "missing_room_assignment";
}

/** FAIL VISIBLE (§0.3): true when room says suite but room_type says day-pass —
 * the exact split-brain that misrouted suite guests to day-pass content.
 * Surfaced as a ⚠ badge in ACC Live Queue + GuestsPage/GuestDashboard; routing
 * treats the guest as SUITE. */
export function hasSuiteRoomTypeConflict(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!guest) return false;
  return (
    DAY_PASS_ROOM_TYPES.has(String(guest.room_type ?? "")) &&
    isCanonicalSuiteRoom(guest.room)
  );
}

/** FAIL VISIBLE: Premium Day room but room_type is suite/standard — mis-import
 * that previously routed to suite automation (night_before, morning_suite…). */
export function hasPremiumDayRoomTypeConflict(
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!guest || !isPremiumDayRoom(guest.room)) return false;
  const rt = String(guest.room_type ?? "");
  return rt !== "day_guest" && rt !== "premium_day_guest";
}
