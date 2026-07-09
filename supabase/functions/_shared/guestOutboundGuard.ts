// Guest outbound guard — single source of truth for "may we send WA to this guest?"
// Used by whatsapp-send, whatsapp-webhook, whatsapp-cron (race re-check).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isPostStayPipelineTrigger } from "./pipelineLifecycle.ts";

export const INACTIVE_GUEST_STATUSES = new Set(["cancelled", "checked_out"]);

export type ActiveGuestRow = {
  id: number;
  phone: string;
  status: string;
  name?: string | null;
  wa_window_expires_at?: string | null;
  portal_token?: string | null;
  automation_muted?: boolean | null;
  automation_scope?: string | null;
  claimed_by?: string | null;
  // Additive (guest-outbound Whapi routing, Phase 1) — needed to classify
  // effective suite guests via _shared/suiteNames.ts's isEffectiveSuiteGuest().
  room?: string | null;
  room_type?: string | null;
};

export function phoneLookupVariants(phone: string): string[] {
  const p = phone.trim();
  if (!p) return [];
  const out = new Set<string>([p]);
  if (p.startsWith("+")) out.add(p.slice(1));
  else out.add(`+${p}`);
  return [...out];
}

export function isGuestActiveForOutbound(
  guest: { status?: string | null } | null | undefined,
): boolean {
  if (!guest) return false;
  const s = guest.status ?? "";
  return !INACTIVE_GUEST_STATUSES.has(s);
}

/** Returns skip reason or null when guest may receive automation outbound. */
export function assertGuestEligibleForAutomation(
  guest: { status?: string | null } | null | undefined,
  trigger?: string,
): string | null {
  if (!guest) return "guest_not_found";
  if (guest.status === "cancelled") return "guest_cancelled";
  if (guest.status === "checked_out" && !isPostStayPipelineTrigger(trigger ?? "")) {
    return "guest_checked_out";
  }
  return null;
}

const ACTIVE_GUEST_SELECT =
  "id, phone, status, name, wa_window_expires_at, portal_token, automation_muted, automation_scope, claimed_by, room, room_type";

export async function loadActiveGuestById(
  supabase: SupabaseClient,
  guestId: number | string,
): Promise<ActiveGuestRow | null> {
  const { data, error } = await supabase
    .from("guests")
    .select(ACTIVE_GUEST_SELECT)
    .eq("id", guestId)
    .maybeSingle();
  if (error) {
    console.warn("[guestOutboundGuard] loadActiveGuestById error:", error.message);
    return null;
  }
  if (!data || !isGuestActiveForOutbound(data)) return null;
  return data as ActiveGuestRow;
}

/** Post-stay pipeline may target guests already archived as checked_out. */
export async function loadGuestByIdForPipeline(
  supabase: SupabaseClient,
  guestId: number | string,
  trigger: string,
): Promise<ActiveGuestRow | null> {
  const { data, error } = await supabase
    .from("guests")
    .select(ACTIVE_GUEST_SELECT)
    .eq("id", guestId)
    .maybeSingle();
  if (error) {
    console.warn("[guestOutboundGuard] loadGuestByIdForPipeline error:", error.message);
    return null;
  }
  if (!data) return null;
  if (data.status === "cancelled") return null;
  if (data.status === "checked_out" && !isPostStayPipelineTrigger(trigger)) return null;
  return data as ActiveGuestRow;
}

export async function loadActiveGuestByPhone(
  supabase: SupabaseClient,
  phone: string,
): Promise<ActiveGuestRow | null> {
  const variants = phoneLookupVariants(phone);
  if (!variants.length) return null;

  const { data, error } = await supabase
    .from("guests")
    .select(ACTIVE_GUEST_SELECT)
    .in("phone", variants)
    .maybeSingle();
  if (error) {
    console.warn("[guestOutboundGuard] loadActiveGuestByPhone error:", error.message);
    return null;
  }
  if (!data || !isGuestActiveForOutbound(data)) return null;
  return data as ActiveGuestRow;
}

/**
 * Staff-initiated single-guest sends (inbox_reply, manual_script,
 * payment_and_workshops) must never be gated by guest status — only
 * automation (cron/pipeline) and the bot's own auto-reply enforce
 * INACTIVE_GUEST_STATUSES. Returns whichever guest row matches the phone
 * (any status), or null if none exists at all.
 *
 * .order().limit(1) instead of .maybeSingle(): guests has no global phone
 * uniqueness (a returning guest has one row per past stay), so a phone
 * match can be >1 row — .maybeSingle() would error on that and the caller
 * would see the same "no active guest" message as a true miss.
 */
export async function loadGuestByPhoneForStaffReply(
  supabase: SupabaseClient,
  phone: string,
): Promise<ActiveGuestRow | null> {
  const variants = phoneLookupVariants(phone);
  if (!variants.length) return null;

  const { data, error } = await supabase
    .from("guests")
    .select(`${ACTIVE_GUEST_SELECT}, arrival_date`)
    .in("phone", variants)
    .order("arrival_date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[guestOutboundGuard] loadGuestByPhoneForStaffReply error:", error.message);
    return null;
  }
  return (data?.[0] as ActiveGuestRow | undefined) ?? null;
}

export const GUEST_NOT_ACTIVE_HE =
  "אין פרופיל אורח פעיל במערכת — לא ניתן לשלוח הודעה (האורח נמחק או סומן כמבוטל/עזב).";
