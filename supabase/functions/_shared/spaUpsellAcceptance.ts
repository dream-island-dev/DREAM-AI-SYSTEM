// Spa upsell acceptance — eligibility (offer sent) + manual lead helper.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { dispatchGuestSpaIntent, hasOpenSpaCoordinatorLead, SPA_COORDINATOR_ALERT_TYPES, type SpaCoordinatorAlertType } from "./spaIntentRouting.ts";

export { SPA_COORDINATOR_ALERT_TYPES, type SpaCoordinatorAlertType };

const STAGE_KEY = "spa_upsell_daypass";
const MANUAL_LEAD_PREFIX = "[ידני מ-Inbox]";

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
  return hasOpenSpaCoordinatorLead(supabase, guestId, phone);
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
  const alertType = opts.alertType ?? "spa_upsell_accept";
  const formatted = formatManualSpaUpsellLeadMessage(opts.message);

  const { data: guestRow } = await supabase
    .from("guests")
    .select("id, name, phone, room, room_type, arrival_date, status")
    .eq("id", opts.guestId)
    .maybeSingle();

  const guest = guestRow ?? {
    id: opts.guestId,
    name: opts.guestName,
    phone: opts.phone,
    room: opts.room,
    arrival_date: opts.arrivalDate,
  };

  const result = await dispatchGuestSpaIntent(supabase, {
    guestId: opts.guestId,
    phone: opts.phone,
    guest: guest as Record<string, unknown>,
    message: formatted,
    alertType,
    conversationId: opts.conversationId ?? null,
    guestName: opts.guestName ?? (guest.name as string | null) ?? null,
    room: opts.room ?? (guest.room as string | null) ?? null,
    sourceLabel: opts.sourceLabel ?? "Inbox (ידני)",
    guestReplyForOwnerDm: alertType === "spa_upsell_accept" ? opts.message : null,
    dedupeOpenLead: true,
  });

  if (!result.ok) {
    return { ok: false, error: result.error ?? "שגיאה בהוספת ליד" };
  }
  if (result.alreadyExists) {
    return { ok: true, alreadyExists: true };
  }
  return { ok: true, alertId: result.alertId };
}
