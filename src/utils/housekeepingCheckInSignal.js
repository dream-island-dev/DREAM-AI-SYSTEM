/**
 * Mirrors supabase/functions/_shared/housekeepingCheckInSignal.ts (Deno boundary).
 */

export function buildHousekeepingCheckInAckLine(result) {
  const { roomId, guestName, action } = result ?? {};
  if (!roomId) return null;
  switch (action) {
    case "updated":
      return `✅ חדר ${roomId} — צ'ק-אין נקלט${guestName ? ` (${guestName})` : ""}`;
    case "already_checked_in":
      return `ℹ️ חדר ${roomId} — כבר מסומן כצ'ק-אין${guestName ? ` (${guestName})` : ""}`;
    case "no_guest":
      return `⚠️ חדר ${roomId} — צ'ק-אין: לא נמצא אורח פעיל בחדר`;
    case "guest_not_eligible":
      return `⚠️ חדר ${roomId} — אורח${guestName ? ` ${guestName}` : ""} לא במצב צ'ק-אין (סטטוס לא מתאים)`;
    default:
      return null;
  }
}
