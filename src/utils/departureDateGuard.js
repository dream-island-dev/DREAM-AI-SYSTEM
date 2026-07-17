// Suite departure_date validation — mirrors supabase/functions/_shared/guestDepartureGuard.ts

/** arrival + nights → departure (exclusive checkout day). Day guests: same-day. */
export function addDepartureFromNights(arrivalDate, nights, { isDayGuest = false } = {}) {
  if (!arrivalDate) return null;
  if (isDayGuest) return arrivalDate;
  const n = parseInt(nights, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(`${arrivalDate}T12:00:00`);
  d.setDate(d.getDate() + n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function isSuiteStayGuest(guest) {
  if (!guest) return false;
  const rt = guest.room_type;
  if (rt === "day_guest" || rt === "premium_day_guest") return false;
  if (rt === "suite") return true;
  const room = String(guest.room ?? "");
  if (/premium\s*day|בילוי.*יומי/i.test(room)) return false;
  if (guest.isDayGuest === true || guest.is_day_guest === true) return false;
  return true;
}

export function isMissingSuiteDepartureDate(guest) {
  if (!guest?.arrival_date) return false;
  if (!isSuiteStayGuest(guest)) return false;
  return !guest.departure_date;
}

export function missingDepartureMessage(guestName) {
  const name = String(guestName ?? "").trim() || "אורח";
  return `⚠️ חסר תאריך עזיבה ל${name} — יש להשלים בדחיפות (משפיע על אוטומציות ו-checkout)`;
}

/** Block suite import when arrival exists but nights cannot produce departure. */
export function validateSuiteProfilesDeparture(profiles) {
  const blocked = [];
  for (const p of profiles ?? []) {
    if (!p?.hasSuite || p.isDayGuest) continue;
    if (!p.arrivalDate) continue;
    if (p.departureDate) continue;
    blocked.push({
      name: p.guestName || "ללא שם",
      arrivalDate: p.arrivalDate,
      nights: p.nights ?? null,
    });
  }
  return blocked;
}

export async function ensureMissingDepartureAlert(supabase, guest) {
  if (!supabase || !guest?.id || !guest.phone) return;
  if (!isMissingSuiteDepartureDate(guest)) return;
  const { data: existing } = await supabase
    .from("guest_alerts")
    .select("id")
    .eq("guest_id", guest.id)
    .eq("alert_type", "missing_departure_date")
    .eq("resolved", false)
    .maybeSingle();
  if (existing?.id) return;
  await supabase.from("guest_alerts").insert({
    guest_id: guest.id,
    phone: guest.phone,
    alert_type: "missing_departure_date",
    message: missingDepartureMessage(guest.name),
    resolved: false,
  });
}
