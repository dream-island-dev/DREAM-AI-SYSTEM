// Mirrors supabase/functions/_shared/roomApprovalGate.ts (Deno boundary).

export const ROOM_APPROVAL_GATE_STALE_MS = 24 * 60 * 60 * 1000;

export function isApprovalGateStale(roomUpdatedAt, { checkoutAfterGateAt } = {}) {
  if (!roomUpdatedAt) return true;
  const updated = new Date(roomUpdatedAt).getTime();
  if (Number.isNaN(updated)) return true;

  const checkoutAt = checkoutAfterGateAt ? new Date(checkoutAfterGateAt).getTime() : NaN;
  if (!Number.isNaN(checkoutAt) && checkoutAt > updated) return true;

  return Date.now() - updated > ROOM_APPROVAL_GATE_STALE_MS;
}

export function roomCleaningResetRow(roomId) {
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

export function formatWaReadySource(evt) {
  if (!evt) return null;
  const when = new Date(evt.created_at).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const who = evt.from_name?.trim() || "צוות ניקיון";
  const line = evt.source_line?.trim() || "מוכן";
  return `מזוהה מ-WA: ${line} · ${who} · ${when}`;
}
