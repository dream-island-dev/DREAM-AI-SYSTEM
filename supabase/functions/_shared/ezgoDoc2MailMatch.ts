// Guest matching for EZGO Doc2 mail import lines.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Doc2Record } from "./ezgoDoc2Parser.ts";
import {
  classifyDoc2MailWorkflow,
  type Doc2GuestRow,
} from "./ezgoDoc2MailLineWorkflow.ts";
import { reportDateWithinGuestStay } from "./ezgoDoc1Parser.ts";

export type Doc2MatchResult = {
  guest: Doc2GuestRow | null;
  method: "order" | "phone" | "fuzzy" | "none";
  confidence: number;
  label: string;
  action: "enrich" | "create" | "no_match" | "conflict";
  patch: Record<string, unknown>;
};

const GUEST_SELECT =
  "id, name, phone, order_number, arrival_date, departure_date, room, room_type, meal_location";

function normalizeGuestName(name: string | null | undefined): string {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function pickFromOverlap(
  rows: Doc2GuestRow[],
  reportDate: string | null,
  phone: string | null,
): Doc2GuestRow | null {
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

export function findGuestForDoc2Record(
  existingRows: Doc2GuestRow[],
  rec: Doc2Record,
): Doc2GuestRow | null {
  if (!existingRows?.length || !rec) return null;
  const reportDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  const phone = rec.phone || null;
  const order = rec.order_number || null;

  if (order) {
    const byOrder = existingRows.filter((g) => g.order_number === order);
    if (byOrder.length === 1) {
      const only = byOrder[0];
      if (!reportDate || reportDateWithinGuestStay(only, reportDate)) return only;
      if (String(only.arrival_date).slice(0, 10) === reportDate) return only;
    }
    const hit = pickFromOverlap(byOrder, reportDate, phone);
    if (hit) return hit;
  }

  if (phone) {
    const byPhone = existingRows.filter((g) => g.phone === phone);
    const hit = pickFromOverlap(byPhone, reportDate, phone);
    if (hit) return hit;
  }

  if (rec.guest_name && reportDate) {
    const target = normalizeGuestName(rec.guest_name);
    const hits = existingRows.filter((g) =>
      normalizeGuestName(g.name) === target
      && String(g.arrival_date).slice(0, 10) === reportDate
    );
    if (hits.length === 1) return hits[0];
  }

  return null;
}

export async function matchDoc2Record(
  supabase: SupabaseClient,
  rec: Doc2Record,
  guestCache: Doc2GuestRow[],
  reportDateYmd: string | null,
): Promise<Doc2MatchResult> {
  const reportDate = rec.arrival_date
    ? String(rec.arrival_date).slice(0, 10)
    : reportDateYmd?.slice(0, 10) ?? null;

  let guest: Doc2GuestRow | null = findGuestForDoc2Record(guestCache, rec);
  let method: Doc2MatchResult["method"] = "none";
  let confidence = 0;

  if (guest) {
    method = rec.order_number && guest.order_number === rec.order_number
      ? "order"
      : (rec.phone && guest.phone === rec.phone ? "phone" : "fuzzy");
    confidence = method === "order" ? 0.95 : (method === "phone" ? 0.85 : 0.78);
  }

  if (!guest && rec.order_number && reportDate) {
    const { data: byOrder } = await supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("order_number", rec.order_number)
      .neq("status", "cancelled")
      .limit(5);
    if (byOrder?.length === 1) {
      guest = byOrder[0] as Doc2GuestRow;
      method = "order";
      confidence = 0.92;
    } else if (byOrder && byOrder.length > 1) {
      const hit = pickFromOverlap(byOrder as Doc2GuestRow[], reportDate, rec.phone);
      if (hit) {
        guest = hit;
        method = "order";
        confidence = 0.9;
      }
    }
  }

  if (!guest && rec.phone && reportDate) {
    const { data: byPhone } = await supabase
      .from("guests")
      .select(GUEST_SELECT)
      .eq("phone", rec.phone)
      .eq("arrival_date", reportDate)
      .neq("status", "cancelled")
      .limit(3);
    if (byPhone?.length === 1) {
      guest = byPhone[0] as Doc2GuestRow;
      method = "phone";
      confidence = 0.85;
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
      guest = byName[0] as Doc2GuestRow;
      method = "fuzzy";
      confidence = 0.78;
    }
  }

  const classified = classifyDoc2MailWorkflow(rec, guest);

  return {
    guest,
    method: guest ? method : "none",
    confidence: guest ? confidence : 0,
    label: classified.label,
    action: classified.action,
    patch: classified.patch,
  };
}
