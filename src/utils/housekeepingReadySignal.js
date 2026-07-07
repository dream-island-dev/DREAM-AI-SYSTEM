/**
 * Mirrors supabase/functions/_shared/housekeepingReadySignal.ts (Deno boundary).
 */

export function buildHousekeepingGroupAckMessage(roomIds) {
  const unique = [...new Set(roomIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  return unique
    .map((id) => `✅ חדר ${id} מוכן — נשלחה התראה לשליחת הודעה לאורח 🔔`)
    .join("\n");
}
