// src/utils/guestFacilityMeta.js
// Facility review labels — aligned with guest_surveys categories + extras.

export const FACILITY_FILTER_ORDER = Object.freeze([
  { id: "all", label: "הכל" },
  { id: "restaurant", label: "🍽️ מסעדה", highlight: true },
  { id: "live_kitchen", label: "👨‍🍳 מטבח חי" },
  { id: "patio", label: "🌿 פטיו" },
  { id: "spa", label: "💆 ספא" },
  { id: "pool", label: "🏊 בריכה" },
  { id: "bar", label: "🍸 בר" },
  { id: "service", label: "🤝 שירות" },
  { id: "cleaning", label: "🧹 ניקיון" },
  { id: "general", label: "📍 כללי" },
]);

const FACILITY_LABEL = Object.freeze({
  restaurant: "🍽️ מסעדה",
  live_kitchen: "👨‍🍳 מטבח חי",
  patio: "🌿 פטיו",
  spa: "💆 ספא",
  pool: "🏊 בריכה",
  bar: "🍸 בר",
  cleaning: "🧹 ניקיון",
  service: "🤝 שירות",
  general: "📍 כללי",
});

export function facilityLabel(category) {
  if (!category) return null;
  return FACILITY_LABEL[category] ?? `⚠ ${category}`;
}

export function averageRating(rows) {
  const vals = (rows || [])
    .map((r) => Number(r.rating))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 10);
  if (!vals.length) return null;
  return Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 10) / 10;
}
