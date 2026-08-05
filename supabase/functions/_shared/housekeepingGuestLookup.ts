// Live guest ↔ suite matching for housekeeping WA signals (ready / check-in / check-out).
// Matches guests.room AND suite_rooms rows (multi-room) — mirrors roomBoardGuestResolve.js.
// Primary gate: arrival_date + departure_date stay window; status is tie-break only.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { guestRoomMatchesSuiteId, isDayPassRoomLabel } from "./guestRoomResolve.ts";
import {
  scoreGuestForCheckIn,
  scoreGuestForCheckout,
  scoreGuestForReadyBell,
  scoreGuestForInHouseStay,
  CHECKIN_ELIGIBLE_STATUSES,
  READY_GUEST_STATUSES,
  HOUSEKEEPING_SCORE_OUT_OF_RANGE,
} from "./housekeepingLifecycle.ts";

export interface SuiteGuestRow {
  id: number;
  name: string | null;
  phone: string | null;
  spa_time: string | null;
  room: string | null;
  suite_name: string | null;
  status: string;
  arrival_date: string | null;
  departure_date: string | null;
  guest_notes: string | null;
  room_ready_notified: boolean | null;
  msg_room_ready_sent: boolean | null;
}

export interface GuestLookupResult {
  guest: SuiteGuestRow | null;
  ambiguous: SuiteGuestRow[];
}

interface SuiteRoomLink {
  guest_id: number;
  room_display: string | null;
  room_name: string | null;
  suite_type: string | null;
  arrival_date: string | null;
  is_day_guest?: boolean | null;
}

const GUEST_SELECT =
  "id, name, phone, spa_time, room, suite_name, status, arrival_date, departure_date, guest_notes, room_ready_notified, msg_room_ready_sent";

const ACTIVE_STATUSES = ["pending", "expected", "room_ready", "checked_in"] as const;

function isDayPassSuiteLink(sr: SuiteRoomLink): boolean {
  if (sr.is_day_guest === true) return true;
  return (
    isDayPassRoomLabel(sr.room_display) ||
    isDayPassRoomLabel(sr.room_name) ||
    isDayPassRoomLabel(sr.suite_type)
  );
}

function roomLabelSegments(room: string | null | undefined): string[] {
  const s = String(room ?? "").trim();
  if (!s) return [];
  if (s.includes(" · ")) {
    return s.split(/\s*·\s*/).map((p) => p.trim()).filter(Boolean);
  }
  return [s];
}

function labelMatchesSuiteId(
  label: string | null | undefined,
  suiteType: string | null | undefined,
  roomId: string,
): boolean {
  if (isDayPassRoomLabel(label) || isDayPassRoomLabel(suiteType)) return false;
  return guestRoomMatchesSuiteId(
    { room: label, suite_name: suiteType },
    roomId,
  );
}

function guestMatchesRoom(
  guest: SuiteGuestRow,
  roomId: string,
  suiteLinks: SuiteRoomLink[],
): boolean {
  if (isDayPassRoomLabel(guest.room) || isDayPassRoomLabel(guest.suite_name)) return false;

  for (const seg of roomLabelSegments(guest.room)) {
    if (labelMatchesSuiteId(seg, null, roomId)) return true;
  }
  for (const seg of roomLabelSegments(guest.suite_name)) {
    if (labelMatchesSuiteId(seg, null, roomId)) return true;
  }
  if (labelMatchesSuiteId(guest.room, guest.suite_name, roomId)) return true;

  const links = suiteLinks.filter((sr) => Number(sr.guest_id) === Number(guest.id));
  return links.some((sr) => {
    if (isDayPassSuiteLink(sr)) return false;
    return labelMatchesSuiteId(
      sr.room_display ?? sr.room_name,
      sr.suite_type,
      roomId,
    );
  });
}

async function loadSuiteRoomLinks(
  supabase: ReturnType<typeof createClient>,
  guestIds: number[],
): Promise<SuiteRoomLink[]> {
  if (!guestIds.length) return [];
  const { data, error } = await supabase
    .from("suite_rooms")
    .select("guest_id, room_display, room_name, suite_type, arrival_date, is_day_guest")
    .in("guest_id", guestIds);
  if (error) {
    console.warn("[housekeepingGuestLookup] suite_rooms load failed:", error.message);
    return [];
  }
  return (data ?? []) as SuiteRoomLink[];
}

/** Guests departing today/overdue with a suite_rooms row in this physical room. */
async function loadGuestsDepartingBySuiteRoom(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  today: string,
): Promise<{ guests: SuiteGuestRow[]; links: SuiteRoomLink[] }> {
  const { data: suiteRows, error } = await supabase
    .from("suite_rooms")
    .select("guest_id, room_display, room_name, suite_type, arrival_date, is_day_guest")
    .not("guest_id", "is", null);

  if (error) {
    console.warn("[housekeepingGuestLookup] suite_rooms departing scan failed:", error.message);
    return { guests: [], links: [] };
  }

  const links = ((suiteRows ?? []) as SuiteRoomLink[]).filter((sr) => {
    if (isDayPassSuiteLink(sr)) return false;
    return labelMatchesSuiteId(sr.room_display ?? sr.room_name, sr.suite_type, roomId);
  });
  const guestIds = [...new Set(links.map((sr) => Number(sr.guest_id)).filter(Boolean))];
  if (!guestIds.length) return { guests: [], links };

  const { data: guests, error: guestErr } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
    .in("id", guestIds)
    .neq("status", "cancelled")
    .not("departure_date", "is", null)
    .lte("departure_date", today)
    .in("status", [...CHECKOUT_CANDIDATE_STATUSES]);

  if (guestErr) {
    console.warn("[housekeepingGuestLookup] departing guests by suite_rooms failed:", guestErr.message);
    return { guests: [], links };
  }
  return { guests: (guests ?? []) as SuiteGuestRow[], links };
}

async function loadGuestsBySuiteRoomToday(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  today: string,
): Promise<{ guests: SuiteGuestRow[]; links: SuiteRoomLink[] }> {
  const { data: suiteRows, error } = await supabase
    .from("suite_rooms")
    .select("guest_id, room_display, room_name, suite_type, arrival_date, is_day_guest")
    .eq("arrival_date", today)
    .not("guest_id", "is", null);

  if (error) {
    console.warn("[housekeepingGuestLookup] suite_rooms today scan failed:", error.message);
    return { guests: [], links: [] };
  }

  const links = ((suiteRows ?? []) as SuiteRoomLink[]).filter((sr) => {
    if (isDayPassSuiteLink(sr)) return false;
    return labelMatchesSuiteId(sr.room_display ?? sr.room_name, sr.suite_type, roomId);
  });
  const guestIds = [...new Set(links.map((sr) => Number(sr.guest_id)).filter(Boolean))];
  if (!guestIds.length) return { guests: [], links };

  const { data: guests, error: guestErr } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
    .in("id", guestIds)
    .neq("status", "cancelled");

  if (guestErr) {
    console.warn("[housekeepingGuestLookup] guests by suite_rooms failed:", guestErr.message);
    return { guests: [], links };
  }
  return { guests: (guests ?? []) as SuiteGuestRow[], links };
}

function mergeGuestRows(primary: SuiteGuestRow[], extra: SuiteGuestRow[]): SuiteGuestRow[] {
  const byId = new Map<number, SuiteGuestRow>();
  for (const g of [...primary, ...extra]) {
    if (g?.id) byId.set(g.id, g);
  }
  return [...byId.values()];
}

function mergeSuiteLinks(a: SuiteRoomLink[], b: SuiteRoomLink[]): SuiteRoomLink[] {
  const seen = new Set<string>();
  const out: SuiteRoomLink[] = [];
  for (const sr of [...a, ...b]) {
    const key = `${sr.guest_id}:${sr.room_display ?? ""}:${sr.room_name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sr);
  }
  return out;
}

function pickBestMatch(
  rows: SuiteGuestRow[],
  roomId: string,
  suiteLinks: SuiteRoomLink[],
  today: string,
  scoreFn: (g: SuiteGuestRow, today: string) => number,
): GuestLookupResult {
  const matches = rows
    .filter((g) => guestMatchesRoom(g, roomId, suiteLinks))
    .map((g) => ({ g, score: scoreFn(g, today) }))
    .filter(({ score }) => score < HOUSEKEEPING_SCORE_OUT_OF_RANGE);

  if (!matches.length) return { guest: null, ambiguous: [] };
  if (matches.length === 1) return { guest: matches[0].g, ambiguous: [] };

  matches.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const depCmp = (b.g.departure_date ?? "").localeCompare(a.g.departure_date ?? "");
    if (depCmp !== 0) return depCmp;
    return (b.g.arrival_date ?? "").localeCompare(a.g.arrival_date ?? "");
  });

  const bestScore = matches[0].score;
  const tied = matches.filter((m) => m.score === bestScore).map((m) => m.g);

  if (tied.length > 1) {
    console.warn(
      `[housekeepingGuestLookup] ambiguous match for ${roomId} (score=${bestScore}):`,
      tied.map((g) =>
        `${g.id}:${g.name}:${g.status}:arr=${g.arrival_date}:dep=${g.departure_date ?? "—"}`
      ).join(", "),
    );
    return { guest: null, ambiguous: tied };
  }

  return { guest: matches[0].g, ambiguous: [] };
}

/** Guest with arrival_date = today (Israel) — room-ready bell + WA ack. */
export async function findArrivingTodayGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<GuestLookupResult> {
  const today = israelYmd(new Date());

  const [{ data: rows, error }, viaSuite] = await Promise.all([
    supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("arrival_date", today)
      .neq("status", "cancelled")
      .in("status", [...READY_GUEST_STATUSES]),
    loadGuestsBySuiteRoomToday(supabase, roomId, today),
  ]);

  if (error) {
    console.warn(`[housekeepingGuestLookup] today lookup failed for ${roomId}:`, error.message);
    return { guest: null, ambiguous: [] };
  }

  const merged = mergeGuestRows((rows ?? []) as SuiteGuestRow[], viaSuite.guests);
  const guestIds = merged.map((g) => g.id);
  const suiteLinks = mergeSuiteLinks(
    await loadSuiteRoomLinks(supabase, guestIds),
    viaSuite.links,
  );

  return pickBestMatch(merged, roomId, suiteLinks, today, scoreGuestForReadyBell);
}

/** Arriving today — eligible for physical check-in from WA group. */
export async function findIncomingGuestForSuiteCheckIn(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<GuestLookupResult> {
  const today = israelYmd(new Date());

  const [{ data: rows, error }, viaSuite] = await Promise.all([
    supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("arrival_date", today)
      .neq("status", "cancelled")
      .in("status", [...CHECKIN_ELIGIBLE_STATUSES]),
    loadGuestsBySuiteRoomToday(supabase, roomId, today),
  ]);

  if (error) {
    console.warn(`[housekeepingGuestLookup] incoming check-in lookup failed for ${roomId}:`, error.message);
    return { guest: null, ambiguous: [] };
  }

  const merged = mergeGuestRows((rows ?? []) as SuiteGuestRow[], viaSuite.guests);
  const suiteLinks = mergeSuiteLinks(
    await loadSuiteRoomLinks(supabase, merged.map((g) => g.id)),
    viaSuite.links,
  );

  return pickBestMatch(merged, roomId, suiteLinks, today, scoreGuestForCheckIn);
}

/** In-house guest who should have left — turnover when new arrival checks in same room. */
export async function findInHouseDepartingGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<GuestLookupResult> {
  const today = israelYmd(new Date());

  const { data: rows, error } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
    .eq("status", "checked_in")
    .neq("status", "cancelled")
    .not("departure_date", "is", null)
    .lte("departure_date", today)
    .lte("arrival_date", today)
    .order("departure_date", { ascending: false })
    .limit(40);

  if (error) {
    console.warn(`[housekeepingGuestLookup] in-house departing lookup failed for ${roomId}:`, error.message);
    return { guest: null, ambiguous: [] };
  }

  const candidates = (rows ?? []) as SuiteGuestRow[];
  const suiteLinks = await loadSuiteRoomLinks(supabase, candidates.map((g) => g.id));
  return pickBestMatch(candidates, roomId, suiteLinks, today, scoreGuestForCheckout);
}

/**
 * In-stay checked_in guest (ready: skip bell) OR late check-in fallback (arrival < today).
 * Never returns stale expected rows outside the departure window.
 */
export async function findActiveGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<GuestLookupResult> {
  const today = israelYmd(new Date());

  const [{ data: inHouse }, { data: lateCheckIn }] = await Promise.all([
    supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("status", "checked_in")
      .neq("status", "cancelled")
      .lte("arrival_date", today)
      .or(`departure_date.is.null,departure_date.gte.${today}`)
      .order("arrival_date", { ascending: false })
      .limit(20),
    supabase
      .from("guests")
      .select(GUEST_SELECT)
      .neq("status", "cancelled")
      .lt("arrival_date", today)
      .not("departure_date", "is", null)
      .gte("departure_date", today)
      .in("status", [...CHECKIN_ELIGIBLE_STATUSES])
      .order("arrival_date", { ascending: false })
      .limit(20),
  ]);

  const merged = mergeGuestRows(
    (inHouse ?? []) as SuiteGuestRow[],
    (lateCheckIn ?? []) as SuiteGuestRow[],
  );

  const viaSuite = await loadGuestsBySuiteRoomToday(supabase, roomId, today);
  const withSuite = mergeGuestRows(merged, viaSuite.guests.filter((g) =>
    g.status === "checked_in" || CHECKIN_ELIGIBLE_STATUSES.has(g.status),
  ));

  const suiteLinks = mergeSuiteLinks(
    await loadSuiteRoomLinks(supabase, withSuite.map((g) => g.id)),
    viaSuite.links,
  );

  const inStay = pickBestMatch(withSuite, roomId, suiteLinks, today, scoreGuestForInHouseStay);
  if (inStay.guest) return inStay;

  return pickBestMatch(withSuite, roomId, suiteLinks, today, scoreGuestForCheckIn);
}

const CHECKOUT_CANDIDATE_STATUSES = [
  "pending",
  "expected",
  "room_ready",
  "checked_in",
  "checked_out",
] as const;

/**
 * Guest due to leave today (or overdue) in this suite — WA "Co N" check-out.
 * Requires departure_date — no Co without a defined departure.
 */
export async function findDepartingGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<GuestLookupResult> {
  const today = israelYmd(new Date());

  const [{ data: rows, error }, viaSuite] = await Promise.all([
    supabase
      .from("guests")
      .select(GUEST_SELECT)
      .neq("status", "cancelled")
      .lte("arrival_date", today)
      .not("departure_date", "is", null)
      .lte("departure_date", today)
      .in("status", [...CHECKOUT_CANDIDATE_STATUSES])
      .order("departure_date", { ascending: false })
      .limit(40),
    loadGuestsDepartingBySuiteRoom(supabase, roomId, today),
  ]);

  if (error) {
    console.warn(`[housekeepingGuestLookup] departing lookup failed for ${roomId}:`, error.message);
    return { guest: null, ambiguous: [] };
  }

  const candidates = mergeGuestRows((rows ?? []) as SuiteGuestRow[], viaSuite.guests);
  const suiteLinks = mergeSuiteLinks(
    await loadSuiteRoomLinks(supabase, candidates.map((g) => g.id)),
    viaSuite.links,
  );

  const picked = pickBestMatch(candidates, roomId, suiteLinks, today, scoreGuestForCheckout);
  if (!picked.guest) return picked;

  if (picked.guest.status === "checked_out") {
    const active = candidates.find(
      (g) =>
        guestMatchesRoom(g, roomId, suiteLinks) &&
        ACTIVE_STATUSES.includes(g.status as typeof ACTIVE_STATUSES[number]) &&
        g.status !== "checked_out" &&
        scoreGuestForCheckout(g, today) < HOUSEKEEPING_SCORE_OUT_OF_RANGE,
    );
    if (active) return { guest: active, ambiguous: [] };
  }
  return picked;
}

const AMBIGUOUS_HINT_MAX_NAMES = 2;

/** Capped at 2 names so a wide tie (e.g. many historical occupants of the same
 * physical room) never renders as a wall of text — whether logged or, if
 * HOUSEKEEPING_WA_GROUP_REPLY is ever turned on, sent to the group. */
export function formatAmbiguousGuestHint(candidates: SuiteGuestRow[]): string {
  const shown = candidates
    .slice(0, AMBIGUOUS_HINT_MAX_NAMES)
    .map((g) => `${g.name ?? "—"} (הגעה ${g.arrival_date ?? "?"}, עזיבה ${g.departure_date ?? "?"})`);
  const remaining = candidates.length - shown.length;
  if (remaining > 0) shown.push(`ועוד ${remaining}`);
  return shown.join(" · ");
}
