// Gate manual whatsapp-send triggers (inbox_reply, broadcast, …) by staff profile.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type StaffProfileRow = {
  role?: string | null;
  status?: string | null;
  restaurant_access?: boolean | null;
};

/** Kiosk restaurant staff — לוח מסעדה בלבד; WA רק דרך inbox_reply. */
export function isRestaurantKioskStaff(profile: StaffProfileRow | null | undefined): boolean {
  if (!profile) return false;
  if (profile.role === "restaurant") return true;
  return profile.role === "staff" && profile.restaurant_access === true;
}

/** Whether this profile may invoke a manual whatsapp-send trigger. */
export function canUseManualWhatsappTrigger(
  trigger: string,
  profile: StaffProfileRow | null | undefined,
): boolean {
  if (!profile || profile.status === "suspended") return false;
  if (profile.role === "cleaner") return false;

  if (isRestaurantKioskStaff(profile)) {
    return trigger === "inbox_reply";
  }

  return true;
}

export async function loadStaffProfileForRequest(
  req: Request,
  serviceSupabase: SupabaseClient,
): Promise<{ userId: string; profile: StaffProfileRow } | { error: string; status: number }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "unauthorized", status: 401 };

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !user) return { error: "unauthorized", status: 401 };

  const { data: profile, error: profErr } = await serviceSupabase
    .from("profiles")
    .select("role, status, restaurant_access")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile) return { error: "forbidden", status: 403 };

  return { userId: user.id, profile };
}

export async function assertStaffManualWhatsappTrigger(
  req: Request,
  trigger: string,
  serviceSupabase: SupabaseClient,
): Promise<Response | null> {
  const loaded = await loadStaffProfileForRequest(req, serviceSupabase);
  if ("error" in loaded) {
    return new Response(
      JSON.stringify({ ok: false, error: loaded.error }),
      { status: loaded.status, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!canUseManualWhatsappTrigger(trigger, loaded.profile)) {
    const msg = isRestaurantKioskStaff(loaded.profile)
      ? "forbidden: restaurant staff may only send guest messages from the restaurant board"
      : "forbidden";
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null;
}
