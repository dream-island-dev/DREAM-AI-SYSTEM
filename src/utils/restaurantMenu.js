// Restaurant menu helpers — published menu for waiters, draft for admin.

import { supabase } from "../supabaseClient";

export async function fetchPublishedRestaurantMenu() {
  if (!supabase) return { menu: null, error: "no_client" };

  const { data: version, error: verErr } = await supabase
    .from("restaurant_menu_versions")
    .select("id, label, published_at")
    .eq("status", "published")
    .maybeSingle();

  if (verErr) return { menu: null, error: verErr.message };
  if (!version) return { menu: null, error: null };

  const { data: sections, error: secErr } = await supabase
    .from("restaurant_menu_sections")
    .select("id, name, sort_order")
    .eq("version_id", version.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (secErr) return { menu: null, error: secErr.message };

  const sectionIds = (sections ?? []).map((s) => s.id);
  let items = [];
  if (sectionIds.length) {
    const { data: itemRows, error: itemErr } = await supabase
      .from("restaurant_menu_items")
      .select("id, section_id, name, description, price, course, allergens, tags, sort_order")
      .in("section_id", sectionIds)
      .eq("is_available", true)
      .order("sort_order", { ascending: true });
    if (itemErr) return { menu: null, error: itemErr.message };
    items = itemRows ?? [];
  }

  const bySection = {};
  for (const item of items) {
    if (!bySection[item.section_id]) bySection[item.section_id] = [];
    bySection[item.section_id].push(item);
  }

  return {
    menu: {
      version_id: version.id,
      label: version.label,
      sections: (sections ?? []).map((s) => ({
        ...s,
        items: bySection[s.id] ?? [],
      })),
    },
    error: null,
  };
}

export async function fetchDraftRestaurantMenuVersion() {
  if (!supabase) return { version: null, sections: [], error: "no_client" };

  let { data: version, error: verErr } = await supabase
    .from("restaurant_menu_versions")
    .select("id, label, status")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (verErr) return { version: null, sections: [], error: verErr.message };

  if (!version) {
    const { data: created, error: createErr } = await supabase
      .from("restaurant_menu_versions")
      .insert({ label: "תפריט — טיוטה", status: "draft" })
      .select("id, label, status")
      .maybeSingle();
    if (createErr) return { version: null, sections: [], error: createErr.message };
    version = created;
    await supabase.from("restaurant_menu_sections").insert({
      version_id: version.id,
      name: "עיקריות",
      sort_order: 10,
    });
  }

  const { data: sections, error: secErr } = await supabase
    .from("restaurant_menu_sections")
    .select("id, name, sort_order, is_active")
    .eq("version_id", version.id)
    .order("sort_order", { ascending: true });

  if (secErr) return { version, sections: [], error: secErr.message };

  const sectionIds = (sections ?? []).map((s) => s.id);
  let items = [];
  if (sectionIds.length) {
    const { data: itemRows, error: itemErr } = await supabase
      .from("restaurant_menu_items")
      .select("*")
      .in("section_id", sectionIds)
      .order("sort_order", { ascending: true });
    if (itemErr) return { version, sections: sections ?? [], error: itemErr.message };
    items = itemRows ?? [];
  }

  const bySection = {};
  for (const item of items) {
    if (!bySection[item.section_id]) bySection[item.section_id] = [];
    bySection[item.section_id].push(item);
  }

  return {
    version,
    sections: (sections ?? []).map((s) => ({
      ...s,
      items: bySection[s.id] ?? [],
    })),
    error: null,
  };
}

export async function publishRestaurantDraft(versionId, userId) {
  if (!supabase) throw new Error("no_client");

  await supabase
    .from("restaurant_menu_versions")
    .update({ status: "archived" })
    .eq("status", "published");

  const { error } = await supabase
    .from("restaurant_menu_versions")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: userId ?? null,
    })
    .eq("id", versionId);

  if (error) throw new Error(error.message);
}

export const MEAL_PERIOD_LABELS = {
  lunch: "צהריים",
  dinner: "ערב",
  other: "אחר",
};

export const ORDER_STATUS_LABELS = {
  submitted: "חדש",
  in_kitchen: "בהכנה",
  ready: "מוכן",
  served: "נמסר",
  cancelled: "בוטל",
};
