// Shared ack-line selection for the housekeeping WA group (ready/check-in/check-out).
//
// Mike, 2026-08-05 (P0): the group is receive-only — when HOUSEKEEPING_WA_GROUP_REPLY
// is off (default), NOTHING goes back to the group, with zero exceptions. This used
// to bypass the flag for genuine failures/ambiguous cases under a Fail Visible
// reading, but that produced unwanted outbound like "⚠️ חדר ג'ספר 3 — כמה אורחים עם
// עזיבה היום" even in silent mode. Fail Visible is still honored — see
// warnHousekeepingProblemSignals below — it just lands in server logs instead of the
// WhatsApp group.

export function selectHousekeepingAckLines<T extends { action: string }>(
  signals: T[],
  buildLine: (r: T) => string | null,
  hkGroupReply: boolean,
): string[] {
  if (!hkGroupReply) return [];
  return signals.map(buildLine).filter((l): l is string => !!l);
}

/** Console-only Fail Visible trail for problem signals when the group stays silent
 * (HOUSEKEEPING_WA_GROUP_REPLY=false). Never sends anything — parse/DB-update side
 * effects already happened by the time this runs; this only decides what gets a
 * console.warn so ops still has a record without it reaching the WA group. */
export function warnHousekeepingProblemSignals<
  T extends { action: string; roomNumber: number; roomId: string | null; guestName?: string | null; error?: string },
>(label: string, signals: T[], problemActions: ReadonlySet<string>): void {
  for (const s of signals) {
    if (!problemActions.has(s.action)) continue;
    const room = s.roomId ?? `#${s.roomNumber}`;
    const guestPart = s.guestName ? ` guest=${s.guestName}` : "";
    const errorPart = s.error ? ` error=${s.error}` : "";
    console.warn(`[housekeeping:${label}:silent] action=${s.action} room=${room}${guestPart}${errorPart}`);
  }
}
