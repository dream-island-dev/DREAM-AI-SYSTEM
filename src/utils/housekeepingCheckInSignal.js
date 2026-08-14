/**
 * Mirrors supabase/functions/_shared/housekeepingCheckInSignal.ts (Deno boundary).
 */

export const HOUSEKEEPING_CHECKIN_PROBLEM_ACTIONS = new Set([
  "skipped_no_suite", "no_guest", "ambiguous_guest", "guest_not_eligible", "error",
]);

export function buildHousekeepingCheckInAckLine(result) {
  const { roomNumber, roomId, guestName, action, previousGuestName } = result ?? {};
  if (action === "skipped_no_suite") {
    return `⚠️ מספר חדר #${roomNumber} לא מוכר במערכת — צ'ק-אין לא נקלט, בדקו את המספר`;
  }
  if (!roomId) return null;
  switch (action) {
    case "updated":
      if (previousGuestName?.trim()) {
        return `✅ חדר ${roomId} — צ'ק-אין נקלט (${guestName ?? "—"}) · יצא קודם: ${previousGuestName.trim()}`;
      }
      return `✅ חדר ${roomId} — צ'ק-אין נקלט${guestName ? ` (${guestName})` : ""}`;
    case "already_checked_in":
      return `ℹ️ חדר ${roomId} — כבר מסומן כצ'ק-אין${guestName ? ` (${guestName})` : ""}`;
    case "no_guest":
      return `⚠️ חדר ${roomId} — צ'ק-אין: לא נמצא אורח עם הגעה היום בחדר`;
    case "ambiguous_guest":
      return `⚠️ חדר ${roomId} — כמה אורחים מתאימים (תאריכים חופפים). בדקו ב-XOS וסמנו ידנית.${guestName ? ` (${guestName})` : ""}`;
    case "guest_not_eligible":
      return `⚠️ חדר ${roomId} — אורח${guestName ? ` ${guestName}` : ""} לא במצב צ'ק-אין (סטטוס לא מתאים)`;
    case "error":
      return `🚨 חדר ${roomId} — שגיאת מערכת בקליטת צ'ק-אין. בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.`;
    case "dedup":
      return null;
    default:
      return null;
  }
}
