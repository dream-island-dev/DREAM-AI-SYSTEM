/**
 * Mirrors supabase/functions/_shared/oritAgentClassify.ts — keep in sync for UI.
 */

const GENERIC_LEAD_SUBJECT_RE = /התקבלה פניה מלידים|פניה מלידים|lead inquiry/i;

export function isGenericLeadFormSubject(subject) {
  return GENERIC_LEAD_SUBJECT_RE.test((subject || "").trim());
}

export const CATEGORY_META = {
  lead:      { label: "📥 ליד",    bg: "#DBEAFE", color: "#1D4ED8", tab: "leads" },
  booking:   { label: "📅 הזמנה",  bg: "#DBEAFE", color: "#1D4ED8", tab: "leads" },
  spa:       { label: "💆 ספא",    bg: "#E0E7FF", color: "#4338CA", tab: "leads" },
  complaint: { label: "😤 תלונה", bg: "#FEE2E2", color: "#B91C1C", tab: "complaints" },
  vendor:    { label: "🏢 ספק",   bg: "#F3F4F6", color: "#4B5563", tab: "other" },
  internal:  { label: "🏠 פנימי", bg: "#F3F4F6", color: "#4B5563", tab: "other" },
  other:     { label: "📋 אחר",   bg: "#F3F4F6", color: "#6B7280", tab: "other" },
};

export function categoryMeta(category) {
  return CATEGORY_META[category] ?? CATEGORY_META.other;
}

export const ORIT_CS_TABS = [
  { id: "all", label: "הכל" },
  { id: "leads", label: "לידים" },
  { id: "complaints", label: "תלונות" },
  { id: "other", label: "אחר" },
];

export function threadMatchesTab(thread, tabId) {
  if (tabId === "all") return true;
  const meta = categoryMeta(thread.category);
  return meta.tab === tabId;
}

export function threadDisplayTitle(thread) {
  if (thread.ai_summary) {
    const line = thread.ai_summary.split("\n")[0].trim();
    if (line.length > 12) {
      return line.length > 110 ? `${line.slice(0, 110)}…` : line;
    }
  }
  const cat = categoryMeta(thread.category);
  const who = thread.from_name || thread.from_email || "אורח";
  if (isGenericLeadFormSubject(thread.subject)) {
    return `${who} — ${cat.label}`;
  }
  return thread.subject || `${who} — ${cat.label}`;
}

export function buildQuickAckText(fromName) {
  const first = (fromName || "").trim().split(/\s+/)[0];
  const greeting = first && first.length > 1 ? `שלום ${first},` : "שלום,";
  return `${greeting}

קיבלנו את בקשתך, ניצור איתך קשר בהקדם.

בברכה,
דרים איילנד — אתר הנופש`;
}
