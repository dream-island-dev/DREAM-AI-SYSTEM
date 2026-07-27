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

export function buildHousekeepingReadyAckLine(result) {
  const { roomId, guestName, action } = result ?? {};
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
    default:
      return null;
  }
}
