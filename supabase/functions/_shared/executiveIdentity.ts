// supabase/functions/_shared/executiveIdentity.ts
// Executive identity resolution for the Executive Voice Assistant (Eliad Co-Pilot).
// Primary: EXECUTIVE_PHONES / EXECUTIVE_PHONE secrets (digits, E.164 without "+").
// Fallback: profiles rows linked by migration 175 (Eliad) + 177 (Mike QA), matched
// the same [digits, "+digits", local-0-prefix] way whapi-webhook already
// resolves profiles by phone (see resolveTaskByReaction ~line 371).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type ExecutiveProfile = {
  phoneDigits: string;
  displayName: string;
  title: string;
};

/** "0505421751" / "+972505421751" / "972-50-542-1751" → "972505421751". */
export function normalizeExecutivePhoneDigits(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

/** Canonical executives — used for persona + env/profile resolution. */
const KNOWN_EXECUTIVES: Record<string, ExecutiveProfile> = {
  "972505421751": { phoneDigits: "972505421751", displayName: "אליעד", title: 'מנכ"ל' },
  "972506842439": { phoneDigits: "972506842439", displayName: "מייק", title: "ארכיטקט מערכת" },
};

const EXECUTIVE_PROFILE_EMAILS: Array<{ email: string; profile: ExecutiveProfile }> = [
  { email: "eliad.benshimol@gmail.com", profile: KNOWN_EXECUTIVES["972505421751"] },
  { email: "promote7il@gmail.com", profile: KNOWN_EXECUTIVES["972506842439"] },
];

let _profileFallbackCache: { rows: Array<{ phone: string; profile: ExecutiveProfile }>; at: number } | null = null;
const PROFILE_FALLBACK_TTL_MS = 5 * 60 * 1000;

function phoneVariants(digits: string): string[] {
  const local = digits.startsWith("972") ? "0" + digits.slice(3) : digits;
  return [digits, "+" + digits, local];
}

function matchesStoredPhone(stored: string, inboundDigits: string): boolean {
  const normalizedStored = normalizeExecutivePhoneDigits(stored);
  return phoneVariants(inboundDigits).includes(stored)
    || phoneVariants(inboundDigits).includes(normalizedStored)
    || normalizedStored === inboundDigits;
}

function profileFromEnvPhones(): ExecutiveProfile[] {
  const raw = [
    Deno.env.get("EXECUTIVE_PHONES") ?? "",
    Deno.env.get("EXECUTIVE_PHONE") ?? "",
  ].join(",");
  const out: ExecutiveProfile[] = [];
  for (const part of raw.split(",")) {
    const digits = normalizeExecutivePhoneDigits(part.trim());
    if (!digits) continue;
    out.push(KNOWN_EXECUTIVES[digits] ?? {
      phoneDigits: digits,
      displayName: "מנהל",
      title: "ניהול",
    });
  }
  return out;
}

async function fetchExecutiveProfileRows(supabase: SupabaseClient): Promise<Array<{ phone: string; profile: ExecutiveProfile }>> {
  const now = Date.now();
  if (_profileFallbackCache && now - _profileFallbackCache.at < PROFILE_FALLBACK_TTL_MS) {
    return _profileFallbackCache.rows;
  }

  const rows: Array<{ phone: string; profile: ExecutiveProfile }> = [];
  for (const entry of EXECUTIVE_PROFILE_EMAILS) {
    const { data, error } = await supabase
      .from("profiles")
      .select("phone")
      .eq("email", entry.email)
      .maybeSingle();
    if (error) {
      console.warn(`[executiveIdentity] profile fallback lookup failed (${entry.email}):`, error.message);
      continue;
    }
    const phone = ((data as Record<string, unknown> | null)?.phone as string | undefined) ?? null;
    if (phone) rows.push({ phone, profile: entry.profile });
  }

  _profileFallbackCache = { rows, at: now };
  return rows;
}

/** Resolve inbound phone to executive profile, or null when not authorized. */
export async function resolveExecutiveInbound(
  phoneDigits: string,
  supabase?: SupabaseClient,
): Promise<ExecutiveProfile | null> {
  const inbound = normalizeExecutivePhoneDigits(phoneDigits);
  if (!inbound) return null;

  const known = KNOWN_EXECUTIVES[inbound];
  if (known) return known;

  for (const profile of profileFromEnvPhones()) {
    if (profile.phoneDigits === inbound) return profile;
  }

  if (!supabase) return null;

  const profileRows = await fetchExecutiveProfileRows(supabase);
  for (const row of profileRows) {
    if (matchesStoredPhone(row.phone, inbound)) return row.profile;
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
