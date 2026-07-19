// Validate KDS magic-link token (service role).

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidToken(token: string): boolean {
  return UUID_RE.test(token);
}

export async function assertActiveKdsToken(
  supabase: SupabaseClient,
  token: string,
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  if (!isUuidToken(token)) {
    return { ok: false, error: "link_not_found" };
  }
  const { data, error } = await supabase
    .from("restaurant_kds_tokens")
    .select("id, label")
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return { ok: false, error: "lookup_error" };
  if (!data) return { ok: false, error: "link_not_found" };
  return { ok: true, label: data.label as string };
}
