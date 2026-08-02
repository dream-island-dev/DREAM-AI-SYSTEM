// Room-ready approval gate helpers — stale detection + turnover reset payload.

export const ROOM_APPROVAL_GATE_STALE_MS = 24 * 60 * 60 * 1000;

/** Gate is stale when older than 24h or a Co signal arrived after it opened. */
export function isApprovalGateStale(
  roomUpdatedAt: string | null | undefined,
  opts: { checkoutAfterGateAt?: string | null } = {},
): boolean {
  if (!roomUpdatedAt) return true;
  const updated = new Date(roomUpdatedAt).getTime();
  if (Number.isNaN(updated)) return true;

  const checkoutAt = opts.checkoutAfterGateAt
    ? new Date(opts.checkoutAfterGateAt).getTime()
    : NaN;
  if (!Number.isNaN(checkoutAt) && checkoutAt > updated) return true;

  return Date.now() - updated > ROOM_APPROVAL_GATE_STALE_MS;
}

/** Physical turnover reset — clears manager bell + jacuzzi/room clean flags. */
export function roomCleaningResetRow(roomId: string): Record<string, unknown> {
  const trimmed = String(roomId ?? "").trim();
  const now = new Date().toISOString();
  return {
    room_id: trimmed,
    status: "לניקיון",
    room_clean_status: "dirty",
    jacuzzi_status: "dirty",
    cleaning_started_at: null,
    cleaning_ended_at: null,
    updated_at: now,
  };
}
