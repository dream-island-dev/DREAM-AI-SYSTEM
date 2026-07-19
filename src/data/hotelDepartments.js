// Canonical hotel department labels — single source for onboarding, admin, ops UI.

export const RESTAURANT_DEPARTMENT = "מסעדה";

/** Legacy label kept for existing profiles and localStorage lists. */
export const LEGACY_FB_DEPARTMENT = 'מזמ"ש (F&B)';

/** Onboarding + ops task routing (no סוויטות). */
export const ONBOARDING_DEPARTMENTS = [
  "תפעול",
  "משק",
  "קבלה",
  "ספא",
  RESTAURANT_DEPARTMENT,
  "הנהלה",
];

/** Full list for employee management + checklist config. */
export const DEFAULT_DEPARTMENTS = [
  ...ONBOARDING_DEPARTMENTS,
  "סוויטות",
];

export function isRestaurantDepartment(dept) {
  if (!dept) return false;
  const t = String(dept).trim();
  return t === RESTAURANT_DEPARTMENT || t === LEGACY_FB_DEPARTMENT;
}

/** Display label — maps legacy F&B to מסעדה. */
export function normalizeDepartmentLabel(dept) {
  if (!dept) return dept;
  return dept === LEGACY_FB_DEPARTMENT ? RESTAURANT_DEPARTMENT : dept;
}

export const DEPARTMENT_ICONS = {
  תפעול: "🔧",
  משק: "🧹",
  קבלה: "🛎️",
  ספא: "💆",
  [RESTAURANT_DEPARTMENT]: "🍽️",
  [LEGACY_FB_DEPARTMENT]: "🍽️",
  הנהלה: "🏢",
  סוויטות: "🏨",
};

export const DEPARTMENT_COLORS = {
  קבלה: "#378ADD",
  ספא: "#639922",
  תפעול: "#BA7517",
  משק: "#888780",
  הנהלה: "#C9A96E",
  [RESTAURANT_DEPARTMENT]: "#E24B4A",
  [LEGACY_FB_DEPARTMENT]: "#E24B4A",
  סוויטות: "#9B59B6",
};
