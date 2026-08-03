// Inbox guest identity map + roster-anchor hydration (suite in-resort / arriving today).

import { pickGuestProfileByPhone } from "./guestProfilePick";
import {
  isGuestDeparted,
  isSuiteArrivingToday,
  isSuiteGuestProfile,
  isSuiteInResortToday,
  israelTodayStr,
} from "./guestTiming";

export const INBOX_GUEST_MAP_COLUMNS =
  "id, name, phone, status, arrival_date, departure_date, room, room_type, " +
  "spa_time, spa_date, portal_token, meal_time, meal_location, claimed_by, claimed_at, guest_profile";

const MAP_PAGE_SIZE = 1000;

/** Last-9-digit compare — mirrors WhatsAppInbox.normalizePhone. */
export function inboxNormalizePhone(phoneStr) {
  if (!phoneStr) return "";
  return String(phoneStr).replace(/\D/g, "").slice(-9);
}

export function inboxPhonesMatch(a, b) {
  const na = inboxNormalizePhone(a);
  const nb = inboxNormalizePhone(b);
  return !!na && na === nb;
}

export function toInboxGuestMapEntry(g) {
  if (!g?.id) return null;
  return {
    id: g.id,
    name: g.name ?? null,
    status: g.status ?? null,
    arrival_date: g.arrival_date ?? null,
    departure_date: g.departure_date ?? null,
    room: g.room ?? null,
    room_type: g.room_type ?? null,
    spa_time: g.spa_time ?? null,
    spa_date: g.spa_date ?? null,
    portal_token: g.portal_token ?? null,
    meal_time: g.meal_time ?? null,
    meal_location: g.meal_location ?? null,
    claimed_by: g.claimed_by ?? null,
    claimed_at: g.claimed_at ?? null,
    guest_profile: g.guest_profile ?? null,
  };
}

export function buildGuestMapsFromRows(rows, today = israelTodayStr()) {
  const phoneBuckets = new Map();
  const idMap = new Map();

  for (const g of rows ?? []) {
    const entry = toInboxGuestMapEntry(g);
    if (!entry) continue;
    idMap.set(entry.id, entry);
    const key = inboxNormalizePhone(g.phone);
    if (!key) continue;
    if (!phoneBuckets.has(key)) phoneBuckets.set(key, []);
    phoneBuckets.get(key).push(g);
  }

  const phoneMap = new Map();
  for (const [key, bucket] of phoneBuckets) {
    const picked = pickGuestProfileByPhone(bucket, today);
    const entry = toInboxGuestMapEntry(picked);
    if (entry) phoneMap.set(key, entry);
  }
  return { phoneMap, idMap };
}

/** Paginate past PostgREST 1000-row cap — full phone map for identity resolution. */
export async function fetchAllGuestsForInboxMap(supabase) {
  const all = [];
  for (let from = 0; ; from += MAP_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("guests")
      .select(INBOX_GUEST_MAP_COLUMNS)
      .not("phone", "is", null)
      .order("id", { ascending: true })
      .range(from, from + MAP_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < MAP_PAGE_SIZE) break;
  }
  return all;
}

export function shouldHydrateInboxRosterAnchor(g, today = israelTodayStr()) {
  if (!String(g?.phone ?? "").trim()) return false;
  if (!isSuiteGuestProfile(g)) return false;
  if (isGuestDeparted(g)) return false;
  return isSuiteInResortToday(g) || isSuiteArrivingToday(g);
}

/** Paginate past PostgREST 1000-row cap for a filtered guests query. */
async function fetchPaginatedGuests(supabase, applyFilter) {
  const all = [];
  for (let from = 0; ; from += MAP_PAGE_SIZE) {
    const { data, error } = await applyFilter(
      supabase.from("guests").select(INBOX_GUEST_MAP_COLUMNS),
    )
      .order("id", { ascending: true })
      .range(from, from + MAP_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < MAP_PAGE_SIZE) break;
  }
  return all;
}

/** Suite guests physically in-house or arriving today — small scoped query. */
export async function fetchInboxRosterAnchorGuests(supabase, today = israelTodayStr()) {
  const [checkedIn, arriving] = await Promise.all([
    fetchPaginatedGuests(supabase, (q) => q.eq("status", "checked_in").not("phone", "is", null)),
    fetchPaginatedGuests(supabase, (q) =>
      q
        .eq("arrival_date", today)
        .in("status", ["pending", "expected", "room_ready"])
        .not("phone", "is", null),
    ),
  ]);

  const byId = new Map();
  for (const g of [...checkedIn, ...arriving]) {
    if (g?.id) byId.set(g.id, g);
  }
  return [...byId.values()].filter((g) => shouldHydrateInboxRosterAnchor(g, today));
}

export function buildGhostContactFromGuestEntry(entry, canonicalizePhone) {
  const phone = canonicalizePhone(entry.phone);
  return {
    threadKey: phone,
    phone,
    inbox_channel: "unified",
    channelsPresent: [],
    guestId: entry.id,
    guestName: entry.name ?? null,
    status: entry.status ?? null,
    arrivalDate: entry.arrival_date ?? null,
    departureDate: entry.departure_date ?? null,
    room: entry.room ?? null,
    roomType: entry.room_type ?? null,
    spaTime: entry.spa_time ?? null,
    spaDate: entry.spa_date ?? null,
    portalToken: entry.portal_token ?? null,
    mealTime: entry.meal_time ?? null,
    mealLocation: entry.meal_location ?? null,
    claimedBy: entry.claimed_by ?? null,
    claimedAt: entry.claimed_at ?? null,
    guestProfile: entry.guest_profile ?? null,
    pushName: null,
    messages: [],
    humanRequested: false,
    humanRequestType: null,
    isRosterAnchor: true,
  };
}

/**
 * Inject suite in-resort / arriving-today guests missing from the WA recency window.
 * Existing threads win — never duplicate a phone already in contacts.
 */
export function mergeRosterAnchorContacts(contacts, anchorGuests, canonicalizePhone) {
  if (!anchorGuests?.length) return contacts;
  const existing = new Set(
    (contacts ?? []).map((c) => inboxNormalizePhone(c.phone)),
  );
  const ghosts = [];
  for (const g of anchorGuests) {
    const key = inboxNormalizePhone(g.phone);
    if (!key || existing.has(key)) continue;
    const entry = toInboxGuestMapEntry(g);
    if (!entry) continue;
    ghosts.push(buildGhostContactFromGuestEntry(entry, canonicalizePhone));
    existing.add(key);
  }
  if (!ghosts.length) return contacts;
  return [...contacts, ...ghosts];
}

export function lookupGuestFromMaps(phone, guestId, phoneMap, idMap) {
  const byPhone = phoneMap?.get(inboxNormalizePhone(phone));
  if (byPhone?.id) return byPhone;
  if (guestId == null || !idMap) return null;
  return idMap.get(guestId) ?? idMap.get(Number(guestId)) ?? null;
}
