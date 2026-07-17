// Live guest ↔ suite matching for housekeeping WA signals (ready / check-in / check-out).
// Matches guests.room AND suite_rooms rows (multi-room) — mirrors roomBoardGuestResolve.js.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { guestRoomMatchesSuiteId } from "./guestRoomResolve.ts";
import {
  scoreGuestForCheckIn,
  scoreGuestForCheckout,
  scoreGuestForReadyBell,
  CHECKIN_ELIGIBLE_STATUSES,
  READY_GUEST_STATUSES,
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

interface SuiteRoomLink {
  guest_id: number;
  room_display: string | null;
  room_name: string | null;
  suite_type: string | null;
  arrival_date: string | null;
}

const GUEST_SELECT =
  "id, name, phone, spa_time, room, suite_name, status, arrival_date, departure_date, guest_notes, room_ready_notified, msg_room_ready_sent";

const ACTIVE_STATUSES = ["pending", "expected", "room_ready", "checked_in"] as const;

function guestMatchesRoom(
  guest: SuiteGuestRow,
  roomId: string,
  suiteLinks: SuiteRoomLink[],
): boolean {
  if (guestRoomMatchesSuiteId(guest, roomId)) return true;
  const links = suiteLinks.filter((sr) => Number(sr.guest_id) === Number(guest.id));
  return links.some((sr) =>
    guestRoomMatchesSuiteId(
      { room: sr.room_display ?? sr.room_name, suite_name: sr.suite_type },
      roomId,
    )
  );
}

async function loadSuiteRoomLinks(
  supabase: ReturnType<typeof createClient>,
  guestIds: number[],
): Promise<SuiteRoomLink[]> {
  if (!guestIds.length) return [];
  const { data, error } = await supabase
    .from("suite_rooms")
    .select("guest_id, room_display, room_name, suite_type, arrival_date")
    .in("guest_id", guestIds);
  if (error) {
    console.warn("[housekeepingGuestLookup] suite_rooms load failed:", error.message);
    return [];
  }
  return (data ?? []) as SuiteRoomLink[];
}

async function loadGuestsBySuiteRoomToday(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
  today: string,
): Promise<{ guests: SuiteGuestRow[]; links: SuiteRoomLink[] }> {
  const { data: suiteRows, error } = await supabase
    .from("suite_rooms")
    .select("guest_id, room_display, room_name, suite_type, arrival_date")
    .eq("arrival_date", today)
    .not("guest_id", "is", null);

  if (error) {
    console.warn("[housekeepingGuestLookup] suite_rooms today scan failed:", error.message);
    return { guests: [], links: [] };
  }

  const links = ((suiteRows ?? []) as SuiteRoomLink[]).filter((sr) =>
    guestRoomMatchesSuiteId(
      { room: sr.room_display ?? sr.room_name, suite_name: sr.suite_type },
      roomId,
    )
  );
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

function pickBestMatch(
  rows: SuiteGuestRow[],
  roomId: string,
  suiteLinks: SuiteRoomLink[],
  scoreFn: (g: SuiteGuestRow) => number,
): SuiteGuestRow | null {
  const matches = rows.filter((g) => guestMatchesRoom(g, roomId, suiteLinks));
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  matches.sort((a, b) => {
    const sa = scoreFn(a);
    const sb = scoreFn(b);
    if (sa !== sb) return sa - sb;
    return (b.arrival_date ?? "").localeCompare(a.arrival_date ?? "");
  });

  const best = matches[0];
  const tied = matches.filter((g) => scoreFn(g) === scoreFn(best));
  if (tied.length > 1) {
    console.warn(
      `[housekeepingGuestLookup] ambiguous match for ${roomId}:`,
      tied.map((g) => `${g.id}:${g.name}:${g.status}`).join(", "),
    );
  }
  return best;
}

/** Guest with arrival_date = today (Israel) — room-ready bell + WA ack. */
export async function findArrivingTodayGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<SuiteGuestRow | null> {
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
    return null;
  }

  const merged = mergeGuestRows((rows ?? []) as SuiteGuestRow[], viaSuite.guests);
  const guestIds = merged.map((g) => g.id);
  const suiteLinks = mergeSuiteLinks(
    await loadSuiteRoomLinks(supabase, guestIds),
    viaSuite.links,
  );

  return pickBestMatch(merged, roomId, suiteLinks, scoreGuestForReadyBell);
}

/** In-stay window guest — check-in from WA group. */
export async function findActiveGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<SuiteGuestRow | null> {
  const today = israelYmd(new Date());

  const { data: rows, error } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
    .neq("status", "cancelled")
    .lte("arrival_date", today)
    .or(`departure_date.is.null,departure_date.gte.${today}`)
    .order("arrival_date", { ascending: false })
    .limit(40);

  if (error) {
    console.warn(`[housekeepingGuestLookup] active lookup failed for ${roomId}:`, error.message);
    return null;
  }

  const inScope = (rows ?? []).filter((g) =>
    ACTIVE_STATUSES.includes(g.status as typeof ACTIVE_STATUSES[number]) ||
    CHECKIN_ELIGIBLE_STATUSES.has(g.status)
  ) as SuiteGuestRow[];

  const viaSuite = await loadGuestsBySuiteRoomToday(supabase, roomId, today);
  const merged = mergeGuestRows(inScope, viaSuite.guests.filter((g) =>
    CHECKIN_ELIGIBLE_STATUSES.has(g.status) || g.status === "checked_in"
  ));

  const suiteLinks = mergeSuiteLinks(
    await loadSuiteRoomLinks(supabase, merged.map((g) => g.id)),
    viaSuite.links,
  );

  return pickBestMatch(merged, roomId, suiteLinks, scoreGuestForCheckIn);
}

const CHECKOUT_CANDIDATE_STATUSES = [
  "pending",
  "expected",
  "room_ready",
  "checked_in",
  "checked_out",
] as const;

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

/**
 * Guest due to leave today (or overdue) in this suite — WA "Co N" check-out.
 * Includes already-checked_out so the signal can ack idempotently.
 */
export async function findDepartingGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<SuiteGuestRow | null> {
  const today = israelYmd(new Date());

  const { data: rows, error } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
    .neq("status", "cancelled")
    .lte("arrival_date", today)
    .or(`departure_date.lte.${today},and(departure_date.is.null,arrival_date.lte.${today})`)
    .in("status", [...CHECKOUT_CANDIDATE_STATUSES])
    .order("departure_date", { ascending: false })
    .limit(40);

  if (error) {
    console.warn(`[housekeepingGuestLookup] departing lookup failed for ${roomId}:`, error.message);
    return null;
  }

  const candidates = (rows ?? []) as SuiteGuestRow[];
  const suiteLinks = await loadSuiteRoomLinks(supabase, candidates.map((g) => g.id));

  const matched = pickBestMatch(candidates, roomId, suiteLinks, scoreGuestForCheckout);
  if (!matched) return null;

  if (matched.status === "checked_out") {
    const active = candidates.find(
      (g) =>
        guestMatchesRoom(g, roomId, suiteLinks) &&
        ACTIVE_STATUSES.includes(g.status as typeof ACTIVE_STATUSES[number]),
    );
    if (active) return active;
  }
  return matched;
}
