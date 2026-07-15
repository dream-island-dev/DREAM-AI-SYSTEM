// supabase/functions/_shared/staffNotifyTemplates.ts
// DB-editable shells for Adir / Eliad staff notifications (staff_message_templates).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const STAFF_TEMPLATE_CACHE_TTL_MS = 5 * 60_000;

export const STAFF_TEMPLATE_KEYS = {
  ADIR_MORNING_BRIEF: "adir_morning_brief",
  ADIR_ONBOARDING: "adir_onboarding",
  ADIR_ARRIVAL_ETA: "adir_arrival_eta",
  ADIR_GUEST_ALERT_SLA: "adir_guest_alert_sla",
  ADIR_PRE_CHECKIN: "adir_pre_checkin_request",
  ADIR_PORTAL_ORDER: "adir_portal_order",
  ADIR_INVENTORY: "adir_inventory_submit",
  ADIR_SOFT_HANDOFF: "adir_soft_handoff",
  ELIAD_DIGEST_SHELL: "eliad_digest_shell",
} as const;

export type StaffTemplateKey = typeof STAFF_TEMPLATE_KEYS[keyof typeof STAFF_TEMPLATE_KEYS];

export type StaffTemplateRow = {
  template_key: string;
  recipient_role: "front_desk" | "executive";
  category: "scheduled" | "event" | "digest_shell";
  display_name_he: string;
  channel_hint: string | null;
  message_text: string | null;
  digest_config: Record<string, string> | null;
  is_active: boolean;
  sort_order: number;
};

export type StaffTemplateMap = Map<string, StaffTemplateRow>;

let _cache: StaffTemplateMap = new Map();
let _cacheAt = 0;

/** Replace {{key}} placeholders; unknown keys become empty string. */
export function applyStaffMessageTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    return String(v);
  }).replace(/\n{3,}/g, "\n\n").trim();
}

/** Shallow merge digest_config overrides onto code defaults. */
export function mergeDigestConfig(
  defaults: Record<string, string>,
  override: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!override) return { ...defaults };
  const out = { ...defaults };
  for (const [k, v] of Object.entries(override)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function resolveStaffTemplate(
  map: StaffTemplateMap | undefined,
  key: string,
): StaffTemplateRow | undefined {
  const row = map?.get(key);
  if (!row || !row.is_active) return undefined;
  return row;
}

/** If DB has custom message_text — apply vars; else return null (caller uses code default). */
export function composeFromStaffTemplate(
  map: StaffTemplateMap | undefined,
  key: string,
  vars: Record<string, string | number | null | undefined>,
): string | null {
  const row = resolveStaffTemplate(map, key);
  const text = row?.message_text?.trim();
  if (!text) return null;
  return applyStaffMessageTemplate(text, vars);
}

export async function loadStaffNotifyTemplates(
  supabase: SupabaseClient,
  force = false,
): Promise<StaffTemplateMap> {
  const now = Date.now();
  if (!force && now - _cacheAt < STAFF_TEMPLATE_CACHE_TTL_MS && _cache.size > 0) {
    return _cache;
  }
  const { data, error } = await supabase
    .from("staff_message_templates")
    .select("template_key, recipient_role, category, display_name_he, channel_hint, message_text, digest_config, is_active, sort_order");
  if (error) {
    console.warn("[staffNotifyTemplates] load failed:", error.message);
    return _cache;
  }
  const map: StaffTemplateMap = new Map();
  for (const row of data ?? []) {
    const digest = row.digest_config;
    map.set(row.template_key, {
      template_key: row.template_key,
      recipient_role: row.recipient_role,
      category: row.category,
      display_name_he: row.display_name_he,
      channel_hint: row.channel_hint ?? null,
      message_text: row.message_text ?? null,
      digest_config: digest && typeof digest === "object" && !Array.isArray(digest)
        ? digest as Record<string, string>
        : null,
      is_active: row.is_active !== false,
      sort_order: row.sort_order ?? 0,
    });
  }
  _cache = map;
  _cacheAt = now;
  return map;
}

export function invalidateStaffTemplateCache(): void {
  _cacheAt = 0;
  _cache = new Map();
}

/** Merge unsaved draft into a template map for live preview. */
export function buildPreviewTemplateMap(
  base: StaffTemplateMap,
  key: string,
  draft: {
    message_text?: string | null;
    digest_config?: Record<string, string> | null;
  },
): StaffTemplateMap {
  const map = new Map(base);
  const existing = map.get(key);
  if (!existing && !draft.message_text && !draft.digest_config) return map;
  map.set(key, {
    template_key: key,
    recipient_role: existing?.recipient_role ?? "front_desk",
    category: existing?.category ?? "event",
    display_name_he: existing?.display_name_he ?? key,
    channel_hint: existing?.channel_hint ?? null,
    message_text: draft.message_text !== undefined ? draft.message_text : (existing?.message_text ?? null),
    digest_config: draft.digest_config !== undefined ? draft.digest_config : (existing?.digest_config ?? null),
    is_active: true,
    sort_order: existing?.sort_order ?? 0,
  });
  return map;
}

/** Default digest_config keys for Adir morning brief (editable sections only). */
export const ADIR_MORNING_BRIEF_DEFAULTS: Record<string, string> = {
  greeting: "בוקר טוב אדיר 🌅",
  title: "עוזרת דלפק הסוויטות — סיכום להיום ({{date_he}})",
  snapshot: "📊 במבט: {{today_total}} הגעות היום | {{missing_time}} בלי שעה | {{open_summary}}",
  eta_note: "🕐 {{eta_count}} שעות הגעה רשומות בלוח",
  tomorrow_note: "📅 מחר: {{tomorrow_total}} הגעות",
  missing_time_cta:
    'רוצה שאשלח הודעה קצרה לבקש שעת הגעה מ-{{missing_time}} האורחים שעדיין בלי שעה? רק תגיד לי "כן, תשלחי".',
  open_header: "🔔 בקשות פתוחות (לטיפול):",
  power_hints:
    "💪 מה אתה יכול לבקש ממני (קול או טקסט):\n• «לוח הגעות» / «מי בלי שעה?»\n• «טיפלתי בבקשת חדר 7»\n• «חדר 5 מוכן»\nשעות הגעה מאורחים מגיעות אליך אוטומטית 🕐",
};

/** Default digest_config keys for Eliad resort digest shell. */
export const ELIAD_DIGEST_SHELL_DEFAULTS: Record<string, string> = {
  opening_line: "📋 {{name}}, כאן העוזרת האישית שלך",
  period_line: "דוח תפעולי {{period_he}} — {{period_label}}",
  sla_label: "עמידה ביעדי זמן הטיפול",
  footer_1: "רוצה לשנות משהו בדוחות? כתוב לי «תזכרי ש…» — אשמור להבא.",
  footer_2: "לעדכון חי: «מה מצב הריזורט?» או «תן לי דוח יומי עכשיו».",
  action_hint_quiet: "👉 מצב שקט — אין פעולה דחופה מהדוח. שאל אותי «מה מצב הריזורט?» לעדכון חי.",
};
