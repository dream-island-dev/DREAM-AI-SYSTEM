// Restaurant menu helpers — published menu for waiters, draft for admin.

import { supabase } from "../supabaseClient";

export const MENU_KIND_LABELS = {
  standard: "תפריט רגיל",
  special: "תפריט ספיישל",
};

/** @typedef {'standard' | 'special'} RestaurantMenuKind */

export async function fetchPublishedMenuKinds() {
  if (!supabase) return { kinds: [], error: "no_client" };

  const { data, error } = await supabase
    .from("restaurant_menu_versions")
    .select("menu_kind")
    .eq("status", "published");

  if (error) return { kinds: [], error: error.message };

  const kinds = [...new Set((data ?? []).map((r) => r.menu_kind).filter(Boolean))];
  kinds.sort((a, b) => (a === "standard" ? -1 : b === "standard" ? 1 : 0));
  return { kinds, error: null };
}

export async function fetchPublishedRestaurantMenu(menuKind = "standard") {
  if (!supabase) return { menu: null, error: "no_client" };

  const { data: version, error: verErr } = await supabase
    .from("restaurant_menu_versions")
    .select("id, label, published_at, menu_kind")
    .eq("status", "published")
    .eq("menu_kind", menuKind)
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
      menu_kind: version.menu_kind ?? menuKind,
      sections: (sections ?? []).map((s) => ({
        ...s,
        items: bySection[s.id] ?? [],
      })),
    },
    error: null,
  };
}

export async function fetchDraftRestaurantMenuVersion(menuKind = "standard") {
  if (!supabase) return { version: null, sections: [], error: "no_client" };

  let { data: version, error: verErr } = await supabase
    .from("restaurant_menu_versions")
    .select("id, label, status, menu_kind")
    .eq("status", "draft")
    .eq("menu_kind", menuKind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (verErr) return { version: null, sections: [], error: verErr.message };

  if (!version) {
    const label = menuKind === "special"
      ? `תפריט ספיישל — טיוטה`
      : "תפריט ערמונים — טיוטה";
    const { data: created, error: createErr } = await supabase
      .from("restaurant_menu_versions")
      .insert({ label, status: "draft", menu_kind: menuKind })
      .select("id, label, status, menu_kind")
      .maybeSingle();
    if (createErr) return { version: null, sections: [], error: createErr.message };
    version = created;

    // Editing a menu that only exists as published (e.g. the seeded standard menu) —
    // clone its current content into the new draft so admins edit real data, not a blank slate.
    const { data: published } = await supabase
      .from("restaurant_menu_versions")
      .select("id")
      .eq("status", "published")
      .eq("menu_kind", menuKind)
      .maybeSingle();

    if (published?.id) {
      const { data: pubSections } = await supabase
        .from("restaurant_menu_sections")
        .select("id, name, sort_order, is_active")
        .eq("version_id", published.id)
        .order("sort_order", { ascending: true });

      for (const sec of pubSections ?? []) {
        const { data: newSec } = await supabase
          .from("restaurant_menu_sections")
          .insert({ version_id: version.id, name: sec.name, sort_order: sec.sort_order, is_active: sec.is_active })
          .select("id")
          .maybeSingle();
        if (!newSec?.id) continue;

        const { data: pubItems } = await supabase
          .from("restaurant_menu_items")
          .select("name, description, price, course, allergens, tags, is_available, sort_order")
          .eq("section_id", sec.id);

        if (pubItems?.length) {
          await supabase.from("restaurant_menu_items").insert(
            pubItems.map((i) => ({ ...i, section_id: newSec.id })),
          );
        }
      }
    } else {
      await supabase.from("restaurant_menu_sections").insert({
        version_id: version.id,
        name: "עיקריות",
        sort_order: 10,
      });
    }
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

export async function publishRestaurantDraft(versionId, userId, menuKind = "standard") {
  if (!supabase) throw new Error("no_client");

  await supabase
    .from("restaurant_menu_versions")
    .update({ status: "archived" })
    .eq("status", "published")
    .eq("menu_kind", menuKind);

  const { error } = await supabase
    .from("restaurant_menu_versions")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: userId ?? null,
      menu_kind: menuKind,
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
