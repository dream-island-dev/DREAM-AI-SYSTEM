/** Day-pass guest with a room assignment — eligible cohort for spa upsell. */
export function isDayPassGuestForUpsell(guest) {
  return (
    (guest?.room_type === "day_guest" || guest?.room_type === "premium_day_guest")
    && !!guest?.room
  );
}

/** Guest has a spa booking on the visit date (time or spa_date match). */
export function guestHasSpaOnDate(guest, dateYmd) {
  const arrival = dateYmd || guest?.arrival_date;
  return !!guest?.spa_time || (!!guest?.spa_date && guest.spa_date === arrival);
}

/** Single guest row — matches Doc1 post-sync rules in ArrivalImportPanel. */
export function isSpaUpsellEligible(guest, dateYmd) {
  if (!guest || guest.status === "cancelled") return false;
  if (!isDayPassGuestForUpsell(guest)) return false;
  if (guest.msg_spa_upsell_sent) return false;
  if (guestHasSpaOnDate(guest, dateYmd)) return false;
  return true;
}

/**
 * Load day-pass guests arriving on `arrivalDate` who have no spa and no prior upsell.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ arrivalDate: string }} opts — YYYY-MM-DD (Israel business day)
 */
export async function fetchSpaUpsellAudience(supabase, { arrivalDate }) {
  if (!supabase || !arrivalDate) return { guests: [], error: null };

  const { data, error } = await supabase
    .from("guests")
    .select("id, phone, name, room_type, room, spa_date, spa_time, arrival_date, status, msg_spa_upsell_sent")
    .eq("arrival_date", arrivalDate)
    .eq("msg_spa_upsell_sent", false)
    .neq("status", "cancelled")
    .not("phone", "is", null)
    .order("name");

  if (error) return { guests: [], error };

  const guests = (data ?? [])
    .filter((g) => isSpaUpsellEligible(g, arrivalDate))
    .map((g) => ({ id: g.id, name: g.name, phone: g.phone, room: g.room }));

  return { guests, error: null };
}

export function israelTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}
