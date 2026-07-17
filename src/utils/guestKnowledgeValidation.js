// src/utils/guestKnowledgeValidation.js
// Mirrors supabase/functions/_shared/guestKnowledgeValidation.ts for BotSettings UI.

const HOUR_KEYS = [
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

function normalizeHourToken(s) {
  return s.replace(/\s+/g, "").replace(/–/g, "-").trim();
}

function extractKbValue(kb, patterns) {
  for (const re of patterns) {
    const m = kb.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

export function detectKnowledgeConflicts(botConfig, knowledgeBase) {
  const kb = (knowledgeBase ?? "").trim();
  if (!kb) return [];

  const conflicts = [];
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

export function formatKnowledgeConflictWarning(conflicts) {
  if (!conflicts.length) return "";
  return conflicts.map((c) => c.message).join("\n");
}

export const HOUR_CONFIG_KEYS = HOUR_KEYS.map((h) => h.configKey);
