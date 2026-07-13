// supabase/functions/_shared/automationRetryGate.ts
//
// Anti-spam / anti-race latch for the WhatsApp automation pipeline.
//
// Root problem (2026-07-13 incident, Stage 3 Shabbat morning re-sent every
// ~15m): the only "already handled" signal (guests.msg_*_sent, and
// notification_log's sent/simulated dedup in automationDuplicateGuard.ts) is
// stamped exclusively on confirmed success. A timeout/failed/blocked_by_meta
// attempt writes an audit row but never latches anything, so whatsapp-cron
// sees the guest as still due on every subsequent tick — forever, with no
// cap. blocked_by_meta is included alongside timeout/failed for the same
// reason: it's the exact failure mode behind the 2026-07-12 day-pass
// #131008/#132000 template-rejection loop (CLAUDE.md §1) — a different
// symptom of the identical structural gap, not a separate class of problem.
//
// This module is the single shared gate: it turns a batch of recent
// notification_log rows into a per (guest, trigger) retry state, and decides
// whether an autonomous dispatch should be held back. It is wired into
// _shared/automationSchedule.ts's checkEligibility() — the ONE choke point
// whatsapp-cron (dispatch) and automation-queue (ACC Live Queue) already both
// call — so every trigger type is covered uniformly with no per-trigger
// duplication, and force:true/ACC Override (which calls whatsapp-send
// directly, bypassing checkEligibility entirely) is naturally unaffected.
//
// "in_flight" (processing) is the Phase C durable-claim counterpart — see
// _shared/automationClaim.ts. Kept in the same map/query so cron/queue only
// need one batched notification_log read per tick, not two.

export const RETRY_COOLDOWN_MINUTES = 30;
export const RETRY_MAX_ATTEMPTS = 4;
export const RETRY_LOOKBACK_HOURS = 24;

export type RetryAttemptRow = {
  guest_id: number | string | null;
  trigger_type: string | null;
  status: string | null;
  sent_at: string | null;
};

export type RetryState = {
  /** Count of timeout/failed/blocked_by_meta rows within the lookback window. */
  count: number;
  /** Most recent timeout/failed/blocked_by_meta/processing row's sent_at (ISO). */
  lastAttemptAt: string;
  /** A claim row (Phase C) currently in status='processing' for this pair. */
  processing: boolean;
};

export type RetryGateReason = "cooldown" | "exhausted" | "in_flight";

function retryKey(guestId: unknown, triggerType: unknown): string {
  return `${guestId}::${triggerType}`;
}

/**
 * Reduces raw notification_log rows (already filtered by the caller to
 * status IN ('timeout','failed','blocked_by_meta','processing') and a
 * bounded lookback window) into one RetryState per (guest_id, trigger_type).
 * Rows must be passed in any order — this does not assume pre-sorting.
 */
export function buildRetryStateMap(rows: RetryAttemptRow[]): Map<string, RetryState> {
  const map = new Map<string, RetryState>();
  for (const row of rows) {
    if (row.guest_id == null || !row.trigger_type || !row.sent_at) continue;
    // Defense in depth: ignore any status outside our four — a caller that
    // forgets to pre-filter (e.g. passes a raw 7-day notification_log read)
    // must never let a "sent" row's timestamp masquerade as the last
    // failure, which would silently corrupt the cooldown calculation.
    if (
      row.status !== "timeout" && row.status !== "failed" &&
      row.status !== "blocked_by_meta" && row.status !== "processing"
    ) continue;
    const key = retryKey(row.guest_id, row.trigger_type);
    const existing = map.get(key) ?? { count: 0, lastAttemptAt: row.sent_at, processing: false };
    if (row.status === "timeout" || row.status === "failed" || row.status === "blocked_by_meta") {
      existing.count += 1;
    }
    if (row.status === "processing") {
      existing.processing = true;
    }
    if (new Date(row.sent_at).getTime() > new Date(existing.lastAttemptAt).getTime()) {
      existing.lastAttemptAt = row.sent_at;
    }
    map.set(key, existing);
  }
  return map;
}

/**
 * Pure decision — no I/O. `state` is the precomputed RetryState for this
 * exact (guest, stage) pair, already attached to the guest row by the caller
 * (whatsapp-cron / automation-queue), mirroring the existing
 * pipeline_suppressed_stages attach pattern.
 */
export function evaluateRetryGate(
  state: RetryState | undefined,
  now: Date,
): RetryGateReason | null {
  if (!state) return null;
  if (state.processing) return "in_flight";
  if (state.count >= RETRY_MAX_ATTEMPTS) return "exhausted";
  const elapsedMinutes = (now.getTime() - new Date(state.lastAttemptAt).getTime()) / 60000;
  if (elapsedMinutes < RETRY_COOLDOWN_MINUTES) return "cooldown";
  return null;
}
