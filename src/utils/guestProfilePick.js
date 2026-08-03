// Mirror of supabase/functions/_shared/guestProfilePick.ts (frontend).

import { israelTodayStr } from "./guestTiming";

export function sliceGuestYmd(d) {
  if (!d) return null;
  return String(d).slice(0, 10);
}

export function isGuestStayEnded(guest, today = israelTodayStr()) {
  if (!guest) return true;
  if (guest.status === "checked_out" || guest.status === "cancelled") return true;
  const dep = sliceGuestYmd(guest.departure_date);
  if (dep && dep < today) return true;
  return false;
}

export function recordSignalsNewStay(rec, guest, reportDate, today = israelTodayStr()) {
  const recArrival = sliceGuestYmd(rec?.arrival_date) ?? reportDate;
  const guestArrival = sliceGuestYmd(guest?.arrival_date);
  if (!recArrival) return false;
  if (guestArrival && recArrival === guestArrival) return false;
  if (recArrival >= today) return true;
  const guestDep = sliceGuestYmd(guest?.departure_date);
  if (guestDep && recArrival > guestDep) return true;
  return false;
}

export function shouldTreatAsReturningGuestCreate(guest, rec, reportDate, today = israelTodayStr()) {
  if (!guest?.id) return false;
  if (!isGuestStayEnded(guest, today)) return false;
  return recordSignalsNewStay(rec, guest, reportDate, today);
}

function guestPickScore(guest, today) {
  const arr = sliceGuestYmd(guest.arrival_date);
  if (guest.status === "checked_in" && !isGuestStayEnded(guest, today)) return 0;
  if (guest.status === "room_ready" && arr === today) return 1;
  if (["expected", "pending"].includes(guest.status ?? "") && arr === today) return 2;
  if (arr && arr >= today && guest.status !== "checked_out" && guest.status !== "cancelled") {
    return arr === today ? 3 : 4;
  }
  if (!isGuestStayEnded(guest, today)) return 10;
  return 100;
}

export function pickGuestProfileByPhone(rows, today = israelTodayStr()) {
  if (!rows?.length) return null;
  const active = rows.filter((g) => g.status !== "cancelled");
  const pool = active.length ? active : rows;
  if (pool.length === 1) return pool[0];

  const sorted = [...pool].sort((a, b) => {
    const sa = guestPickScore(a, today);
    const sb = guestPickScore(b, today);
    if (sa !== sb) return sa - sb;
    return (sliceGuestYmd(b.arrival_date) || "").localeCompare(sliceGuestYmd(a.arrival_date) || "");
  });
  return sorted[0] ?? null;
}
