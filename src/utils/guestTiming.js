// src/utils/guestTiming.js
// Shared "is this guest here yet?" badge for boards that surface a request/task
// tied to a guest_id (OperationsBoard.js, RequestsBoard.js) — computed LIVE from
// the joined guests row (arrival_date/departure_date/status) rather than a
// snapshot frozen at request-creation time, per CLAUDE.md §0.5 Single Source of
// Truth: guests.status/arrival_date is the golden profile, so a request that sits
// open for a day shows the guest's CURRENT state, not a stale one.

import { SUITE_REGISTRY } from "../data/suiteRegistry";

/** Calendar today in Israel (YYYY-MM-DD) — matches DATE columns as hotel-local days. */
export function israelTodayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** Israel-local calendar day offset from today (or from baseYmd). */
export function israelDateOffsetStr(offsetDays, baseYmd = israelTodayStr()) {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

/** True when guest.arrival_date is exactly today in Israel. */
export function isArrivalToday(arrivalDateStr) {
  if (!arrivalDateStr) return false;
  return arrivalDateStr === israelTodayStr();
}

const PRE_ARRIVAL_STATUSES = new Set(["pending", "expected", "room_ready"]);

/** Arrival day, pre check-in (pending / expected / room_ready). */
export function isPreArrivalTodayGuest(guest, today = israelTodayStr()) {
  return PRE_ARRIVAL_STATUSES.has(guest?.status) && guest?.arrival_date === today;
}

/** Day-pass / premium day visit — same calendar day only. */
export function isDayPassRoomType(roomType) {
  return roomType === "day_guest" || roomType === "premium_day_guest";
}

/** True when guest is physically in-house: checked_in + within stay window (Israel calendar). */
export function isGuestInResortToday(guest) {
  if (!guest?.arrival_date) return false;
  if (guest.status !== "checked_in") return false;
  if (isGuestDeparted(guest)) return false;
  const today = israelTodayStr();
  if (guest.arrival_date > today) return false;
  if (isDayPassRoomType(guest.room_type)) {
    const departure = guest.departure_date || guest.arrival_date;
    if (departure !== today) return false;
    return guest.arrival_date === today;
  }
  if (guest.departure_date && guest.departure_date < today) return false;
  return true;
}

/** Suite guest checked in and currently in-house. */
export function isSuiteInResortToday(guest) {
  return isSuiteGuestProfile(guest) && isGuestInResortToday(guest);
}

/** Suite guest arriving today, not yet checked in. */
export function isSuiteArrivingToday(guest) {
  return isSuiteGuestProfile(guest) && isPreArrivalTodayGuest(guest);
}

/** Suite profile: explicit room_type or assigned room from SUITE_REGISTRY. */
export function isSuiteGuestProfile({ room_type, room } = {}) {
  if (room_type === "suite") return true;
  if (room && SUITE_REGISTRY.includes(room)) return true;
  return false;
}

/**
 * FAIL VISIBLE (§0.3, session 125 P0): room says suite but room_type says
 * day-pass — the split-brain that misrouted suite guests to day-pass WhatsApp
 * content. The server (suiteNames.ts) routes such guests as SUITE; this badge
 * tells staff the row needs fixing (edit guest → room_type).
 */
export function hasSuiteRoomTypeConflict({ room_type, room } = {}) {
  if (room_type !== "day_guest" && room_type !== "premium_day_guest") return false;
  return !!room && SUITE_REGISTRY.includes(room);
}

/**
 * Inbound message alert class for WhatsAppInbox sounds.
 * @returns {"suite"|"off_resort"|null}
 */
export function classifyInboundMessageAlert(msg) {
  if (!msg || msg.direction !== "inbound") return null;
  if (isSuiteGuestProfile({ room_type: msg.guest_room_type, room: msg.guest_room })) {
    return "suite";
  }
  if (!isGuestInResortToday({
    arrival_date: msg.guest_arrival_date,
    departure_date: msg.guest_departure_date,
    status: msg.guest_status,
  })) {
    return "off_resort";
  }
  return null;
}

/** Calendar-day difference (toYmd − fromYmd) in whole days. */
export function israelDaysBetween(fromYmd, toYmd) {
  if (!fromYmd || !toYmd) return null;
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86400000);
}

/**
 * Roster/thread chip for DB-matched guests — relative arrival ("היום", "מחר", …).
 * @returns {{ label: string, bg: string, fg: string } | null}
 */
export function getGuestArrivalRosterLabel(guest, lang = "he") {
  const en = lang === "en";
  if (!guest?.arrival_date) {
    return {
      label: en ? "📅 No arrival date" : "📅 ללא תאריך הגעה",
      bg: "var(--status-success-bg)",
      fg: "var(--status-success)",
    };
  }

  const today = israelTodayStr();
  const { arrival_date: arrival, departure_date: departure, status } = guest;

  // Departed must win over checked_in / inStay — stale status must not show «בריזורט».
  if (isGuestDeparted(guest)) {
    return {
      label: en ? "⚪ After stay" : "⚪ אחרי עזיבה",
      bg: "var(--ivory)",
      fg: "var(--text-muted)",
    };
  }

  if (isSuiteInResortToday(guest)) {
    return {
      label: en ? "🟢 In resort" : "🟢 בריזורט",
      bg: "#F0FDF4",
      fg: "#15803D",
    };
  }

  if (isSuiteArrivingToday(guest)) {
    return {
      label: en ? "🌅 Arriving today" : "🌅 מגיעים היום",
      bg: "#FFFBEB",
      fg: "#B45309",
    };
  }

  const diff = israelDaysBetween(today, arrival);
  if (diff == null) return null;

  if (diff <= 0) {
    return {
      label: en ? "📅 Today" : "📅 היום",
      bg: "#FFFBEB",
      fg: "#B45309",
    };
  }
  if (diff === 1) {
    return {
      label: en ? "📅 Tomorrow" : "📅 מחר",
      bg: "#FFFBEB",
      fg: "#B45309",
    };
  }
  if (diff === 2) {
    return {
      label: en ? "📅 In 2 days" : "📅 עוד יומיים",
      bg: "#FFFBEB",
      fg: "#B45309",
    };
  }
  if (diff === 3) {
    return {
      label: en ? "📅 In 3 days" : "📅 עוד 3 ימים",
      bg: "#FFFBEB",
      fg: "#B45309",
    };
  }
  return {
    label: en ? `📅 In ${diff} days` : `📅 עוד ${diff} ימים`,
    bg: "#FFFBEB",
    fg: "#B45309",
  };
}

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });

// Returns null when there's nothing to show (no linked guest, or no arrival_date
// on file) — most non-guest tasks (maintenance/housekeeping) correctly render no
// badge at all rather than a misleading default.
export function getGuestTimingBadge(guest) {
  if (!guest || !guest.arrival_date) return null;
  const today = israelTodayStr();

  if (isGuestDeparted(guest)) {
    return { label: "⚪ אורח לאחר עזיבה", bg: "var(--ivory)", color: "var(--text-muted)", border: "var(--border)" };
  }

  if (isGuestInResortToday(guest)) {
    return { label: "🟢 אורח בריזורט", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" };
  }
  if (isSuiteArrivingToday(guest)) {
    return { label: "🌅 מגיעים היום", bg: "#FFFBEB", color: "#B45309", border: "#FDE68A" };
  }
  if (guest.arrival_date > today) {
    return {
      label: `🟡 הגעה עתידית: ${fmtDate(guest.arrival_date)}`,
      bg: "#FFFBEB", color: "#B45309", border: "#FDE68A",
    };
  }
  return { label: "⚪ אורח לאחר עזיבה", bg: "var(--ivory)", color: "var(--text-muted)", border: "var(--border)" };
}

/** Guest has left the resort — hide from default inbox roster (separate filter). */
export function isGuestDeparted(guest) {
  if (!guest) return false;
  if (guest.status === "checked_out" || guest.status === "cancelled") return true;
  const today = israelTodayStr();
  if (guest.departure_date && guest.departure_date < today) return true;
  return false;
}

/** Normalize inbox contact / guests row to profile fields for roster classification. */
export function rosterGuestFields(contact) {
  if (!contact) {
    return { arrival_date: null, departure_date: null, status: null, room: null, room_type: null };
  }
  return {
    arrival_date: contact.arrival_date ?? contact.arrivalDate ?? null,
    departure_date: contact.departure_date ?? contact.departureDate ?? null,
    status: contact.status ?? null,
    room: contact.room ?? null,
    room_type: contact.room_type ?? contact.roomType ?? null,
  };
}

/**
 * Inbox roster segment for filtering + grouped sections (Israel calendar).
 * @returns {"departed"|"no_date"|"in_resort"|"arriving_today"|"tomorrow"|"in_2_days"|"future"}
 */
export function classifyInboxRosterSegment(guest) {
  const g = rosterGuestFields(guest);
  if (isGuestDeparted(g)) return "departed";
  if (!g.arrival_date) return "no_date";
  if (isSuiteInResortToday(g)) return "in_resort";
  if (isSuiteArrivingToday(g)) return "arriving_today";

  const diff = israelDaysBetween(israelTodayStr(), g.arrival_date);
  if (diff === 1) return "tomorrow";
  if (diff === 2) return "in_2_days";
  return "future";
}

/**
 * Inbox roster segment — requires an active guests row (guestId).
 * Stale arrival_date on a deleted profile must not land in "מחר".
 */
export function classifyInboxContactSegment(contact) {
  const guestId = contact?.guestId ?? contact?.guest_id ?? null;
  if (!guestId) {
    const g = rosterGuestFields(contact);
    if (isGuestDeparted(g)) return "departed";
    return "no_date";
  }
  return classifyInboxRosterSegment(contact);
}

/** Display order for grouped inbox roster (excludes departed — separate tab). */
export const INBOX_ROSTER_SEGMENT_ORDER = [
  "in_resort",
  "arriving_today",
  "tomorrow",
  "in_2_days",
  "future",
  "no_date",
];

const INBOX_SEGMENT_META = {
  he: {
    unread: { label: "🔵 הודעות חדשות", bg: "#EFF6FF", fg: "#1D4ED8" },
    in_resort: { label: "🟢 בריזורט", bg: "#F0FDF4", fg: "#15803D" },
    arriving_today: { label: "🌅 מגיעים היום", bg: "#FFFBEB", fg: "#B45309" },
    tomorrow: { label: "📅 מחר", bg: "#FFFBEB", fg: "#B45309" },
    in_2_days: { label: "📅 עוד יומיים", bg: "#FFFBEB", fg: "#B45309" },
    future: { label: "📅 הגעה עתידית", bg: "#FFFBEB", fg: "#B45309" },
    no_date: { label: "📅 ללא תאריך הגעה", bg: "var(--ivory)", fg: "var(--text-muted)" },
    alerts: { label: "🔴 דורש תשומת לב", bg: "#FEF2F2", fg: "#B91C1C" },
  },
  en: {
    unread: { label: "🔵 New messages", bg: "#EFF6FF", fg: "#1D4ED8" },
    in_resort: { label: "🟢 In resort", bg: "#F0FDF4", fg: "#15803D" },
    arriving_today: { label: "🌅 Arriving today", bg: "#FFFBEB", fg: "#B45309" },
    tomorrow: { label: "📅 Tomorrow", bg: "#FFFBEB", fg: "#B45309" },
    in_2_days: { label: "📅 In 2 days", bg: "#FFFBEB", fg: "#B45309" },
    future: { label: "📅 Future arrival", bg: "#FFFBEB", fg: "#B45309" },
    no_date: { label: "📅 No arrival date", bg: "var(--ivory)", fg: "var(--text-muted)" },
    alerts: { label: "🔴 Needs attention", bg: "#FEF2F2", fg: "#B91C1C" },
  },
};

export function getInboxRosterSegmentMeta(segment, lang = "he") {
  const pack = INBOX_SEGMENT_META[lang === "en" ? "en" : "he"];
  return pack[segment] ?? { label: segment, bg: "var(--ivory)", fg: "var(--text-muted)" };
}

/**
 * Align an inbox roster contact with the live guests phone map.
 * When the guest row was deleted (no map entry), strip DB profile fields so stale
 * denormalized data from old whatsapp_conversations rows cannot show "מחר" etc.
 * When a live row exists — map is the only source of truth for profile fields
 * (no merge with stale contact).
 *
 * Claim state is per-channel (migration 171):
 * - Meta threads: guests.claimed_by / claimed_at on the map entry.
 * - Whapi threads: guest_channel_claims — NEVER overwrite from guests.claimed_by
 *   (that would leak a Dream Bot mute onto מכשיר הסוויטות, or wipe a real Whapi
 *   claim). Prefer whapiClaimsMap[guestId]; else keep contact stamp from setClaim.
 * - Unified threads (Meta+Whapi merged): expose metaClaimedBy + whapiClaimedBy
 *   separately; claimedBy = either (for roster «בטיפול» filter).
 */
function lookupWhapiClaimFromMap(whapiClaimsMap, guestId) {
  if (whapiClaimsMap == null) return undefined;
  if (whapiClaimsMap.has(guestId)) return whapiClaimsMap.get(guestId);
  const asNum = Number(guestId);
  if (!Number.isNaN(asNum) && whapiClaimsMap.has(asNum)) return whapiClaimsMap.get(asNum);
  return undefined;
}

const STRIPPED_GUEST_PROFILE = {
  guestId: null,
  guestName: null,
  spaTime: null,
  spaDate: null,
  room: null,
  roomType: null,
  status: null,
  departureDate: null,
  arrivalDate: null,
  portalToken: null,
  mealTime: null,
  mealLocation: null,
  claimedBy: null,
  claimedAt: null,
  metaClaimedBy: null,
  metaClaimedAt: null,
  whapiClaimedBy: null,
  whapiClaimedAt: null,
};

function guestProfileFromEntry(guestEntry) {
  return {
    guestId: guestEntry.id,
    guestName: guestEntry.name ?? null,
    status: guestEntry.status ?? null,
    arrivalDate: guestEntry.arrival_date ?? null,
    departureDate: guestEntry.departure_date ?? null,
    room: guestEntry.room ?? null,
    roomType: guestEntry.room_type ?? null,
    spaTime: guestEntry.spa_time ?? null,
    spaDate: guestEntry.spa_date ?? null,
    portalToken: guestEntry.portal_token ?? null,
    mealTime: guestEntry.meal_time ?? null,
    mealLocation: guestEntry.meal_location ?? null,
  };
}

export function syncInboxContactWithGuestMap(contact, guestEntry, whapiClaimsMap = null) {
  if (!contact) return contact;
  const isUnified = contact.inbox_channel === "unified";
  const isWhapi = !isUnified && (contact.inbox_channel ?? "meta") === "whapi";

  if (!guestEntry?.id) {
    return { ...contact, ...STRIPPED_GUEST_PROFILE };
  }

  const profile = guestProfileFromEntry(guestEntry);

  if (isUnified) {
    const metaClaimedBy = guestEntry.claimed_by ?? null;
    const metaClaimedAt = guestEntry.claimed_at ?? null;
    let whapiClaimedBy = null;
    let whapiClaimedAt = null;
    if (whapiClaimsMap == null) {
      whapiClaimedBy = contact.whapiClaimedBy ?? null;
      whapiClaimedAt = contact.whapiClaimedAt ?? null;
    } else {
      const whapiClaim = lookupWhapiClaimFromMap(whapiClaimsMap, guestEntry.id);
      whapiClaimedBy = whapiClaim !== undefined ? (whapiClaim?.claimed_by ?? null) : null;
      whapiClaimedAt = whapiClaim !== undefined ? (whapiClaim?.claimed_at ?? null) : null;
    }
    return {
      ...contact,
      ...profile,
      metaClaimedBy,
      metaClaimedAt,
      whapiClaimedBy,
      whapiClaimedAt,
      claimedBy: metaClaimedBy || whapiClaimedBy || null,
      claimedAt: metaClaimedBy ? metaClaimedAt : whapiClaimedAt,
    };
  }

  let claimedBy;
  let claimedAt;
  if (isWhapi) {
    if (whapiClaimsMap == null) {
      claimedBy = contact.claimedBy ?? null;
      claimedAt = contact.claimedAt ?? null;
    } else {
      const whapiClaim = lookupWhapiClaimFromMap(whapiClaimsMap, guestEntry.id);
      claimedBy = whapiClaim !== undefined ? (whapiClaim?.claimed_by ?? null) : null;
      claimedAt = whapiClaim !== undefined ? (whapiClaim?.claimed_at ?? null) : null;
    }
  } else {
    claimedBy = guestEntry.claimed_by ?? null;
    claimedAt = guestEntry.claimed_at ?? null;
  }
  return {
    ...contact,
    ...profile,
    claimedBy,
    claimedAt,
  };
}

// Frontend-only — Deno Edge Functions can't import across the function
// boundary in this repo (CLAUDE.md convention), so guest-portal-ops-request/
// sla-escalation-cron duplicate the same future-arrival check locally rather
// than importing this file.
