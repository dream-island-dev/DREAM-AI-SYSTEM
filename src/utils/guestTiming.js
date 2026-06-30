// src/utils/guestTiming.js
// Shared "is this guest here yet?" badge for boards that surface a request/task
// tied to a guest_id (OperationsBoard.js, RequestsBoard.js) — computed LIVE from
// the joined guests row (arrival_date/departure_date/status) rather than a
// snapshot frozen at request-creation time, per CLAUDE.md §0.5 Single Source of
// Truth: guests.status/arrival_date is the golden profile, so a request that sits
// open for a day shows the guest's CURRENT state, not a stale one.

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Calendar today in Israel (YYYY-MM-DD) — matches DATE columns as hotel-local days. */
export function israelTodayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
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
