// supabase/functions/_shared/executiveIdentity.ts
// Executive identity resolution for the Executive Voice Assistant (Eliad Co-Pilot).
// Supports multiple authorized executives via KNOWN_EXECUTIVES (fast path, no
// env/DB round-trip needed), EXECUTIVE_PHONES/EXECUTIVE_PHONE env secrets
// (comma-separated / single, backwards compat), and a profiles.phone fallback
// (migration 175 links Eliad, migration 177 links Mike for QA), matched the
// same [digits, "+digits", local-0-prefix] way whapi-webhook already resolves
// profiles by phone (see resolveTaskByReaction ~line 371).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** "0505421751" / "+972505421751" / "972-50-542-1751" → "972505421751". */
export function normalizeExecutivePhoneDigits(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

export type ExecutiveProfile = {
  phoneDigits: string;
  displayName: string;
  title: string;
};

const KNOWN_EXECUTIVES: Record<string, ExecutiveProfile> = {
  "972505421751": { phoneDigits: "972505421751", displayName: "אליעד", title: "מנכ\"ל" },
  "972506842439": { phoneDigits: "972506842439", displayName: "מייק", title: "ארכיטקט מערכת" },
};

/** profiles.email (lowercase) → the KNOWN_EXECUTIVES profile it falls back to. */
const PROFILE_FALLBACK_EMAILS: Record<string, ExecutiveProfile> = {
  "eliad.benshimol@gmail.com": KNOWN_EXECUTIVES["972505421751"],
  "promote7il@gmail.com": KNOWN_EXECUTIVES["972506842439"],
};

let _profileFallbackCache: { rows: Array<{ email: string; phone: string | null }>; at: number } | null = null;
const PROFILE_FALLBACK_TTL_MS = 5 * 60 * 1000;

async function fetchExecutiveProfilePhones(
  supabase: SupabaseClient,
): Promise<Array<{ email: string; phone: string | null }>> {
  const now = Date.now();
  if (_profileFallbackCache && now - _profileFallbackCache.at < PROFILE_FALLBACK_TTL_MS) {
    return _profileFallbackCache.rows;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("email, phone")
    .in("email", Object.keys(PROFILE_FALLBACK_EMAILS));
  if (error) {
    console.warn("[executiveIdentity] profile fallback lookup failed:", error.message);
    return _profileFallbackCache?.rows ?? [];
  }
  const rows = (data ?? []) as Array<{ email: string; phone: string | null }>;
  _profileFallbackCache = { rows, at: now };
  return rows;
}

function _phoneMatchesInbound(phone: string | null, inbound: string): boolean {
  if (!phone) return false;
  const local = inbound.startsWith("972") ? "0" + inbound.slice(3) : inbound;
  return [inbound, "+" + inbound, local].includes(phone);
}

/**
 * Resolves an inbound phone (any format) to the authorized executive profile.
 * Order: normalize → KNOWN_EXECUTIVES → EXECUTIVE_PHONES/EXECUTIVE_PHONE env
 * → profiles.email/phone fallback. Returns null when nobody matches.
 */
export async function resolveExecutiveInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<ExecutiveProfile | null> {
  const inbound = normalizeExecutivePhoneDigits(phoneDigits);
  if (!inbound) return null;

  const known = KNOWN_EXECUTIVES[inbound];
  if (known) return known;

  const envPhones = [
    ...(Deno.env.get("EXECUTIVE_PHONES")?.split(",") ?? []),
    Deno.env.get("EXECUTIVE_PHONE") ?? "",
  ]
    .map((p) => p.trim())
    .filter(Boolean);
  for (const envPhone of envPhones) {
    if (normalizeExecutivePhoneDigits(envPhone) === inbound) {
      return { phoneDigits: inbound, displayName: "מנהל", title: "" };
    }
  }

  if (!supabase) return null;

  const rows = await fetchExecutiveProfilePhones(supabase);
  for (const row of rows) {
    if (_phoneMatchesInbound(row.phone, inbound)) {
      return PROFILE_FALLBACK_EMAILS[row.email?.toLowerCase()] ?? { phoneDigits: inbound, displayName: "מנהל", title: "" };
    }
  }
  return null;
}

/** True when phoneDigits (bare digits, no "+") belongs to an authorized executive. */
export async function isExecutiveInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  return (await resolveExecutiveInbound(phoneDigits, supabase)) !== null;
}
