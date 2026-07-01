// src/utils/guestStatusMeta.js
// Single source of truth for guests.status display labels — used by
// GuestsPage.js and GuestDashboard.js so both surfaces show identical
// status badges (CLAUDE.md §0.5 Single Source of Truth).
export const STATUS_META = {
  pending:    { label: "טרם נקלט",  bg: "#F5F5F5", color: "#888888" },
  expected:   { label: "ממתין",     bg: "#FFF5E8", color: "#B5600A" },
  room_ready: { label: "חדר מוכן",  bg: "#E8F5EF", color: "#1A7A4A" },
  checked_in: { label: "צ'ק-אין",   bg: "#EEF4FF", color: "#2952A3" },
  cancelled:  { label: "❌ מבוטל",  bg: "#FFF0EE", color: "#C0392B" },
  checked_out: { label: "עזב",      bg: "#F0F0F0", color: "#666666" },
};
