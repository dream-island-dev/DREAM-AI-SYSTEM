// Live guest ↔ suite matching for housekeeping WA signals (ready + check-in).
// Mirrors src/data/suiteRegistry.js guestRoomMatchesSuiteId at the Deno boundary.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { guestRoomMatchesSuiteId } from "./guestRoomResolve.ts";

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

const ACTIVE_STATUSES = ["pending", "expected", "room_ready", "checked_in"] as const;

function pickBestMatch(rows: SuiteGuestRow[], roomId: string): SuiteGuestRow | null {
  const matches = rows.filter((g) => guestRoomMatchesSuiteId(g, roomId));
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const exact = matches.find((g) => g.room === roomId || g.suite_name === roomId);
  if (exact) return exact;
  console.warn(
    `[housekeepingGuestLookup] ambiguous match for ${roomId}:`,
    matches.map((g) => `${g.id}:${g.name}`).join(", "),
  );
  return matches[0];
}

/** Guest with arrival_date = today (Israel) — room-ready bell + WA ack. */
export async function findArrivingTodayGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<SuiteGuestRow | null> {
  const today = israelYmd(new Date());
  const { data: rows, error } = await supabase
    .from("guests")
    .select(
      "id, name, phone, spa_time, room, suite_name, status, arrival_date, departure_date, guest_notes, room_ready_notified, msg_room_ready_sent",
    )
    .eq("arrival_date", today)
    .neq("status", "cancelled")
    .in("status", ["pending", "expected", "room_ready"]);

  if (error) {
    console.warn(`[housekeepingGuestLookup] today lookup failed for ${roomId}:`, error.message);
    return null;
  }
  return pickBestMatch((rows ?? []) as SuiteGuestRow[], roomId);
}

/** In-stay window guest — check-in from WA group. */
export async function findActiveGuestForSuite(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<SuiteGuestRow | null> {
  const today = israelYmd(new Date());
  const { data: rows, error } = await supabase
    .from("guests")
    .select(
      "id, name, phone, spa_time, room, suite_name, status, arrival_date, departure_date, guest_notes, room_ready_notified, msg_room_ready_sent",
    )
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
    ACTIVE_STATUSES.includes(g.status as typeof ACTIVE_STATUSES[number])
  ) as SuiteGuestRow[];
  return pickBestMatch(inScope, roomId);
}
