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

export const PREMIUM_DAY_ROOMS = ["Premium Day 1", "Premium Day 2"];

/** Strip Hebrew "סוויטת" prefix for brand matching against registry names. */
function _suiteBrandKey(name) {
  return String(name ?? "").trim().replace(/^סוויטת\s+/i, "");
}

/**
 * Resolve EZGO roomName ("8") + suiteType ("סוויטת אמטיסט") to a canonical
 * SUITE_REGISTRY / Premium Day value for grid prefill + sync + DB-match.
 * Returns "" when ambiguous — staff must pick (Fail Visible).
 */
export function resolveSuiteFromEzgoFields(roomName, suiteType, isDayGuest = false) {
  const rn = String(roomName ?? "").trim();
  const st = String(suiteType ?? "").trim();

  if (isDayGuest || /premium\s*day|day\s*guest|בילוי.*יומי/i.test(st)) {
    if (/premium\s*day\s*2|פרימיום.*2|day\s*2/i.test(st)) return "Premium Day 2";
    if (/premium\s*day|פרימיום|day\s*guest|בילוי.*יומי/i.test(st)) return "Premium Day 1";
    return "";
  }

  const num = rn.match(/\d+/)?.[0];
  if (num) {
    const byNum = SUITE_REGISTRY.filter((s) => s.endsWith(" " + num));
    if (byNum.length === 1) return byNum[0];
    if (st) {
      const brand = _suiteBrandKey(st);
      const narrowed = byNum.filter((s) => s.includes(brand) || brand.includes(s.replace(/ \d+$/, "")));
      if (narrowed.length === 1) return narrowed[0];
    }
  }

  if (st) {
    const brand = _suiteBrandKey(st);
    const byType = SUITE_REGISTRY.filter(
      (s) => s.includes(brand) || brand.includes(s.replace(/ \d+$/, "")),
    );
    if (byType.length === 1) return byType[0];
  }

  return "";
}

/**
 * Compare incoming CSV room vs stored guests.room without false conflicts
 * when one side is a bare number ("8") and the other is canonical ("אמטיסט 8").
 */
export function roomsCanonicallyMatch(incoming, stored) {
  const a = String(incoming ?? "").trim();
  const b = String(stored ?? "").trim();
  if (!a || !b) return true;
  if (a === b) return true;
  const numA = a.match(/(\d+)\s*$/)?.[1] ?? a.match(/^(\d+)$/)?.[1];
  const numB = b.match(/(\d+)\s*$/)?.[1];
  if (numA && numB && numA === numB) return true;
  const canonA = resolveSuiteFromEzgoFields(a, "", false) || a;
  const canonB = resolveSuiteFromEzgoFields(b, "", false) || b;
  if (canonA && canonB && canonA === canonB) return true;
  return false;
}
