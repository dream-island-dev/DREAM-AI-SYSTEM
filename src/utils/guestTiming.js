// src/utils/guestTiming.js
// Shared "is this guest here yet?" badge for boards that surface a request/task
// tied to a guest_id (OperationsBoard.js, RequestsBoard.js) — computed LIVE from
// the joined guests row (arrival_date/departure_date/status) rather than a
// snapshot frozen at request-creation time, per CLAUDE.md §0.5 Single Source of
// Truth: guests.status/arrival_date is the golden profile, so a request that sits
// open for a day shows the guest's CURRENT state, not a stale one.

import { SUITE_REGISTRY } from "../data/suiteRegistry";

const todayStr = () => new Date().toISOString().slice(0, 10);

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

/** True when the guest's stay window includes today (in-resort), per golden profile dates+status. */
export function isGuestInResortToday(guest) {
  if (!guest?.arrival_date) return false;
  if (guest.status === "cancelled") return false;
  const today = todayStr();
  if (guest.status === "checked_in") return true;
  if (guest.arrival_date > today) return false;
  if (!guest.departure_date || guest.departure_date >= today) return true;
  return false;
}

/** Suite profile: explicit room_type or assigned room from SUITE_REGISTRY. */
export function isSuiteGuestProfile({ room_type, room } = {}) {
  if (room_type === "suite") return true;
  if (room && SUITE_REGISTRY.includes(room)) return true;
  return false;
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

  const inStay =
    status === "checked_in" ||
    (arrival <= today && (!departure || departure >= today));

  if (inStay && arrival <= today) {
    return {
      label: en ? "🟢 In resort" : "🟢 בריזורט",
      bg: "#F0FDF4",
      fg: "#15803D",
    };
  }

  if (departure && departure < today) {
    return {
      label: en ? "⚪ After stay" : "⚪ אחרי עזיבה",
      bg: "var(--ivory)",
      fg: "var(--text-muted)",
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
  const today = todayStr();

  if (guest.status === "checked_in") {
    return { label: "🟢 אורח בריזורט", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" };
  }
  if (guest.arrival_date > today) {
    return {
      label: `🟡 הגעה עתידית: ${fmtDate(guest.arrival_date)}`,
      bg: "#FFFBEB", color: "#B45309", border: "#FDE68A",
    };
  }
  // Dates say "currently staying" even if status hasn't been flipped to
  // checked_in yet (e.g. still 'room_ready'/'expected' on arrival day).
  if (!guest.departure_date || guest.departure_date >= today) {
    return { label: "🟢 אורח בריזורט", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" };
  }
  // Departed — not one of the two states asked for, but staying silent here
  // would let a stale post-checkout request look like a live one (Fail Visible).
  return { label: "⚪ אורח לאחר עזיבה", bg: "var(--ivory)", color: "var(--text-muted)", border: "var(--border)" };
}

// Frontend-only — Deno Edge Functions can't import across the function
// boundary in this repo (CLAUDE.md convention), so guest-portal-ops-request/
// sla-escalation-cron duplicate the same future-arrival check locally rather
// than importing this file.
