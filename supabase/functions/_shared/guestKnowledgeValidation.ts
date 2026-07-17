// supabase/functions/_shared/guestKnowledgeValidation.ts
// Single-source knowledge checks — detect contradictions between bot_config and KB.

export type KnowledgeConflict = {
  field: string;
  configValue: string;
  kbValue: string;
  message: string;
};

const HOUR_KEYS: Array<{ configKey: string; label: string; kbPatterns: RegExp[] }> = [
  {
    configKey: "hotel_checkin_time",
    label: "צ'ק-אין",
    kbPatterns: [/צ['']?ק[- ]?אין[^:\n]*[:：]\s*(\d{1,2}:\d{2})/i, /check[- ]?in[^:\n]*[:：]\s*(\d{1,2}:\d{2})/i],
  },
  {
    configKey: "hotel_checkout_time",
    label: "צ'ק-אאוט",
    kbPatterns: [/צ['']?ק[- ]?אאוט[^:\n]*[:：]\s*(\d{1,2}:\d{2})/i, /check[- ]?out[^:\n]*[:：]\s*(\d{1,2}:\d{2})/i],
  },
  {
    configKey: "hotel_pool_hours",
    label: "בריכה",
    kbPatterns: [/בריכ[^:\n]*[:：]\s*([^\n]+)/i],
  },
  {
    configKey: "hotel_spa_hours",
    label: "ספא",
    kbPatterns: [/ספא[^:\n]*[:：]\s*([^\n]+)/i],
  },
  {
    configKey: "hotel_restaurant_hours",
    label: "מסעדה",
    kbPatterns: [/מסעד[^:\n]*[:：]\s*([^\n]+)/i],
  },
];

function normalizeHourToken(s: string): string {
  return s.replace(/\s+/g, "").replace(/–/g, "-").trim();
}

function extractKbValue(kb: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = kb.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Compares structured bot_config hours against free-text knowledge_base.
 * Returns conflicts for BotSettings UI warning (FAIL VISIBLE).
 */
export function detectKnowledgeConflicts(
  botConfig: Record<string, string>,
  knowledgeBase: string,
): KnowledgeConflict[] {
  const kb = (knowledgeBase ?? "").trim();
  if (!kb) return [];

  const conflicts: KnowledgeConflict[] = [];
  for (const { configKey, label, kbPatterns } of HOUR_KEYS) {
    const configVal = (botConfig[configKey] ?? "").trim();
    if (!configVal) continue;
    const kbVal = extractKbValue(kb, kbPatterns);
    if (!kbVal) continue;
    if (normalizeHourToken(configVal) !== normalizeHourToken(kbVal)) {
      conflicts.push({
        field: configKey,
        configValue: configVal,
        kbValue: kbVal,
        message: `סתירה ב${label}: bot_config="${configVal}" מול knowledge_base="${kbVal}"`,
      });
    }
  }
  return conflicts;
}

/**
 * When bot_settings.knowledge_base is populated, prefer it for factual resort
 * hours in the LLM prompt — bot_config hours are injected only as fallback
 * via buildSystemPromptFromBotConfig when KB is empty.
 */
export function shouldUseConfigHoursInPrompt(knowledgeBase: string): boolean {
  return !(knowledgeBase ?? "").trim();
}

/** Appends conflict warning block for admin-facing logs (not sent to guests). */
export function formatKnowledgeConflictWarning(conflicts: KnowledgeConflict[]): string {
  if (!conflicts.length) return "";
  return "\n\n══ אזהרת סתירות ידע (פנימי — לא לאורח) ══\n"
    + conflicts.map((c) => `• ${c.message}`).join("\n")
    + "\nבמקרה של סתירה — עדיף knowledge_base על פני bot_config.";
}
