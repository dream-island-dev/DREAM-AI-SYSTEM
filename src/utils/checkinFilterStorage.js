// Shared צ'ק-אין / ניהול אורחים date filter — persists across tab switches in one session.

import { CHECKIN_TIMELINE_TODAY } from "./guestCheckinMatrix";

export const CHECKIN_FILTER_STORAGE_KEY = "xos_checkin_filter_v1";

export function loadCheckinFilter() {
  try {
    const raw = sessionStorage.getItem(CHECKIN_FILTER_STORAGE_KEY);
    if (!raw) {
      return { scope: CHECKIN_TIMELINE_TODAY, customDate: null };
    }
    const parsed = JSON.parse(raw);
    return {
      scope: parsed.scope || CHECKIN_TIMELINE_TODAY,
      customDate: parsed.customDate || null,
    };
  } catch {
    return { scope: CHECKIN_TIMELINE_TODAY, customDate: null };
  }
}

export function saveCheckinFilter({ scope, customDate }) {
  try {
    sessionStorage.setItem(
      CHECKIN_FILTER_STORAGE_KEY,
      JSON.stringify({
        scope: scope || CHECKIN_TIMELINE_TODAY,
        customDate: customDate || null,
      }),
    );
  } catch {
    /* quota / private mode — filter still works in-memory */
  }
}
