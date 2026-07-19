// AI menu import helpers — normalize Gemini output + apply to draft version.

import { supabase } from "../supabaseClient";
import { ARMONIM_EXTERNAL_MENU_URL } from "./restaurantKioskUi";

const VALID_COURSES = new Set(["starter", "main", "dessert", "drink", "kids", "side", "other"]);

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

export async function extractDocxText(arrayBuffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export const MENU_IMPORT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx";

export const MENU_IMPORT_MIME = {
  "application/pdf": { isText: false },
  "image/png": { isText: false },
  "image/jpeg": { isText: false },
  "image/jpg": { isText: false },
  "image/webp": { isText: false },
  "text/plain": { isText: true },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { isText: true },
};

export function normalizeParsedMenuSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((sec, si) => {
      const name = String(sec?.name ?? "").trim();
      if (!name) return null;
      const items = (Array.isArray(sec?.items) ? sec.items : [])
        .map((item, ii) => {
          const itemName = String(item?.name ?? "").trim();
          if (!itemName) return null;
          const priceRaw = item?.price;
          const price = priceRaw != null && priceRaw !== "" && !Number.isNaN(Number(priceRaw))
            ? Number(priceRaw)
            : null;
          const course = VALID_COURSES.has(item?.course) ? item.course : "main";
          return {
            name: itemName,
            description: String(item?.description ?? "").trim() || null,
            price,
            course,
            allergens: Array.isArray(item?.allergens)
              ? item.allergens.map((a) => String(a).trim()).filter(Boolean)
              : [],
            tags: Array.isArray(item?.tags)
              ? item.tags.map((t) => String(t).trim()).filter(Boolean)
              : [],
            sort_order: (ii + 1) * 10,
          };
        })
        .filter(Boolean);
      if (!items.length) return null;
      return { name, sort_order: (si + 1) * 10, items };
    })
    .filter(Boolean);
}

export async function invokeRestaurantMenuImport(payload) {
  if (!supabase) throw new Error("לא מחובר");
  const { data, error } = await supabase.functions.invoke("restaurant-menu-import", {
    body: payload,
  });
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error ?? "שגיאה בניתוח התפריט");
  return data;
}

export async function syncMenuFromWebsite(menuKind = "standard") {
  return invokeRestaurantMenuImport({
    mode: "website",
    menu_kind: menuKind,
    website_url: ARMONIM_EXTERNAL_MENU_URL,
  });
}

export async function ensureDraftForImport(menuKind = "standard") {
  if (!supabase) throw new Error("לא מחובר");

  const label = menuKind === "special"
    ? `תפריט ספיישל — ${new Date().toLocaleDateString("he-IL")}`
    : "תפריט ערמונים";

  let { data: version, error: verErr } = await supabase
    .from("restaurant_menu_versions")
    .select("id, label, status")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (verErr) throw new Error(verErr.message);

  if (!version) {
    const { data: created, error: createErr } = await supabase
      .from("restaurant_menu_versions")
      .insert({ label, status: "draft" })
      .select("id, label, status")
      .maybeSingle();
    if (createErr) throw new Error(createErr.message);
    version = created;
  } else {
    const { error: updErr } = await supabase
      .from("restaurant_menu_versions")
      .update({ label })
      .eq("id", version.id);
    if (updErr) throw new Error(updErr.message);
    version = { ...version, label };
  }

  return version;
}

export async function replaceDraftMenuContent(versionId, sections) {
  if (!supabase) throw new Error("לא מחובר");
  const normalized = normalizeParsedMenuSections(sections);
  if (!normalized.length) throw new Error("אין מנות לייבוא");

  const { error: delErr } = await supabase
    .from("restaurant_menu_sections")
    .delete()
    .eq("version_id", versionId);
  if (delErr) throw new Error(delErr.message);

  for (const sec of normalized) {
    const { data: secRow, error: secErr } = await supabase
      .from("restaurant_menu_sections")
      .insert({
        version_id: versionId,
        name: sec.name,
        sort_order: sec.sort_order,
        is_active: true,
      })
      .select("id")
      .maybeSingle();
    if (secErr) throw new Error(secErr.message);
    if (!secRow?.id) throw new Error("שגיאה ביצירת קטגוריה");

    const rows = sec.items.map((item) => ({
      section_id: secRow.id,
      name: item.name,
      description: item.description,
      price: item.price,
      course: item.course,
      allergens: item.allergens,
      tags: item.tags,
      sort_order: item.sort_order,
      is_available: true,
    }));

    const { error: itemErr } = await supabase.from("restaurant_menu_items").insert(rows);
    if (itemErr) throw new Error(itemErr.message);
  }

  const itemCount = normalized.reduce((n, s) => n + s.items.length, 0);
  return { sections: normalized.length, items: itemCount };
}
