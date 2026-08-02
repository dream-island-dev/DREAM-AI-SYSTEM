// Spa upsell hub — leads fetch, paste merge, staff copy, Whapi template prep.

import { parseWaiterPulsePaste } from "./waiterPulseContacts";
import { isSpaUpsellEligible } from "./spaUpsellAudience";

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

/** All open spa coordinator leads — any arrival date. */
export async function fetchAllOpenSpaUpsellLeads(supabase) {
  if (!supabase) return { leads: [], error: null };

  const { data, error } = await supabase
    .from("guest_alerts")
    .select("id, phone, message, created_at, resolved, alert_type, guests(id, name, phone, room, room_type, arrival_date, departure_date, status)")
    .in("alert_type", SPA_COORDINATOR_ALERT_TYPES)
    .eq("resolved", false)
    .order("created_at", { ascending: false });

  if (error) return { leads: [], error };

  const leads = (data ?? []).filter((row) => row.guests);
  return { leads, error: null };
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
  return { error: error ?? null };
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

/**
 * Merge pasted phone/name rows with guest profiles (any arrival date).
 * @returns {{ merged: Array, notFound: Array, ineligible: Array }}
 */
export async function mergePastedSpaUpsellContacts(supabase, pasteText, arrivalDate) {
  const { rows, invalid } = parseWaiterPulsePaste(pasteText);
  if (!rows.length) {
    return { merged: [], notFound: [], ineligible: [], invalid };
  }

  const phones = [...new Set(rows.map((r) => r.phone))];
  const { data, error } = await supabase
    .from("guests")
    .select("id, phone, name, room_type, room, spa_date, spa_time, arrival_date, status, msg_spa_upsell_sent")
    .in("phone", phones);

  if (error) throw error;

  const byPhone = new Map((data ?? []).map((g) => [g.phone, g]));
  const merged = [];
  const notFound = [];
  const ineligible = [];

  for (const row of rows) {
    const guest = byPhone.get(row.phone);
    if (!guest) {
      notFound.push(row);
      continue;
    }
    const eligible = isSpaUpsellEligible(guest, arrivalDate || guest.arrival_date);
    const item = {
      id: guest.id,
      name: row.name || guest.name,
      phone: guest.phone,
      room: guest.room,
      source: "paste",
      arrival_date: guest.arrival_date,
    };
    if (eligible) merged.push(item);
    else ineligible.push({ ...item, reason: guest.msg_spa_upsell_sent ? "כבר נשלחה הצעה" : "יש ספא / לא מתאים" });
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
