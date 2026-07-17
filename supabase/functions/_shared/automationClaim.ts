// supabase/functions/_shared/automationClaim.ts
//
// Phase C (2026-07-13) — durable claim-before-send. Phase B
// (automationRetryGate.ts) stops the same guest+trigger being re-fired every
// ~15m after a failure; this is a separate, narrower concern: preventing two
// overlapping whatsapp-cron ticks (or a cron tick racing a manual ACC
// Override dispatch) from sending the SAME guest+trigger concurrently.
//
// Mechanism: INSERT a notification_log row with status='processing' BEFORE
// calling Whapi/Meta. migration 195's partial unique index
// (guest_id, trigger_type) WHERE status='processing' makes "at most one
// in-flight attempt" a Postgres-enforced invariant — not a hope. The SAME
// row is then UPDATEd (never re-inserted) to its final status
// (sent|simulated|timeout|failed|blocked_by_meta) once the attempt
// completes, so one row = one attempt (no notification_log/Inbox flooding),
// and the unique index naturally releases for the next attempt.
//
// Guards ALL whatsapp-send dispatch paths (2026-07-17): the generic BRANCH D
// pipeline path (pre_arrival_2d, mid_stay(+daypass), checkout_fb(+daypass),
// spa_warmup_daypass, survey_invite_daypass, night_before_daypass) AND every
// dedicated fast-path block — stage_2_arrival, night_before, the three
// morning blocks (day-pass Meta, suite session, deterministic template), and
// room_ready — via whatsapp-send's claimStageDispatch() wrapper.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Well past the 45s Whapi timeout (+ Meta round-trip) — a processing row
 * older than this almost certainly means the function instance that claimed
 * it crashed/timed out before finalizing, not that it's still working. */
export const STALE_CLAIM_MINUTES = 5;

export type ClaimResult =
  | { claimed: true; logId: number }
  | { claimed: false; reason: "in_flight" };

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

/**
 * Claims the (guestId, triggerType) slot before send. `force` mirrors
 * checkPipelineDuplicate's existing convention (automationDuplicateGuard.ts)
 * — an explicit staff re-send from ACC Override must never be silently
 * blocked by a race guard meant for autonomous cron.
 */
export async function claimDispatchAttempt(
  supabase: SupabaseClient,
  opts: { guestId: number; triggerType: string; recipient: string; force?: boolean },
): Promise<ClaimResult> {
  const baseRow = {
    guest_id: opts.guestId,
    recipient: opts.recipient,
    trigger_type: opts.triggerType,
    channel: "whatsapp",
    status: "processing",
  };

  if (opts.force) {
    // No uniqueness check — staff explicitly asked for this now. Still an
    // audit row (one INSERT), so finalizeDispatchAttempt has a row to update.
    const { data, error } = await supabase.from("notification_log").insert(baseRow).select("id").maybeSingle();
    if (error || !data) {
      throw new Error(`claim_insert_failed (force): ${error?.message ?? "no row returned"}`);
    }
    return { claimed: true, logId: data.id as number };
  }

  const attemptInsert = async (): Promise<{ data: { id: number } | null; error: { code?: string; message?: string } | null }> => {
    const { data, error } = await supabase.from("notification_log").insert(baseRow).select("id").maybeSingle();
    return { data: data as { id: number } | null, error };
  };

  let { data, error } = await attemptInsert();

  if (error && isUniqueViolation(error)) {
    const { data: existing, error: lookupErr } = await supabase
      .from("notification_log")
      .select("id, sent_at")
      .eq("guest_id", opts.guestId)
      .eq("trigger_type", opts.triggerType)
      .eq("status", "processing")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupErr || !existing) {
      // Couldn't confirm what's blocking us — treat as in_flight rather than
      // guessing; a fresh cron tick (or manual retry) will re-evaluate.
      return { claimed: false, reason: "in_flight" };
    }

    const ageMinutes = (Date.now() - new Date(existing.sent_at as string).getTime()) / 60000;
    if (ageMinutes < STALE_CLAIM_MINUTES) {
      return { claimed: false, reason: "in_flight" };
    }

    // Stale — the instance that claimed this almost certainly crashed before
    // finalizing. Optimistic reclaim: only succeeds if the row is STILL
    // 'processing' (protects against a race with a finalize that lands
    // between our SELECT and this UPDATE).
    const { data: reclaimed, error: reclaimErr } = await supabase
      .from("notification_log")
      .update({ status: "timeout", payload: { stale_reclaimed: true } })
      .eq("id", existing.id)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();

    if (reclaimErr || !reclaimed) {
      // Someone else finalized/reclaimed it between our SELECT and UPDATE —
      // don't fight over it this tick.
      return { claimed: false, reason: "in_flight" };
    }

    ({ data, error } = await attemptInsert());
  }

  if (error || !data) {
    throw new Error(`claim_insert_failed: ${error?.message ?? "no row returned"}`);
  }
  return { claimed: true, logId: data.id as number };
}

/** Finalizes a claimed attempt — UPDATEs the SAME row (never a second
 * insert), so one row = one attempt regardless of how the claim resolved.
 *
 * Sent/simulated collision (migration 088's uq_notif_guest_trigger_sent): a
 * prior sent/simulated row for the same guest+trigger already exists — force
 * resend, or a per-room repeat like multi-suite room_ready. Before
 * claim-before-send that second audit row was silently dropped by the bare
 * insert; here we keep the row but mark it duplicate_blocked (payload carries
 * actual_status) instead of leaving a zombie 'processing' row that would
 * later surface as a fake timeout in Automation History. */
export async function finalizeDispatchAttempt(
  supabase: SupabaseClient,
  logId: number,
  status: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("notification_log")
    .update({ status, payload, sent_at: new Date().toISOString() })
    .eq("id", logId)
    .select("id")
    .maybeSingle();
  if (!error) return;

  if (isUniqueViolation(error) && (status === "sent" || status === "simulated")) {
    const { error: fbErr } = await supabase
      .from("notification_log")
      .update({
        status: "duplicate_blocked",
        payload: { ...payload, resend_after_sent: true, actual_status: status },
        sent_at: new Date().toISOString(),
      })
      .eq("id", logId)
      .select("id")
      .maybeSingle();
    if (fbErr) {
      console.error(`[automationClaim] finalize duplicate_blocked fallback failed for logId=${logId}:`, fbErr.message);
    }
    return;
  }

  console.error(`[automationClaim] finalize failed for logId=${logId} status=${status}:`, error.message);
}
