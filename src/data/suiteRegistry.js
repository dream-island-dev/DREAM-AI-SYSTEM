// src/data/suiteRegistry.js
// Single source of truth for the 26 physical suites at Dream Island Resort.
// Used by: ArrivalImportPanel (room dropdown), GuestsPage (room dropdown),
// RoomBoard (board layout), AICopilot (alert lookup).

export const SUITE_REGISTRY = [
  "ג׳ספר 1",  "ג׳ספר 2",  "ג׳ספר 3",  "ג׳ספר 4",  "ג׳ספר 5",  "ג׳ספר 6",
  "אוניקס 7",  "אמטיסט 8",  "אמטיסט 9",  "אמטיסט 10", "אמטיסט 11", "אוניקס 12",
  "רובי 13",   "רובי 14",   "רובי 15",   "רובי 16",
  "אמרלד 17",  "אמרלד 18",  "אמרלד 19",  "אמרלד 20",
  "אקווה מרין 21", "אקווה מרין 22", "אקווה מרין 23",
  "אקווה מרין 24", "אקווה מרין 25", "אקווה מרין 26",
];

// Groupings for the SuiteBoard section headers.
// `prefix` lists every brand-name prefix that belongs to this section.
export const SUITE_SECTIONS = [
  { label: "ג׳ספר",          icon: "🌿", prefix: ["ג׳ספר"],                      color: "#6B4F2E" },
  { label: "אוניקס & אמטיסט", icon: "💜", prefix: ["אוניקס", "אמטיסט"],           color: "#4A3A6A" },
  { label: "רובי",            icon: "❤️", prefix: ["רובי"],                       color: "#8A1A1A" },
  { label: "אמרלד",           icon: "💚", prefix: ["אמרלד"],                      color: "#1A5A2A" },
  { label: "אקווה מרין",      icon: "💙", prefix: ["אקווה מרין"],                 color: "#1A4070" },
];

// Returns the SUITE_SECTIONS entry for a given suite name, or null if unrecognised.
export function getSuiteSection(suiteName) {
  if (!suiteName) return null;
  return SUITE_SECTIONS.find(sec =>
    sec.prefix.some(p => suiteName.startsWith(p))
  ) ?? null;
}
