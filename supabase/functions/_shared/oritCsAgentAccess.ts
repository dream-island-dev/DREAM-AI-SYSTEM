// Orit CS Agent — access gate (profiles.orit_cs_agent_access from User Management).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function hasOritCsAgentAccess(
  profile: { orit_cs_agent_access?: boolean | null; role?: string | null } | null | undefined,
): boolean {
  if (profile?.role === "super_admin") return true;
  return profile?.orit_cs_agent_access === true;
}

export async function loadOritCsAgentAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("orit_cs_agent_access, role")
    .eq("id", userId)
    .maybeSingle();
  return hasOritCsAgentAccess(profile);
}
