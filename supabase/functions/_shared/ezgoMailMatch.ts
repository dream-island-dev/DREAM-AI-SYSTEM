// Guest matching for EZGO mail import lines — mirrors guestImportIntelligence Doc1 path.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildDoc1EnrichmentPatch,
  type Doc1Record,
  reportDateWithinGuestStay,
} from "./ezgoDoc1Parser.ts";
import {
  classifyEzgoMailWorkflow,
  type GuestWorkflowRow,
} from "./ezgoMailLineWorkflow.ts";

export type GuestRow = GuestWorkflowRow;

export type MatchResult = {
  guest: GuestRow | null;
  method: "order" | "phone" | "fuzzy" | "none";
  confidence: number;
  label: string;
  action: "enrich" | "create" | "no_match" | "conflict";
  patch: Record<string, unknown>;
};

const GUEST_SELECT =
  "id, name, phone, order_number, arrival_date, departure_date, room, room_type, spa_time, spa_date, meal_location, meal_time, treatment_count, msg_spa_upsell_sent";

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
  if (sameDay.length > 1 && phone) {
    const hit = sameDay.find((g) => g.phone === phone);
    if (hit) return hit;
  }
  return null;
}

function normalizeGuestName(name: string | null | undefined): string {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function findGuestByExactNameOnDate(
  rows: GuestRow[],
  guestName: string | null,
  reportDate: string | null,
): GuestRow | null {
  const target = normalizeGuestName(guestName);
  if (!target || !reportDate) return null;
  const hits = rows.filter((g) =>
    normalizeGuestName(g.name) === target
    && String(g.arrival_date).slice(0, 10) === reportDate
  );
  return hits.length === 1 ? hits[0] : null;
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

export async function enrichRecordsPhoneFromDb(
  supabase: SupabaseClient,
  records: Doc1Record[],
): Promise<Doc1Record[]> {
  const orderNums = [
    ...new Set(
      records
        .filter((r) => !r.phone && r.order_number)
        .map((r) => r.order_number as string),
    ),
  ];
  if (!orderNums.length) return records;

  const { data: guests } = await supabase
    .from("guests")
    .select("order_number, phone")
    .in("order_number", orderNums)
    .not("phone", "is", null)
    .neq("status", "cancelled");

  const phoneByOrder = new Map<string, string>();
  for (const row of guests ?? []) {
    const order = row.order_number ? String(row.order_number) : "";
    const phone = row.phone ? String(row.phone) : "";
    if (order && phone && !phoneByOrder.has(order)) {
      phoneByOrder.set(order, phone);
    }
  }

  if (!phoneByOrder.size) return records;

  return records.map((rec) => {
    if (rec.phone || !rec.order_number) return rec;
    const phone = phoneByOrder.get(rec.order_number);
    return phone ? { ...rec, phone } : rec;
  });
}

export async function matchDoc1Record(
  supabase: SupabaseClient,
  rec: Doc1Record,
  guestCache: GuestRow[],
  reportDateYmd: string | null = null,
): Promise<MatchResult> {
  const reportDate = rec.arrival_date
    ? String(rec.arrival_date).slice(0, 10)
    : reportDateYmd?.slice(0, 10) ?? null;

  let guest = findGuestForDoc1Enrichment(guestCache, rec);
  let method: MatchResult["method"] = guest ? "order" : "none";
  let confidence = guest ? 0.95 : 0;

  if (!guest && rec.order_number && reportDate) {
    const { data: byOrder } = await supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("order_number", rec.order_number)
      .neq("status", "cancelled")
      .limit(8);
    const hit = pickFromOverlap((byOrder ?? []) as GuestRow[], reportDate, rec.phone);
    if (hit) {
      guest = hit;
      method = "order";
      confidence = 0.92;
    }
  }

  if (!guest && rec.phone && reportDate) {
    const { data: byPhone } = await supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("phone", rec.phone)
      .gte("arrival_date", reportDate)
      .lte("arrival_date", reportDate)
      .limit(3);
    if (byPhone?.length === 1) {
      guest = byPhone[0] as GuestRow;
      method = "phone";
      confidence = 0.85;
    }
  }

  if (!guest) {
    const cacheHit = findGuestByExactNameOnDate(guestCache, rec.guest_name, reportDate);
    if (cacheHit) {
      guest = cacheHit;
      method = "fuzzy";
      confidence = 0.8;
    }
  }

  if (!guest && rec.guest_name && reportDate) {
    const { data: byName } = await supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("arrival_date", reportDate)
      .eq("name", normalizeGuestName(rec.guest_name))
      .neq("status", "cancelled")
      .limit(2);
    if (byName?.length === 1) {
      guest = byName[0] as GuestRow;
      method = "fuzzy";
      confidence = 0.78;
    }
  }

  const classified = classifyEzgoMailWorkflow(rec, guest, reportDateYmd);

  if (!guest && method === "none") {
    return {
      guest: null,
      method: "none",
      confidence: 0,
      label: classified.label,
      action: classified.action,
      patch: classified.patch,
    };
  }

  if (guest && method === "order" && classified.label.includes("מס׳")) {
    // keep workflow label from classifier
  }

  return {
    guest,
    method: guest ? method : "none",
    confidence: guest ? confidence : 0,
    label: classified.label,
    action: classified.action,
    patch: classified.patch,
  };
}

export async function loadGuestCacheForReport(
  supabase: SupabaseClient,
  reportDateYmd: string | null,
): Promise<GuestRow[]> {
  if (!reportDateYmd) {
    const { data } = await supabase
      .from("guests")
      .select(GUEST_SELECT)
      .neq("status", "cancelled")
      .order("arrival_date", { ascending: false })
      .limit(800);
    return (data ?? []) as GuestRow[];
  }

  const day = reportDateYmd.slice(0, 10);
  const { data: arriving } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
    .neq("status", "cancelled")
    .eq("arrival_date", day)
    .limit(400);

  const { data: inStay } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
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

// Re-export for tests
export { buildDoc1EnrichmentPatch };
