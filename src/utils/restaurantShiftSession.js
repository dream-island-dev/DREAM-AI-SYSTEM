// Local persistence for active Armonim floor shift (pairs with restaurant_shift_sessions row).

const STORAGE_KEY = "armonim_shift_session_v1";
const RECENT_NAMES_KEY = "armonim_shift_recent_names_v1";
const RECENT_NAMES_MAX = 8;

/** Seed roster labels — not useful as quick-pick buttons; type a real name instead. */
const GENERIC_ROSTER_RE = /^מלצר(?:\/ית)?\s*\d+$/i;

export function isGenericRosterPlaceholder(name) {
  const t = String(name ?? "").trim();
  if (!t) return true;
  if (GENERIC_ROSTER_RE.test(t)) return true;
  if (t === "מנהל משמרת") return true;
  return false;
}

/** @returns {string[]} */
export function readRecentShiftNames() {
  try {
    const raw = localStorage.getItem(RECENT_NAMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((n) => String(n ?? "").trim())
      .filter((n) => n && !isGenericRosterPlaceholder(n))
      .slice(0, RECENT_NAMES_MAX);
  } catch {
    return [];
  }
}

/** @param {string} name */
export function rememberRecentShiftName(name) {
  const t = String(name ?? "").trim();
  if (!t || isGenericRosterPlaceholder(t)) return;
  const prev = readRecentShiftNames().filter((n) => n !== t);
  const next = [t, ...prev].slice(0, RECENT_NAMES_MAX);
  localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(next));
}

/** @typedef {'waiter' | 'shift_manager'} RestaurantSessionRole */

/**
 * @typedef {Object} LocalShiftSession
 * @property {string} sessionId
 * @property {string} displayName
 * @property {RestaurantSessionRole} sessionRole
 * @property {string} startedAt
 * @property {string|null} [staffId]
 */

/** @returns {LocalShiftSession|null} */
export function readLocalShiftSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sessionId || !parsed?.displayName) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** @param {LocalShiftSession|null} session */
export function writeLocalShiftSession(session) {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function sessionRoleLabel(role) {
  return role === "shift_manager" ? "מנהל משמרת" : "מלצר/ית";
}

export function formatShiftStartedAt(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
