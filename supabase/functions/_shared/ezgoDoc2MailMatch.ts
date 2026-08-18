// Guest matching for EZGO Doc2 mail import lines.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Doc2Record } from "./ezgoDoc2Parser.ts";
import {
  buildDoc2EnrichmentPatch,
  classifyDoc2MailWorkflow,
  type Doc2GuestRow,
} from "./ezgoDoc2MailLineWorkflow.ts";
import {
  applyDoc2SuiteRoomAdd,
  createDoc2SuiteArrival,
} from "./ezgoDoc2SuiteRoomSync.ts";
import { resolveMissingDepartureAlert } from "./guestDepartureGuard.ts";
import { isCanonicalSuiteRoom } from "./suiteNames.ts";
import { reportDateWithinGuestStay } from "./ezgoDoc1Parser.ts";
import { doc2RecordMatchesGuest } from "./ezgoDoc2RecordMatch.ts";
import { israelYmd } from "./automationSchedule.ts";
import { shouldTreatAsReturningGuestCreate } from "./guestProfilePick.ts";

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

function acceptDoc2GuestMatch(
  guest: Doc2GuestRow | null,
  rec: Doc2Record,
  reportDate: string | null,
  today: string,
): Doc2GuestRow | null {
  if (!guest) return null;
  if (shouldTreatAsReturningGuestCreate(guest, rec, reportDate, today)) return null;
  return guest;
}

/** Order-based match is allowed only when phones agree (group bookings share order_number). */
export { doc2RecordMatchesGuest } from "./ezgoDoc2RecordMatch.ts";

function pickFromOverlap(
  rows: Doc2GuestRow[],
  reportDate: string | null,
  phone: string | null,
  rec: Doc2Record | null = null,
): Doc2GuestRow | null {
  if (!rows.length) return null;
  if (!reportDate) {
    if (rows.length === 1) {
      const only = rows[0];
      return rec && !doc2RecordMatchesGuest(rec, only) ? null : only;
    }
    return null;
  }
  const inStay = rows.filter((g) => reportDateWithinGuestStay(g, reportDate));
  if (inStay.length === 1) {
    const only = inStay[0];
    return rec && !doc2RecordMatchesGuest(rec, only) ? null : only;
  }
  if (inStay.length > 1 && phone) {
    const hit = inStay.find((g) => g.phone === phone);
    if (hit) return hit;
  }
  const sameDay = rows.filter(
    (g) => String(g.arrival_date).slice(0, 10) === reportDate,
  );
  if (sameDay.length === 1) {
    const only = sameDay[0];
    return rec && !doc2RecordMatchesGuest(rec, only) ? null : only;
  }
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
  const today = israelYmd();
  const reportDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
  const phone = rec.phone || null;
  const order = rec.order_number || null;

  if (order) {
    const byOrder = existingRows.filter((g) => g.order_number === order);
    if (byOrder.length === 1) {
      const only = byOrder[0];
      if (doc2RecordMatchesGuest(rec, only)) {
        if (reportDate && reportDateWithinGuestStay(only, reportDate)) {
          return acceptDoc2GuestMatch(only, rec, reportDate, today);
        }
        if (reportDate && String(only.arrival_date).slice(0, 10) === reportDate) {
          return acceptDoc2GuestMatch(only, rec, reportDate, today);
        }
      }
    }
    const hit = pickFromOverlap(byOrder, reportDate, phone, rec);
    if (hit) return acceptDoc2GuestMatch(hit, rec, reportDate, today);
  }

  if (phone) {
    const byPhone = existingRows.filter((g) => g.phone === phone);
    const hit = pickFromOverlap(byPhone, reportDate, phone, rec);
    if (hit) return acceptDoc2GuestMatch(hit, rec, reportDate, today);
  }

  if (rec.guest_name && reportDate) {
    const target = normalizeGuestName(rec.guest_name);
    const hits = existingRows.filter((g) =>
      normalizeGuestName(g.name) === target
      && String(g.arrival_date).slice(0, 10) === reportDate
    );
    if (hits.length === 1) return acceptDoc2GuestMatch(hits[0], rec, reportDate, today);
  }

  return null;
}

export async function matchDoc2Record(
  supabase: SupabaseClient,
  rec: Doc2Record,
  guestCache: Doc2GuestRow[],
  reportDateYmd: string | null,
): Promise<Doc2MatchResult> {
  const today = israelYmd();
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
      const candidate = byOrder[0] as Doc2GuestRow;
      if (doc2RecordMatchesGuest(rec, candidate)) {
        guest = candidate;
        method = "order";
        confidence = 0.92;
      }
    } else if (byOrder && byOrder.length > 1) {
      const hit = pickFromOverlap(byOrder as Doc2GuestRow[], reportDate, rec.phone, rec);
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

  guest = acceptDoc2GuestMatch(guest, rec, reportDate, today);
  if (!guest) {
    method = "none";
    confidence = 0;
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

const DOC2_SUITE_AUTO_WORKFLOWS = new Set([
  "suite_arrival_create",
  "suite_arrival_enrich",
  "suite_room_assign",
  "suite_room_add",
]);

/**
 * Deterministic gate only — no LLM, no WhatsApp. Day-pass / conflict / missing
 * nights / name-only fuzzy matches stay pending_review (same as the UI buttons).
 */
export function isCertainDoc2SuiteAutoApply(
  rec: Doc2Record,
  match: Doc2MatchResult,
): boolean {
  if (!rec || rec.section === "departure") return false;
  if (rec.departure_missing_nights) return false;
  if ((rec.is_day_guest || rec.is_premium_day) && !isCanonicalSuiteRoom(rec.room)) {
    return false;
  }
  const workflow = match.patch?._workflow;
  if (typeof workflow !== "string" || !DOC2_SUITE_AUTO_WORKFLOWS.has(workflow)) {
    return false;
  }
  if (match.action === "conflict" || match.action === "no_match") return false;

  if (workflow === "suite_arrival_create") {
    return match.action === "create" && !!rec.phone;
  }

  if (!match.guest?.id || match.action !== "enrich") return false;
  return match.method === "order" || match.method === "phone";
}

export async function applyCertainDoc2SuiteSync(
  supabase: SupabaseClient,
  rec: Doc2Record,
  match: Doc2MatchResult,
  reportDateYmd: string | null,
): Promise<{ applied: boolean; guestId: number | null }> {
  if (!isCertainDoc2SuiteAutoApply(rec, match)) {
    return { applied: false, guestId: null };
  }

  const workflow = match.patch?._workflow;
  try {
    if (workflow === "suite_arrival_create") {
      const inserted = await createDoc2SuiteArrival(supabase, rec, reportDateYmd);
      return { applied: true, guestId: inserted.id };
    }
    if (!match.guest?.id) return { applied: false, guestId: null };

    if (workflow === "suite_room_add" || workflow === "suite_room_assign") {
      await applyDoc2SuiteRoomAdd(supabase, {
        guestId: match.guest.id,
        rec,
        reportDateYmd,
      });
      return { applied: true, guestId: match.guest.id };
    }

    const { data: freshGuest, error: fetchErr } = await supabase
      .from("guests")
      .select(
        "id, name, phone, order_number, arrival_date, departure_date, room, room_type, meal_location, meal_time, automation_scope",
      )
      .eq("id", match.guest.id)
      .maybeSingle();
    if (fetchErr || !freshGuest) return { applied: false, guestId: null };

    const rawPatch = buildDoc2EnrichmentPatch(rec, freshGuest as Doc2GuestRow);
    const safePatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawPatch)) {
      if (!k.startsWith("_")) safePatch[k] = v;
    }
    if (!Object.keys(safePatch).length) return { applied: false, guestId: null };

    const { error: updateErr } = await supabase
      .from("guests")
      .update(safePatch)
      .eq("id", freshGuest.id);
    if (updateErr) return { applied: false, guestId: null };
    if (safePatch.departure_date) {
      await resolveMissingDepartureAlert(supabase, freshGuest.id as number);
    }
    return { applied: true, guestId: freshGuest.id as number };
  } catch {
    return { applied: false, guestId: null };
  }
}
