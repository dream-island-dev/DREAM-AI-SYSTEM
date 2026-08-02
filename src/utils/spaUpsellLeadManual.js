// Manual spa lead — Inbox button → Edge Function.

import { SPA_COORDINATOR_ALERT_TYPES } from "./spaUpsellHub";

const MANUAL_PREFIX = "[ידני מ-Inbox]";

export function isManualSpaUpsellLeadMessage(message) {
  return String(message ?? "").startsWith(MANUAL_PREFIX);
}

export async function fetchOpenSpaUpsellLeadForGuest(supabase, guestId, phone) {
  if (!supabase || !guestId) return false;
  const { count, error } = await supabase
    .from("guest_alerts")
    .select("id", { count: "exact", head: true })
    .in("alert_type", SPA_COORDINATOR_ALERT_TYPES)
    .eq("resolved", false)
    .eq("guest_id", guestId);
  if (!error && (count ?? 0) > 0) return true;
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, "").slice(-9);
  if (!digits) return false;
  const { count: c2, error: e2 } = await supabase
    .from("guest_alerts")
    .select("id", { count: "exact", head: true })
    .in("alert_type", SPA_COORDINATOR_ALERT_TYPES)
    .eq("resolved", false)
    .ilike("phone", `%${digits}%`);
  return !e2 && (c2 ?? 0) > 0;
}

export async function addManualSpaUpsellLeadFromInbox(supabase, {
  guestId,
  phone,
  message,
  conversationId,
  alertType = "spa_request",
}) {
  const { data, error } = await supabase.functions.invoke("spa-upsell-manual-lead", {
    body: {
      guest_id: guestId,
      phone,
      message: message || "נוסף ידנית מ-Inbox",
      conversation_id: conversationId ?? null,
      alert_type: alertType,
    },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? "שגיאה בהוספת ליד");
  return data;
}
