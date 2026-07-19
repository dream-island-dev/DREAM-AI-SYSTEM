// Local persistence for active Armonim floor shift (pairs with restaurant_shift_sessions row).

const STORAGE_KEY = "armonim_shift_session_v1";

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
