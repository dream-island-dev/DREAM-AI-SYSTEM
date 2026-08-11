// Paginated guests fetch for OperationalDashboard + ResortPulseBar.
// PostgREST caps unranged selects at 1000 — live 45d windows exceed that
// (same trap fixed 2026-08-10 in whatsapp-cron / automation-queue).

import { israelDateOffsetStr } from "./guestTiming";

export const RESORT_PULSE_GUEST_LOOKBACK_DAYS = 45;
export const RESORT_PULSE_GUEST_PAGE_SIZE = 1000;

export const RESORT_PULSE_GUEST_SELECT =
  "phone, status, arrival_date, departure_date, room, room_type, arrival_time, name";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ select?: string, lookbackDays?: number, pageSize?: number }} [opts]
 * @returns {Promise<{ guests: object[], truncated: boolean, pageCount: number }>}
 */
export async function fetchGuestsForResortPulse(supabase, opts = {}) {
  const select = opts.select ?? RESORT_PULSE_GUEST_SELECT;
  const lookbackDays = opts.lookbackDays ?? RESORT_PULSE_GUEST_LOOKBACK_DAYS;
  const pageSize = opts.pageSize ?? RESORT_PULSE_GUEST_PAGE_SIZE;
  const cutoff = israelDateOffsetStr(-lookbackDays);

  const all = [];
  let pageCount = 0;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("guests")
      .select(select)
      .gte("arrival_date", cutoff)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    pageCount += 1;
    all.push(...batch);
    if (batch.length < pageSize) {
      return { guests: all, truncated: false, pageCount };
    }
  }
}
