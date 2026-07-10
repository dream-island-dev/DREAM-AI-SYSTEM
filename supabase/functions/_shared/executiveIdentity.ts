// supabase/functions/_shared/executiveIdentity.ts
// CEO identity resolution for the Executive Voice Assistant (Eliad Co-Pilot).
// Primary: EXECUTIVE_PHONE secret (digits, E.164 without "+"). Fallback: the
// profiles row linked by migration 175 (role='admin' + email match), matched
// the same [digits, "+digits", local-0-prefix] way whapi-webhook already
// resolves profiles by phone (see resolveTaskByReaction ~line 371).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** "0505421751" / "+972505421751" / "972-50-542-1751" → "972505421751". */
export function normalizeExecutivePhoneDigits(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

let _profileFallbackCache: { phone: string | null; at: number } | null = null;
const PROFILE_FALLBACK_TTL_MS = 5 * 60 * 1000;

async function fetchExecutiveProfilePhone(supabase: SupabaseClient): Promise<string | null> {
  const now = Date.now();
  if (_profileFallbackCache && now - _profileFallbackCache.at < PROFILE_FALLBACK_TTL_MS) {
    return _profileFallbackCache.phone;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("phone")
    .eq("email", "eliad.benshimol@gmail.com")
    .eq("role", "admin")
    .maybeSingle();
  if (error) {
    console.warn("[executiveIdentity] profile fallback lookup failed:", error.message);
    return _profileFallbackCache?.phone ?? null;
  }
  const phone = ((data as Record<string, unknown> | null)?.phone as string | undefined) ?? null;
  _profileFallbackCache = { phone, at: now };
  return phone;
}

/** True when phoneDigits (bare digits, no "+") belongs to the CEO. */
export async function isExecutiveInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  const inbound = normalizeExecutivePhoneDigits(phoneDigits);
  if (!inbound) return false;

  const envPhone = Deno.env.get("EXECUTIVE_PHONE")?.trim();
  if (envPhone && normalizeExecutivePhoneDigits(envPhone) === inbound) return true;

  if (!supabase) return false;

  const profilePhone = await fetchExecutiveProfilePhone(supabase);
  if (!profilePhone) return false;
  const local = inbound.startsWith("972") ? "0" + inbound.slice(3) : inbound;
  return [inbound, "+" + inbound, local].includes(profilePhone);
}
