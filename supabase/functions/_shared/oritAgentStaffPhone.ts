// Orit CS staff phone lookup (shared — avoid circular imports).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function isOritCsStaffPhone(
  supabase: SupabaseClient,
  phoneDigits: string,
): Promise<boolean> {
  const digits = phoneDigits.replace(/\D/g, "");
  if (!digits) return false;

  const { data: mailboxes } = await supabase
    .from("orit_agent_mailbox")
    .select("digest_whatsapp_phone, profile_id")
    .eq("connection_status", "active");

  for (const mb of mailboxes ?? []) {
    const fromMb = (mb.digest_whatsapp_phone ?? "").replace(/\D/g, "");
    if (fromMb && fromMb === digits) return true;

    if (mb.profile_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("id", mb.profile_id)
        .maybeSingle();
      const fromProfile = (profile?.phone ?? "").replace(/\D/g, "");
      if (fromProfile && fromProfile === digits) return true;
    }
  }
  return false;
}
