// Spa upsell hub — leads fetch, paste merge, staff copy, Whapi template prep.

import { parseWaiterPulsePaste } from "./waiterPulseContacts";
import {
  guestHasSpaOnDate,
  isSpaUpsellEligibleOnArrivalDate,
} from "./spaUpsellAudience";
import { normalizeGuestPhoneForLookup, phoneLookupVariants } from "./guestSegmentGuard";
import { isEffectiveSuiteGuest } from "./pipelineSegment";

const STAFF_APP_ORIGIN = "https://dream-ai-system.vercel.app";

/** Open spa coordinator leads — upsell acceptance + portal/WA spa requests. */
export const SPA_COORDINATOR_ALERT_TYPES = ["spa_upsell_accept", "spa_request"];

/** bot_scripts uses {{GUEST_NAME}}; whapi bulk queue expects {{שם}}. */
export function spaUpsellScriptToWhapiTemplate(scriptText) {
  return String(scriptText ?? "")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, "{{שם}}")
    .replace(/\{\{\s*portal_url\s*\}\}/gi, "");
}

export function buildSpaUpsellStaffCopy(leads, arrivalDate) {
  const lines = [
    "💆 ממתינים לתאום ספא — בילוי יומי",
    `תאריך הגעה: ${arrivalDate || "—"}`,
    "",
  ];
  if (!leads?.length) {
    lines.push("אין ממתינים כרגע.");
  } else {
    leads.forEach((row, idx) => {
      const name = row.guests?.name || "אורח";
      const room = row.guests?.room ? ` · ${row.guests.room}` : "";
      const phone = row.phone || row.guests?.phone || "—";
      const arrival = row.guests?.arrival_date || "—";
      lines.push(`${idx + 1}. ${name}${room}`);
      lines.push(`   📅 ${arrival} · 📱 ${phone}`);
      lines.push(`   «${String(row.message ?? "").trim()}»`);
    });
    lines.push("", "לשבץ בלוח הספא ולהחזיר לאורח עם שעה מדויקת 🙏");
  }
  return lines.join("\n");
}

/** Single-lead clipboard copy — same row format as buildSpaUpsellStaffCopy, no numbering/header/footer. */
export function buildSpaLeadSingleCopy(lead) {
  const name = lead?.guests?.name || "אורח";
  const room = lead?.guests?.room ? ` · ${lead.guests.room}` : "";
  const phone = lead?.phone || lead?.guests?.phone || "—";
  const arrival = lead?.guests?.arrival_date || "—";
  const message = String(lead?.message ?? "").trim();
  const lines = [
    `💆 ${name}${room}`,
    `📅 ${arrival} · 📱 ${phone}`,
  ];
  if (message) lines.push(`«${message}»`);
  return lines.join("\n");
}

export function buildInboxDeepLink(phone, guestName) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return STAFF_APP_ORIGIN;
  const params = new URLSearchParams({ page: "wa_inbox", phone: digits });
  if (guestName?.trim()) params.set("guestName", guestName.trim());
  return `${STAFF_APP_ORIGIN}/?${params.toString()}`;
}

export function buildSpaBoardDeepLink() {
  return `${STAFF_APP_ORIGIN}/?page=spa_board`;
}

/**
 * Open spa upsell acceptance leads for guests arriving on `arrivalDate`.
 */
export async function fetchSpaUpsellLeads(supabase, arrivalDate) {
  if (!supabase || !arrivalDate) return { leads: [], error: null };

  const { data, error } = await supabase
    .from("guest_alerts")
    .select("id, phone, message, created_at, resolved, alert_type, guests!inner(id, name, phone, room, arrival_date, departure_date, status)")
    .eq("alert_type", "spa_upsell_accept")
    .eq("resolved", false)
    .eq("guests.arrival_date", arrivalDate)
    .order("created_at", { ascending: false });

  if (error) return { leads: [], error };

  return { leads: data ?? [], error: null };
}

const SPA_LEAD_SELECT = "id, phone, message, created_at, resolved, resolved_at, resolution_notes, alert_type, guests(id, name, phone, room, room_type, arrival_date, departure_date, status, guest_profile)";

/** @typedef {'open' | 'resolved' | 'all'} SpaLeadStatusFilter */

/**
 * Spa coordinator leads — any arrival date.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ status?: SpaLeadStatusFilter }} [opts]
 */
export async function fetchSpaCoordinatorLeads(supabase, opts = {}) {
  if (!supabase) return { leads: [], error: null };

  const status = opts.status ?? "open";
  let query = supabase
    .from("guest_alerts")
    .select(SPA_LEAD_SELECT)
    .in("alert_type", SPA_COORDINATOR_ALERT_TYPES);

  if (status === "open") query = query.eq("resolved", false);
  else if (status === "resolved") query = query.eq("resolved", true);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) return { leads: [], error };

  const leads = (data ?? []).filter((row) => row.guests);
  return { leads, error: null };
}

/** All open spa coordinator leads — any arrival date. */
export async function fetchAllOpenSpaUpsellLeads(supabase) {
  return fetchSpaCoordinatorLeads(supabase, { status: "open" });
}

export async function fetchOpenSpaUpsellLeadCount(supabase) {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("guest_alerts")
    .select("id", { count: "exact", head: true })
    .in("alert_type", SPA_COORDINATOR_ALERT_TYPES)
    .eq("resolved", false);
  if (error) return 0;
  return count ?? 0;
}

export async function resolveSpaUpsellLead(supabase, leadId, notes = "סגור מלוח לידים ספא") {
  if (!supabase || !leadId) return { error: new Error("חסר מזהה") };
  const { data: authData } = await supabase.auth.getUser();
  const patch = {
    resolved: true,
    resolved_by: authData?.user?.id ?? null,
    resolved_at: new Date().toISOString(),
    resolution_notes: notes,
  };
  const { error } = await supabase.from("guest_alerts").update(patch).eq("id", leadId);
  return { error: error ?? null, patch };
}

/** Reopen a resolved spa lead (undo accidental "בוצע"). */
export async function unresolveSpaUpsellLead(supabase, leadId) {
  if (!supabase || !leadId) return { error: new Error("חסר מזהה") };
  const patch = {
    resolved: false,
    resolved_by: null,
    resolved_at: null,
    resolution_notes: null,
  };
  const { error } = await supabase.from("guest_alerts").update(patch).eq("id", leadId);
  return { error: error ?? null, patch };
}

export async function fetchSpaUpsellSentCount(supabase, arrivalDate) {
  if (!supabase || !arrivalDate) return 0;
  const { count } = await supabase
    .from("guests")
    .select("id", { count: "exact", head: true })
    .eq("arrival_date", arrivalDate)
    .eq("msg_spa_upsell_sent", true)
    .neq("status", "cancelled");
  return count ?? 0;
}

function guestStayOverlapsDate(guest, dateYmd) {
  if (!guest?.arrival_date || !dateYmd) return false;
  const dep = guest.departure_date || guest.arrival_date;
  return guest.arrival_date <= dateYmd && dep >= dateYmd;
}

/** Index guest rows by normalized phone (+972 / 972 variants share one key). */
export function indexGuestsByPhoneKey(guests) {
  const byKey = new Map();
  for (const g of guests ?? []) {
    const key = normalizeGuestPhoneForLookup(g.phone);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(g);
  }
  return byKey;
}

function buildPasteGuestItem(row, guest) {
  return {
    id: guest.id,
    name: row.name || guest.name,
    phone: guest.phone,
    room: guest.room,
    source: "paste",
    arrival_date: guest.arrival_date,
  };
}

function ineligibleReasonForGuest(guest, arrivalDate) {
  if (isEffectiveSuiteGuest(guest)) {
    return `אורח סוויטה (${guest.room || "—"}) — מרכז זה לבילוי יומי בלבד`;
  }
  if (guest.msg_spa_upsell_sent) return "כבר נשלחה הצעה";
  if (guestHasSpaOnDate(guest, arrivalDate)) return "יש תור ספא";
  if (!String(guest.room ?? "").trim()) return "חסר שיוך חדר/חבילה";
  return "לא מתאים לבילוי יומי";
}

function buildPriorVisitHint(matches, arrivalDate) {
  const priorDates = [
    ...new Set(
      matches
        .filter((g) => g.arrival_date && g.arrival_date !== arrivalDate && !isEffectiveSuiteGuest(g))
        .map((g) => g.arrival_date),
    ),
  ];
  if (!priorDates.length || !arrivalDate) return null;
  return `יש ביקור קודם ב-${priorDates.join(", ")} — «צור פרופיל» יוסיף שורה חדשה ל-${arrivalDate} בלבד (לא כפילות)`;
}

/**
 * Pure resolver — maps one pasted row + all DB matches to merged / notFound / ineligible.
 * @returns {{ kind: "merged" | "notFound" | "ineligible", item?: object, reason?: string, hint?: string }}
 */
export function resolvePastedRowAgainstGuests(row, matches, arrivalDate) {
  if (!matches?.length) return { kind: "notFound" };

  const onDate = arrivalDate
    ? matches.filter((g) => g.arrival_date === arrivalDate)
    : matches;

  if (!onDate.length) {
    const suiteOverlap = arrivalDate
      ? matches.find((g) => isEffectiveSuiteGuest(g) && guestStayOverlapsDate(g, arrivalDate))
      : null;
    if (suiteOverlap) {
      return {
        kind: "ineligible",
        item: buildPasteGuestItem(row, suiteOverlap),
        reason: `אורח סוויטה (${suiteOverlap.room || "—"}) — לא ניתן ליצור בילוי יומי לתאריך ${arrivalDate}`,
      };
    }
    const hint = buildPriorVisitHint(matches, arrivalDate);
    return hint ? { kind: "notFound", hint } : { kind: "notFound" };
  }

  if (onDate.length > 1) {
    const guest = onDate[0];
    return {
      kind: "ineligible",
      item: buildPasteGuestItem(row, guest),
      reason: `כפילות פרופיל (${onDate.length} שורות ל-${arrivalDate}) — פתח AddGuestModal לתיקון`,
    };
  }

  const guest = onDate[0];
  const item = buildPasteGuestItem(row, guest);

  if (isEffectiveSuiteGuest(guest)) {
    return { kind: "ineligible", item, reason: ineligibleReasonForGuest(guest, arrivalDate) };
  }

  if (isSpaUpsellEligibleOnArrivalDate(guest, arrivalDate)) {
    return { kind: "merged", item };
  }

  return {
    kind: "ineligible",
    item,
    reason: ineligibleReasonForGuest(guest, arrivalDate),
  };
}

/**
 * Merge pasted phone/name rows with guest profiles for the hub's arrival date.
 * Phone lookup uses +972 / 972 variants (guestSegmentGuard parity).
 * @returns {{ merged: Array, notFound: Array, ineligible: Array, invalid: string[] }}
 */
export async function mergePastedSpaUpsellContacts(supabase, pasteText, arrivalDate) {
  const { rows, invalid } = parseWaiterPulsePaste(pasteText);
  if (!rows.length) {
    return { merged: [], notFound: [], ineligible: [], invalid };
  }

  const queryPhones = new Set();
  for (const row of rows) {
    for (const v of phoneLookupVariants(row.phone)) queryPhones.add(v);
  }

  const { data, error } = await supabase
    .from("guests")
    .select("id, phone, name, room_type, room, spa_date, spa_time, arrival_date, departure_date, status, msg_spa_upsell_sent")
    .in("phone", [...queryPhones])
    .neq("status", "cancelled");

  if (error) throw error;

  const byPhoneKey = indexGuestsByPhoneKey(data);
  const merged = [];
  const notFound = [];
  const ineligible = [];

  for (const row of rows) {
    const key = normalizeGuestPhoneForLookup(row.phone);
    const matches = key ? (byPhoneKey.get(key) ?? []) : [];
    const resolved = resolvePastedRowAgainstGuests(row, matches, arrivalDate);

    if (resolved.kind === "notFound") {
      notFound.push(resolved.hint ? { ...row, hint: resolved.hint } : row);
    } else if (resolved.kind === "merged") merged.push(resolved.item);
    else ineligible.push({ ...resolved.item, reason: resolved.reason });
  }

  return { merged, notFound, ineligible, invalid };
}

const SPA_UPSELL_STAGE_KEY = "spa_upsell_daypass";

/** Pending staff schedules for spa upsell on a given arrival date. */
export async function fetchSpaUpsellPendingSchedules(supabase, arrivalDate) {
  if (!supabase || !arrivalDate) return { schedules: [], error: null };

  const { data, error } = await supabase
    .from("scheduled_tasks")
    .select(
      "id, guest_id, scheduled_for, force_channel, status, guests!inner(id, name, phone, room, arrival_date)",
    )
    .eq("stage_key", SPA_UPSELL_STAGE_KEY)
    .eq("status", "pending")
    .eq("staff_scheduled", true)
    .eq("guests.arrival_date", arrivalDate)
    .order("scheduled_for", { ascending: true });

  if (error) return { schedules: [], error };

  const schedules = (data ?? []).map((row) => ({
    id: row.id,
    guestId: row.guest_id,
    scheduledFor: row.scheduled_for,
    forceChannel: row.force_channel,
    name: row.guests?.name ?? "",
    phone: row.guests?.phone ?? "",
    room: row.guests?.room ?? "",
  }));

  return { schedules, error: null };
}

export async function updateSpaUpsellGuestName(supabase, guestId, name) {
  const trimmed = String(name ?? "").trim();
  if (!supabase || !guestId || !trimmed) return { error: new Error("שם חסר") };
  const { error } = await supabase.from("guests").update({ name: trimmed }).eq("id", guestId);
  return { error: error ?? null };
}

export function fmtLeadTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
