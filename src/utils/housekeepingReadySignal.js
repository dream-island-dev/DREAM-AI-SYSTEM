/**
 * Mirrors supabase/functions/_shared/housekeepingReadySignal.ts (Deno boundary).
 */

export function buildHousekeepingGroupAckMessage(items) {
  const seen = new Set();
  const lines = [];
  for (const raw of items ?? []) {
    const roomId = String(typeof raw === "string" ? raw : raw?.roomId ?? "").trim();
    const guestName = typeof raw === "object" && raw?.guestName ? String(raw.guestName).trim() : "";
    if (!roomId || seen.has(roomId)) continue;
    seen.add(roomId);
    const guestPart = guestName ? ` — אורח: ${guestName}` : "";
    lines.push(`✅ ${roomId} מוכן${guestPart} — ממתין לאישור מנהל לשליחת הודעה 🔔`);
  }
  return lines.join("\n");
}

export const HOUSEKEEPING_READY_ALWAYS_VISIBLE_ACTIONS = new Set(["skipped_no_suite", "error"]);

export function buildHousekeepingReadyAckLine(result) {
  const { roomNumber, roomId, guestName, action } = result ?? {};
  if (action === "skipped_no_suite") {
    return `⚠️ מספר חדר #${roomNumber} לא מוכר במערכת — סטטוס "מוכן" לא נקלט, בדקו את המספר`;
  }
  if (!roomId) return null;
  const guestPart = guestName?.trim() ? ` — אורח: ${guestName.trim()}` : "";
  switch (action) {
    case "updated":
      return `✅ ${roomId} מוכן${guestPart} — ממתין לאישור מנהל 🔔`;
    case "already_pending":
      return `ℹ️ ${roomId} — כבר ממתין לאישור`;
    case "skipped_occupied":
      const name = guestName?.trim();
      return `ℹ️ ${roomId} — אורח במשך שהות${name ? ` (${name})` : ""}`;
    case "error":
      return `🚨 ${roomId} — שגיאת מערכת בסימון "מוכן". בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.`;
    case "dedup":
      return null;
    default:
      return null;
  }
}
