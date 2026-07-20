// Guest matching for EZGO mail import lines — mirrors guestImportIntelligence Doc1 path.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDoc1EnrichmentPatch,
  type Doc1Record,
  reportDateWithinGuestStay,
} from "./ezgoDoc1Parser.ts";

export type GuestRow = {
  id: number;
  name: string | null;
  phone: string | null;
  order_number: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  room: string | null;
  spa_time: string | null;
  meal_location: string | null;
  meal_time: string | null;
  treatment_count: number | null;
};

export type MatchResult = {
  guest: GuestRow | null;
  method: "order" | "phone" | "fuzzy" | "none";
  confidence: number;
  label: string;
  action: "enrich" | "no_match" | "conflict";
  patch: Record<string, unknown>;
};

function pickFromOverlap(
  rows: GuestRow[],
  reportDate: string | null,
  phone: string | null,
): GuestRow | null {
  if (!rows.length) return null;
  if (!reportDate) return rows.length === 1 ? rows[0] : null;
  const inStay = rows.filter((g) => reportDateWithinGuestStay(g, reportDate));
  if (inStay.length === 1) return inStay[0];
  if (inStay.length > 1 && phone) {
    const hit = inStay.find((g) => g.phone === phone);
    if (hit) return hit;
  }
  const sameDay = rows.filter(
    (g) => String(g.arrival_date).slice(0, 10) === reportDate,
  );
  if (sameDay.length === 1) return sameDay[0];
  return null;
}

export function findGuestForDoc1Enrichment(
  existingRows: GuestRow[],
  rec: Doc1Record,
): GuestRow | null {
  if (!rec || !existingRows?.length) return null;
  const reportDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  const phone = rec.phone || null;
  const order = rec.order_number || null;

  if (order) {
    const byOrder = existingRows.filter((g) => g.order_number === order);
    if (byOrder.length === 1) {
      const only = byOrder[0];
      if (!reportDate || reportDateWithinGuestStay(only, reportDate)) return only;
      if (String(only.arrival_date).slice(0, 10) === reportDate) return only;
      return null;
    }
    const hit = pickFromOverlap(byOrder, reportDate, phone);
    if (hit) return hit;
  }

  if (phone) {
    const byPhone = existingRows.filter((g) => g.phone === phone);
    const hit = pickFromOverlap(byPhone, reportDate, phone);
    if (hit) return hit;
  }

  return null;
}

function patchHasChanges(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length > 0;
}

function nameConflict(rec: Doc1Record, guest: GuestRow): boolean {
  if (!rec.guest_name || !guest.name) return false;
  return rec.guest_name.trim() !== String(guest.name).trim();
}

export async function matchDoc1Record(
  supabase: SupabaseClient,
  rec: Doc1Record,
  guestCache: GuestRow[],
): Promise<MatchResult> {
  const reportDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  let guest = findGuestForDoc1Enrichment(guestCache, rec);
  let method: MatchResult["method"] = guest ? "order" : "none";
  let confidence = guest ? 0.95 : 0;
  let label = guest
    ? `מס׳ הזמנה ${rec.order_number}${guest.name ? ` → ${guest.name}` : ""}`
    : "לא נמצא פרופיל";

  if (!guest && rec.phone && reportDate) {
    const { data: byPhone } = await supabase
      .from("guests")
      .select("id, name, phone, order_number, arrival_date, departure_date, room, spa_time, meal_location, meal_time, treatment_count")
      .eq("phone", rec.phone)
      .gte("arrival_date", reportDate)
      .lte("arrival_date", reportDate)
      .limit(3);
    if (byPhone?.length === 1) {
      guest = byPhone[0] as GuestRow;
      method = "phone";
      confidence = 0.85;
      label = `טלפון ${rec.phone} → ${guest.name}`;
    }
  }

  // Fuzzy name match runs client-side (match_guest_fuzzy requires auth.uid).

  if (!guest) {
    return {
      guest: null,
      method: "none",
      confidence: 0,
      label: "אין פרופיל מתאים — צור ידנית או ייבא Doc2",
      action: "no_match",
      patch: {},
    };
  }

  const patch = buildDoc1EnrichmentPatch(rec, guest);
  const conflict = nameConflict(rec, guest);
  const action = conflict ? "conflict" : (patchHasChanges(patch) ? "enrich" : "enrich");

  if (!patchHasChanges(patch) && !conflict) {
    label = `${label} · אין שדות חדשים`;
  }

  return {
    guest,
    method,
    confidence,
    label,
    action: conflict ? "conflict" : action,
    patch,
  };
}

export async function loadGuestCacheForReport(
  supabase: SupabaseClient,
  reportDateYmd: string | null,
): Promise<GuestRow[]> {
  if (!reportDateYmd) {
    const { data } = await supabase
      .from("guests")
      .select("id, name, phone, order_number, arrival_date, departure_date, room, spa_time, meal_location, meal_time, treatment_count")
      .neq("status", "cancelled")
      .order("arrival_date", { ascending: false })
      .limit(800);
    return (data ?? []) as GuestRow[];
  }

  const day = reportDateYmd.slice(0, 10);
  const { data: arriving } = await supabase
    .from("guests")
    .select("id, name, phone, order_number, arrival_date, departure_date, room, spa_time, meal_location, meal_time, treatment_count")
    .neq("status", "cancelled")
    .eq("arrival_date", day)
    .limit(400);

  const { data: inStay } = await supabase
    .from("guests")
    .select("id, name, phone, order_number, arrival_date, departure_date, room, spa_time, meal_location, meal_time, treatment_count")
    .neq("status", "cancelled")
    .lt("arrival_date", day)
    .gte("departure_date", day)
    .limit(400);

  const byId = new Map<number, GuestRow>();
  for (const g of [...(arriving ?? []), ...(inStay ?? [])] as GuestRow[]) {
    byId.set(g.id, g);
  }
  return [...byId.values()];
}
