// Pick the best guests row when one phone has multiple stays (returning guests).

export type GuestPickRow = {
  id?: number;
  status?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  phone?: string | null;
};

export function sliceGuestYmd(d: string | null | undefined): string | null {
  if (!d) return null;
  return String(d).slice(0, 10);
}

/** Past stay — checked_out/cancelled or departure before today. */
export function isGuestStayEnded(guest: GuestPickRow | null | undefined, today: string): boolean {
  if (!guest) return true;
  if (guest.status === "checked_out" || guest.status === "cancelled") return true;
  const dep = sliceGuestYmd(guest.departure_date);
  if (dep && dep < today) return true;
  return false;
}

/** Import row is for a new booking, not the matched archived profile. */
export function recordSignalsNewStay(
  rec: { arrival_date?: string | null },
  guest: GuestPickRow,
  reportDate: string | null,
  today: string,
): boolean {
  const recArrival = sliceGuestYmd(rec.arrival_date) ?? reportDate;
  const guestArrival = sliceGuestYmd(guest.arrival_date);
  if (!recArrival) return false;
  if (guestArrival && recArrival === guestArrival) return false;
  if (recArrival >= today) return true;
  const guestDep = sliceGuestYmd(guest.departure_date);
  if (guestDep && recArrival > guestDep) return true;
  return false;
}

export function shouldTreatAsReturningGuestCreate(
  guest: GuestPickRow | null | undefined,
  rec: { arrival_date?: string | null },
  reportDate: string | null,
  today: string,
): boolean {
  if (!guest?.id) return false;
  if (!isGuestStayEnded(guest, today)) return false;
  return recordSignalsNewStay(rec, guest, reportDate, today);
}

function guestPickScore(guest: GuestPickRow, today: string): number {
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

/** Best profile for a phone — in-house > arriving today > future > archived. */
export function pickGuestProfileByPhone<T extends GuestPickRow>(
  rows: T[],
  today: string,
): T | null {
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
