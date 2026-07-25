// Orit CS staff phone lookup (shared — avoid circular imports).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

async function staffPhoneMatchesMailbox(
  supabase: SupabaseClient,
  digits: string,
  mb: { digest_whatsapp_phone?: string | null; profile_id?: string | null },
): Promise<boolean> {
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
  return false;
}

/** Active mailbox for Orit staff Whapi DM (digest phone or profile phone). */
export async function resolveOritMailboxForStaffPhone(
  supabase: SupabaseClient,
  phoneDigits: string,
): Promise<string | null> {
  const digits = phoneDigits.replace(/\D/g, "");
  if (!digits) return null;

  const { data: mailboxes } = await supabase
    .from("orit_agent_mailbox")
    .select("id, digest_whatsapp_phone, profile_id")
    .eq("connection_status", "active");

  for (const mb of mailboxes ?? []) {
    if (await staffPhoneMatchesMailbox(supabase, digits, mb)) {
      return String(mb.id);
    }
  }
  return null;
}

export async function isOritCsStaffPhone(
  supabase: SupabaseClient,
  phoneDigits: string,
): Promise<boolean> {
  return Boolean(await resolveOritMailboxForStaffPhone(supabase, phoneDigits));
}
