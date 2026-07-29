// Shared day-pass profile creation — mail / import / spa hub paste use the same path.
import { createDaypassGuestFromRec } from "./ezgoMailLineWorkflow";

/**
 * Normalize a row from paste, import, or EZGO mail into createDaypassGuestFromRec shape.
 * @param {Record<string, unknown>} row
 */
export function buildDaypassGuestRec(row) {
  const arrival = row.arrivalDate || row.arrival_date || null;
  return {
    phone: row.phone,
    guest_name: row.name || row.guest_name || null,
    arrival_date: arrival,
    spa_time: row.spaTime || row.spa_time || null,
    order_number: row.orderNumber || row.order_number || null,
    treatment_count: row.treatment_count ?? 0,
    meal_time: row.meal_time || null,
    meal_location: row.meal_location || null,
    spa_slots: row.spa_slots || null,
  };
}

/**
 * Create one day-pass guest profile (בילוי יומי + day_guest + bookings row).
 * @returns {Promise<{ id: number, name: string | null, phone: string } | null>}
 */
export async function createDaypassGuestProfile(supabase, row, fallbackArrivalDate) {
  if (!supabase || !row?.phone) {
    throw new Error("חסר טלפון ליצירת פרופיל");
  }
  const rec = buildDaypassGuestRec(row);
  const arrivalDate = rec.arrival_date || fallbackArrivalDate;
  if (!arrivalDate) {
    throw new Error("חסר תאריך הגעה");
  }
  return createDaypassGuestFromRec(supabase, rec, arrivalDate);
}

/**
 * Batch-create profiles from rows without an existing guest profile.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Array<{ phone: string, name?: string }>} rows
 * @param {string} arrivalDate YYYY-MM-DD
 */
export async function createDaypassGuestsBatch(supabase, rows, arrivalDate) {
  const created = [];
  const errors = [];
  for (const row of rows) {
    try {
      const inserted = await createDaypassGuestProfile(
        supabase,
        { phone: row.phone, name: row.name, arrivalDate },
        arrivalDate,
      );
      if (inserted) created.push(inserted);
    } catch (e) {
      errors.push({ phone: row.phone, name: row.name, error: e?.message ?? String(e) });
    }
  }
  return { created, errors };
}
