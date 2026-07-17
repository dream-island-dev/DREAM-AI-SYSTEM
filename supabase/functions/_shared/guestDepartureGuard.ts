// Suite departure_date guard — alerts + nights→departure helper (Edge Functions).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function addDepartureFromNights(
  arrivalDate: string | null | undefined,
  nights: number | string | null | undefined,
  opts: { isDayGuest?: boolean } = {},
): string | null {
  const arrival = String(arrivalDate ?? "").trim();
  if (!arrival) return null;
  if (opts.isDayGuest) return arrival;
  const n = typeof nights === "number" ? nights : parseInt(String(nights ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(`${arrival}T12:00:00`);
  d.setDate(d.getDate() + n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function isSuiteStayGuest(guest: {
  room_type?: string | null;
  room?: string | null;
  isDayGuest?: boolean;
} | null | undefined): boolean {
  if (!guest) return false;
  const rt = guest.room_type;
  if (rt === "day_guest" || rt === "premium_day_guest") return false;
  if (rt === "suite") return true;
  const room = String(guest.room ?? "");
  if (/premium\s*day|בילוי.*יומי/i.test(room)) return false;
  if (guest.isDayGuest) return false;
  return true;
}

export function isMissingSuiteDepartureDate(guest: {
  arrival_date?: string | null;
  departure_date?: string | null;
  room_type?: string | null;
  room?: string | null;
} | null | undefined): boolean {
  if (!guest?.arrival_date) return false;
  if (!isSuiteStayGuest(guest)) return false;
  return !guest.departure_date;
}

function missingDepartureMessage(guestName?: string | null): string {
  const name = String(guestName ?? "").trim() || "אורח";
  return `⚠️ חסר תאריך עזיבה ל${name} — יש להשלים בדחיפות (משפיע על אוטומציות ו-checkout)`;
}

/** Idempotent guest_alerts row for active suite guests missing departure_date. */
export async function ensureMissingDepartureAlert(
  supabase: SupabaseClient,
  guest: { id: number; phone: string; name?: string | null; arrival_date?: string | null; departure_date?: string | null; room_type?: string | null; room?: string | null },
): Promise<void> {
  if (!isMissingSuiteDepartureDate(guest)) return;
  const { data: existing } = await supabase
    .from("guest_alerts")
    .select("id")
    .eq("guest_id", guest.id)
    .eq("alert_type", "missing_departure_date")
    .eq("resolved", false)
    .maybeSingle();
  if (existing?.id) return;
  const { error } = await supabase.from("guest_alerts").insert({
    guest_id: guest.id,
    phone: guest.phone,
    alert_type: "missing_departure_date",
    message: missingDepartureMessage(guest.name),
    resolved: false,
  });
  if (error) {
    console.warn("[guestDepartureGuard] guest_alerts insert failed:", error.message);
  }
}
