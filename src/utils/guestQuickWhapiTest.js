// Quick guest lookup/create by phone — for Whapi self-test sends (phone-only profile).

import { normalizeGuestPhoneEdit } from "./ezgoParser";

export function todayYmdIsrael() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function normalizeQuickSendPhone(raw) {
  const { value, valid } = normalizeGuestPhoneEdit(String(raw ?? "").trim());
  if (!valid || !value) {
    return { phone: null, error: "מספר טלפון לא תקין — הזן 05… או מספר בינלאומי עם +" };
  }
  return { phone: value, error: null };
}

const GUEST_SELECT =
  "id, name, phone, room, room_type, arrival_date, status, wa_window_expires_at";

/**
 * Find latest guest row for phone, or create a muted day-guest test profile.
 * @returns {{ guest: object, created: boolean }}
 */
export async function findOrCreateGuestByPhone(supabase, phone, nameHint = "") {
  const { data: rows, error: findErr } = await supabase
    .from("guests")
    .select(GUEST_SELECT)
    .eq("phone", phone)
    .order("arrival_date", { ascending: false })
    .limit(1);
  if (findErr) throw new Error(findErr.message);
  if (rows?.[0]) return { guest: rows[0], created: false };

  const today = todayYmdIsrael();
  const name = String(nameHint ?? "").trim() || `בדיקה ${phone.slice(-4)}`;
  const { data: created, error: insErr } = await supabase
    .from("guests")
    .insert({
      name,
      phone,
      status: "expected",
      room_type: "day_guest",
      room: "Premium Day 1",
      arrival_date: today,
      departure_date: today,
      automation_scope: "muted",
    })
    .select(GUEST_SELECT)
    .maybeSingle();
  if (insErr) throw new Error(insErr.message);
  if (!created) throw new Error("יצירת פרופיל נכשלה");
  return { guest: created, created: true };
}

export function formatDeliveredChannelLabel(channel) {
  if (channel === "whapi") return "📱 מכשיר הסוויטות (Whapi)";
  if (channel === "meta") return "🔵 Dream Bot (Meta)";
  return "✅ נשלח";
}
