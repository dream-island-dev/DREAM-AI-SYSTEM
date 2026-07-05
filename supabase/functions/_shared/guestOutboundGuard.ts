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
  claimed_by?: string | null;
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
  "id, phone, status, name, wa_window_expires_at, portal_token, automation_muted, claimed_by";

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

export const GUEST_NOT_ACTIVE_HE =
  "אין פרופיל אורח פעיל במערכת — לא ניתן לשלוח הודעה (האורח נמחק או סומן כמבוטל/עזב).";
