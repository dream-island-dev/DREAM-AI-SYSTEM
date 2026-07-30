// Scoped fetch + cross-mount memory cache for GuestsPage (צ'ק-אין).
import { SUITE_REGISTRY } from "../data/suiteRegistry";
import {
  CHECKIN_TIMELINE_ARCHIVE,
  CHECKIN_TIMELINE_TODAY,
  CHECKIN_TIMELINE_TOMORROW,
  CHECKIN_TIMELINE_WEEK7,
  countCheckinScopeTotals,
} from "./guestCheckinMatrix";
import { isSuiteGuestProfile, israelDateOffsetStr, israelTodayStr } from "./guestTiming";

/** Explicit columns — avoids heavy guest_profile JSONB on full-table scans. */
export const CHECKIN_GUESTS_SELECT =
  "id, name, phone, room, room_type, arrival_date, departure_date, status, " +
  "msg_pre_arrival_sent, msg_room_ready_sent, msg_post_checkin_sent, room_ready_notified, " +
  "requires_attention, guest_notes, guest_profile, arrival_time, attention_reason, arrival_confirmed, " +
  "spa_time, spa_date, meal_time, meal_location, meal_plan, breakfast_time, lunch_time, dinner_time, " +
  "treatment_count, order_number, payment_amount, payment_link_url, direct_payment_url, " +
  "needs_callback, portal_token, lead_source, automation_muted";

export const CHECKIN_SCOPE_COUNT_SELECT =
  "id, arrival_date, departure_date, status, room_type, room, phone";

/** Survives GuestsPage unmount — instant paint on tab return (Inbox pattern). */
export const guestsPageMemoryCache = {
  guestsByScope: {},
  suiteRoomsByScope: {},
  roomByPhone: null,
  scopeCounts: null,
  scopeCountsAt: 0,
};

const SCOPE_COUNTS_TTL_MS = 5 * 60_000;

function quotedInList(values) {
  return values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",");
}

/** Cache key for scoped roster payloads. */
export function getCheckinScopeCacheKey(scope, customArrivalDate) {
  if (customArrivalDate) return `date:${customArrivalDate}`;
  return `scope:${scope || CHECKIN_TIMELINE_TODAY}`;
}

export function readCachedCheckinScope(scope, customArrivalDate) {
  const key = getCheckinScopeCacheKey(scope, customArrivalDate);
  if (!Object.prototype.hasOwnProperty.call(guestsPageMemoryCache.guestsByScope, key)) {
    return null;
  }
  return {
    guests: guestsPageMemoryCache.guestsByScope[key],
    suiteRoomsByGuestId: guestsPageMemoryCache.suiteRoomsByScope[key] ?? {},
    roomByPhone: guestsPageMemoryCache.roomByPhone ?? {},
    scopeCounts: guestsPageMemoryCache.scopeCounts,
  };
}

export function writeCachedCheckinScope(scope, customArrivalDate, { guests, suiteRoomsByGuestId }) {
  const key = getCheckinScopeCacheKey(scope, customArrivalDate);
  guestsPageMemoryCache.guestsByScope[key] = guests;
  guestsPageMemoryCache.suiteRoomsByScope[key] = suiteRoomsByGuestId;
}

export function writeCachedRoomByPhone(map) {
  guestsPageMemoryCache.roomByPhone = map;
}

export function writeCachedScopeCounts(counts) {
  guestsPageMemoryCache.scopeCounts = counts;
  guestsPageMemoryCache.scopeCountsAt = Date.now();
}

function suiteRoomOrFilter() {
  return `room_type.eq.suite,room.in.(${quotedInList(SUITE_REGISTRY)})`;
}

/**
 * Server-side scope filter (superset). GuestsPage still applies
 * applyCheckinRosterFilter client-side for exact matrix rules.
 */
export function applyCheckinScopeSupabaseFilter(query, { scope, customArrivalDate, today = israelTodayStr() }) {
  let q = query.neq("status", "cancelled");
  if (customArrivalDate) {
    return q.eq("arrival_date", customArrivalDate);
  }

  const tomorrow = israelDateOffsetStr(1, today);
  const weekEnd = israelDateOffsetStr(6, today);

  switch (scope) {
    case CHECKIN_TIMELINE_TODAY:
      return q.or(
        `and(status.eq.checked_in,arrival_date.lte.${today},or(departure_date.is.null,departure_date.gte.${today})),` +
        `and(arrival_date.eq.${today},status.in.(pending,expected,room_ready))`,
      );
    case CHECKIN_TIMELINE_TOMORROW:
      return q
        .eq("arrival_date", tomorrow)
        .in("status", ["pending", "expected", "room_ready", "checked_in"]);
    case CHECKIN_TIMELINE_WEEK7:
      return q
        .gte("arrival_date", today)
        .lte("arrival_date", weekEnd)
        .in("status", ["pending", "expected", "room_ready", "checked_in"]);
    case CHECKIN_TIMELINE_ARCHIVE:
      return q.or(`status.eq.checked_out,and(departure_date.lt.${today},status.neq.checked_in)`);
    default:
      return q;
  }
}

export async function fetchCheckinGuestsForScope(supabase, { scope, customArrivalDate }) {
  let query = supabase
    .from("guests")
    .select(CHECKIN_GUESTS_SELECT)
    .order("arrival_date", { ascending: true })
    .order("id", { ascending: true });

  query = applyCheckinScopeSupabaseFilter(query, { scope, customArrivalDate });
  const { data, error } = await query;
  return { data: data ?? [], error };
}

/** Lightweight rows for filter-bar badge counts — cached ~5 min. */
export async function fetchCheckinScopeCounts(supabase, { force = false } = {}) {
  const stale =
    force ||
    !guestsPageMemoryCache.scopeCounts ||
    Date.now() - guestsPageMemoryCache.scopeCountsAt > SCOPE_COUNTS_TTL_MS;

  if (!stale) {
    return { counts: guestsPageMemoryCache.scopeCounts, error: null };
  }

  const { data, error } = await supabase
    .from("guests")
    .select(CHECKIN_SCOPE_COUNT_SELECT)
    .or(suiteRoomOrFilter())
    .neq("status", "cancelled");

  if (error) return { counts: guestsPageMemoryCache.scopeCounts ?? {}, error };

  const suiteRows = (data ?? []).filter((g) => isSuiteGuestProfile(g));
  const counts = countCheckinScopeTotals(suiteRows);
  writeCachedScopeCounts(counts);
  return { counts, error: null };
}

export async function fetchCheckinRoomByPhone(supabase) {
  const { data } = await supabase
    .from("suite_rooms")
    .select("room_name, suite_type, arrival_date, guest_phone, is_day_guest")
    .order("arrival_date", { ascending: true })
    .order("room_name", { ascending: true });

  const map = {};
  for (const r of data ?? []) {
    if (r.guest_phone && !map[r.guest_phone]) {
      map[r.guest_phone] = {
        roomName: r.room_name,
        suiteType: r.suite_type,
        isDayGuest: !!r.is_day_guest,
      };
    }
  }
  writeCachedRoomByPhone(map);
  return map;
}
