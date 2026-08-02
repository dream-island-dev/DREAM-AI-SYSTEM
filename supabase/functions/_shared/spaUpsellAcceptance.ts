// Spa upsell acceptance — eligibility (offer sent) + manual lead helper.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { onGuestAlertInserted } from "./guestAlertWhapiNotify.ts";

const STAGE_KEY = "spa_upsell_daypass";
const MANUAL_LEAD_PREFIX = "[ידני מ-Inbox]";

export const SPA_COORDINATOR_ALERT_TYPES = ["spa_upsell_accept", "spa_request"] as const;
export type SpaCoordinatorAlertType = typeof SPA_COORDINATOR_ALERT_TYPES[number];

export function guestHasNoSpaSlotOnArrival(guest: Record<string, unknown>): boolean {
  const arrival = String(guest.arrival_date ?? "").slice(0, 10);
  const spaDate = String(guest.spa_date ?? "").slice(0, 10);
  if (spaDate && spaDate === arrival) return false;
  if (guest.spa_time) return false;
  return true;
}

/** Sync gate — flag only (tests + fast path). */
export function isSpaUpsellAcceptanceEligible(guest: Record<string, unknown>): boolean {
  if (!guestHasNoSpaSlotOnArrival(guest)) return false;
  return guest.msg_spa_upsell_sent === true;
}

/** True when guest received the upsell offer even if msg_spa_upsell_sent lagged. */
export async function resolveSpaUpsellAcceptanceEligible(
  supabase: SupabaseClient,
  guest: Record<string, unknown>,
): Promise<boolean> {
  if (!guestHasNoSpaSlotOnArrival(guest)) return false;
  if (guest.msg_spa_upsell_sent === true) return true;

  const guestId = guest.id as number | undefined;
  if (!guestId) return false;

  const { count: logCount, error: logErr } = await supabase
    .from("notification_log")
    .select("id", { count: "exact", head: true })
    .eq("guest_id", guestId)
    .eq("trigger_type", STAGE_KEY);
  if (!logErr && (logCount ?? 0) > 0) return true;

  const { count: schedCount, error: schedErr } = await supabase
    .from("scheduled_tasks")
    .select("id", { count: "exact", head: true })
    .eq("guest_id", guestId)
    .eq("stage_key", STAGE_KEY)
    .eq("status", "dispatched");
  if (!schedErr && (schedCount ?? 0) > 0) return true;

  const phone = String(guest.phone ?? "").trim();
  if (phone) {
    const { count: convCount, error: convErr } = await supabase
      .from("whatsapp_conversations")
      .select("id", { count: "exact", head: true })
      .eq("guest_id", guestId)
      .eq("direction", "outbound")
      .eq("intent", STAGE_KEY);
    if (!convErr && (convCount ?? 0) > 0) return true;
  }

  return false;
}

export async function hasOpenSpaUpsellLead(
  supabase: SupabaseClient,
  guestId: number,
  phone?: string | null,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("guest_alerts")
    .select("id", { count: "exact", head: true })
    .in("alert_type", [...SPA_COORDINATOR_ALERT_TYPES])
    .eq("resolved", false)
    .eq("guest_id", guestId);
  if (!error && (count ?? 0) > 0) return true;

  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return false;
  const { count: phoneCount, error: phoneErr } = await supabase
    .from("guest_alerts")
    .select("id", { count: "exact", head: true })
    .in("alert_type", [...SPA_COORDINATOR_ALERT_TYPES])
    .eq("resolved", false)
    .ilike("phone", `%${digits.slice(-9)}%`);
  return !phoneErr && (phoneCount ?? 0) > 0;
}

export function formatManualSpaUpsellLeadMessage(rawText: string): string {
  const body = String(rawText ?? "").trim() || "נוסף ידנית מ-Inbox";
  return `${MANUAL_LEAD_PREFIX} «${body}»`;
}

export function isManualSpaUpsellLeadMessage(message: string | null | undefined): boolean {
  return String(message ?? "").startsWith(MANUAL_LEAD_PREFIX);
}

export async function createManualSpaUpsellLead(
  supabase: SupabaseClient,
  opts: {
    guestId: number;
    phone: string;
    guestName?: string | null;
    room?: string | null;
    arrivalDate?: string | null;
    message: string;
    conversationId?: number | null;
    sourceLabel?: string;
    alertType?: SpaCoordinatorAlertType;
  },
): Promise<{ ok: true; alertId?: number; alreadyExists?: boolean } | { ok: false; error: string }> {
  const exists = await hasOpenSpaUpsellLead(supabase, opts.guestId, opts.phone);
  if (exists) {
    return { ok: true, alreadyExists: true };
  }

  const formatted = formatManualSpaUpsellLeadMessage(opts.message);
  const alertType = opts.alertType ?? "spa_upsell_accept";

  const { error: insertErr } = await supabase.from("guest_alerts").insert({
    guest_id: opts.guestId,
    phone: opts.phone,
    alert_type: alertType,
    message: formatted,
    conversation_id: opts.conversationId ?? null,
    resolved: false,
  });
  if (insertErr) {
    return { ok: false, error: insertErr.message };
  }

  await onGuestAlertInserted(supabase, {
    guestId: opts.guestId,
    phone: opts.phone,
    conversationId: opts.conversationId ?? null,
    message: formatted,
    alertType,
    guestName: opts.guestName ?? null,
    room: opts.room ?? null,
    sourceLabel: opts.sourceLabel ?? "Inbox (ידני)",
  }).catch((e: Error) =>
    console.warn("[spaUpsellAcceptance] manual lead notify failed:", e.message),
  );

  const guestPatch: Record<string, unknown> = {
    requires_attention: true,
    requires_attention_since: new Date().toISOString(),
    attention_reason: "request",
  };
  if (alertType === "spa_upsell_accept") {
    guestPatch.msg_spa_upsell_sent = true;
  }
  await supabase.from("guests").update(guestPatch).eq("id", opts.guestId);

  return { ok: true };
}
