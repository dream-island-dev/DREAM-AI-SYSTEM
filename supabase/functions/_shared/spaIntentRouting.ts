// Cohort-aware spa intent dispatch — single source of truth for guest_alerts
// side effects (Requests Board, Spa Leads, Whapi group, Adir DM, owner DM).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InboxAlertChannel } from "./inboxRedAlert.ts";
import {
  onGuestAlertInserted,
  notifySpaUpsellAcceptOwnerDm,
} from "./guestAlertWhapiNotify.ts";
import { israelYmd } from "./automationSchedule.ts";
import {
  isAdministrativeInHouseRequest,
} from "./automationSchedule.ts";
import {
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
  type GuestRoomFields,
} from "./suiteNames.ts";
import {
  isSpaGroupLeadGuest,
  notifySpaGroupLeadByEmail,
  resolveSpaGroupLabel,
} from "./spaGroupLeadNotify.ts";

export const SPA_COORDINATOR_ALERT_TYPES = ["spa_upsell_accept", "spa_request"] as const;
export type SpaCoordinatorAlertType = typeof SPA_COORDINATOR_ALERT_TYPES[number];

export async function hasOpenSpaCoordinatorLead(
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

export type SpaIntentCohort = "suite" | "daypass";

export function resolveSpaIntentCohort(
  guest: GuestRoomFields | null | undefined,
): SpaIntentCohort | null {
  if (!guest) return null;
  if (isEffectiveSuiteGuest(guest)) return "suite";
  if (isEffectiveDayPassGuest(guest)) return "daypass";
  return null;
}

/** Tier-0 spa treatment — suite or day-pass, any stay phase (incl. T-2 pre-arrival). */
export function shouldInterceptSpaTreatmentRequest(
  text: string,
  guest: GuestRoomFields | null | undefined,
): boolean {
  if (!isAdministrativeInHouseRequest(text)) return false;
  return resolveSpaIntentCohort(guest) !== null;
}

export function isGuestArrivingToday(
  guest: Record<string, unknown>,
  now: Date = new Date(),
): boolean {
  const arrival = String(guest.arrival_date ?? "").slice(0, 10);
  return !!arrival && arrival === israelYmd(now);
}

/** Adir personal DM — suite guests only (never day-pass). */
export function shouldAdirPersonalDmForSpaIntent(
  cohort: SpaIntentCohort | null,
): boolean {
  return cohort === "suite";
}

export type DispatchGuestSpaIntentOpts = {
  guestId: number;
  phone: string;
  guest: Record<string, unknown>;
  message: string;
  alertType: SpaCoordinatorAlertType;
  conversationId?: number | null;
  sourceLabel?: string | null;
  guestName?: string | null;
  room?: string | null;
  preferredInboxChannel?: InboxAlertChannel | null;
  /** Day-pass upsell accept — Mike forward block. */
  guestReplyForOwnerDm?: string | null;
  /** Skip duplicate open lead (manual + bot). Default true. */
  dedupeOpenLead?: boolean;
};

export async function dispatchGuestSpaIntent(
  supabase: SupabaseClient,
  opts: DispatchGuestSpaIntentOpts,
): Promise<{ ok: boolean; alertId?: number; alreadyExists?: boolean; error?: string }> {
  const cohort = resolveSpaIntentCohort(opts.guest as GuestRoomFields);
  const guestName = opts.guestName ?? (opts.guest.name as string | null) ?? null;
  const room = opts.room ?? (opts.guest.room as string | null) ?? null;
  const dedupe = opts.dedupeOpenLead !== false;

  if (dedupe) {
    const exists = await hasOpenSpaCoordinatorLead(supabase, opts.guestId, opts.phone);
    if (exists) {
      return { ok: true, alreadyExists: true };
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("guest_alerts")
    .insert({
      guest_id: opts.guestId,
      phone: opts.phone,
      alert_type: opts.alertType,
      message: opts.message,
      conversation_id: opts.conversationId ?? null,
      resolved: false,
    })
    .select("id")
    .maybeSingle();
  if (insertErr) {
    return { ok: false, error: insertErr.message };
  }

  const guestPatch: Record<string, unknown> = {
    requires_attention: true,
    requires_attention_since: new Date().toISOString(),
    attention_reason: opts.alertType === "spa_request" ? "בקשת טיפול בספא" : "request",
  };
  if (opts.alertType === "spa_upsell_accept") {
    guestPatch.msg_spa_upsell_sent = true;
  }
  await supabase.from("guests").update(guestPatch).eq("id", opts.guestId);

  const alsoPersonalDm = shouldAdirPersonalDmForSpaIntent(cohort);

  await onGuestAlertInserted(supabase, {
    guestId: opts.guestId,
    phone: opts.phone,
    conversationId: opts.conversationId ?? null,
    message: opts.message,
    alertType: opts.alertType,
    guestName,
    room,
    sourceLabel: opts.sourceLabel ?? "WhatsApp Bot",
    alsoPersonalDm,
    preferredInboxChannel: opts.preferredInboxChannel ?? null,
  }).catch((e: Error) =>
    console.warn("[spaIntentRouting] staff notify failed:", e.message),
  );

  if (
    cohort === "daypass"
    && opts.alertType === "spa_upsell_accept"
    && opts.guestReplyForOwnerDm
  ) {
    await notifySpaUpsellAcceptOwnerDm(supabase, {
      guestName,
      phone: opts.phone,
      room,
      arrivalDate: (opts.guest.arrival_date as string | null) ?? null,
      guestReply: opts.guestReplyForOwnerDm,
    }).catch((e: Error) =>
      console.warn("[spaIntentRouting] owner DM failed:", e.message),
    );
  }

  if (cohort === "suite" && isGuestArrivingToday(opts.guest)) {
    console.info(
      `[spaIntentRouting] suite spa on arrival day — guest:${opts.guestId} adirDm:${alsoPersonalDm}`,
    );
  }

  // Group leads only (never regular guests) — fresh read, not opts.guest, so this
  // never depends on every caller remembering to select guest_profile.
  if (opts.alertType === "spa_upsell_accept") {
    const { data: freshGuest } = await supabase
      .from("guests")
      .select("guest_profile")
      .eq("id", opts.guestId)
      .maybeSingle();
    if (isSpaGroupLeadGuest(freshGuest)) {
      await notifySpaGroupLeadByEmail(supabase, {
        guestName,
        phone: opts.phone,
        arrivalDate: (opts.guest.arrival_date as string | null) ?? null,
        groupLabel: resolveSpaGroupLabel(freshGuest),
        guestReply: opts.guestReplyForOwnerDm ?? opts.message,
      }).catch((e: Error) =>
        console.warn("[spaIntentRouting] group lead email failed:", e.message),
      );
    }
  }

  return { ok: true, alertId: inserted?.id as number | undefined };
}
