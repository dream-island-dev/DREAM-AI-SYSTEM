// Published restaurant menu for waiter tablet (authenticated via RLS on direct reads;
// this edge function also supports service-role consumers).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      authHeader ? { global: { headers: { Authorization: authHeader } } } : {},
    );

    const { data: version, error: verErr } = await supabase
      .from("restaurant_menu_versions")
      .select("id, label, published_at")
      .eq("status", "published")
      .maybeSingle();

    if (verErr) throw new Error(verErr.message);

    if (!version) {
      return new Response(
        JSON.stringify({ ok: true, menu: null, message: "no_published_menu" }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const { data: sections, error: secErr } = await supabase
      .from("restaurant_menu_sections")
      .select("id, name, sort_order")
      .eq("version_id", version.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (secErr) throw new Error(secErr.message);

    const sectionIds = (sections ?? []).map((s) => s.id);
    let items: Record<string, unknown>[] = [];
    if (sectionIds.length) {
      const { data: itemRows, error: itemErr } = await supabase
        .from("restaurant_menu_items")
        .select("id, section_id, name, description, price, course, allergens, tags, sort_order")
        .in("section_id", sectionIds)
        .eq("is_available", true)
        .order("sort_order", { ascending: true });
      if (itemErr) throw new Error(itemErr.message);
      items = itemRows ?? [];
    }

    const bySection: Record<string, unknown[]> = {};
    for (const item of items) {
      const sid = item.section_id as string;
      if (!bySection[sid]) bySection[sid] = [];
      bySection[sid].push(item);
    }

    const menu = {
      version_id: version.id,
      label: version.label,
      published_at: version.published_at,
      sections: (sections ?? []).map((s) => ({
        ...s,
        items: bySection[s.id as string] ?? [],
      })),
    };

    return new Response(
      JSON.stringify({ ok: true, menu }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restaurant-menu-data] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
