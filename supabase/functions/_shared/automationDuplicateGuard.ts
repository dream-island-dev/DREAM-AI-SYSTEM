// Shared automation pipeline duplicate guard — used by whatsapp-send + whatsapp-webhook.
// Blocks repeat delivery when notification_log already has sent/simulated for guest+trigger.
// Guest flag alone (without a successful log) does NOT block — allows split-brain repair.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type DuplicateBlockReason = "already_sent" | "lookup_failed";

export type DuplicateCheckResult =
  | { blocked: false }
  | {
    blocked: true;
    reason: DuplicateBlockReason;
    priorSentAt?: string | null;
    priorStatus?: string | null;
  };

export async function checkPipelineDuplicate(
  supabase: SupabaseClient,
  opts: {
    guestId: number;
    triggerType: string;
    force?: boolean;
  },
): Promise<DuplicateCheckResult> {
  if (opts.force) return { blocked: false };

  const { data: sentRows, error } = await supabase
    .from("notification_log")
    .select("id, status, sent_at")
    .eq("guest_id", opts.guestId)
    .eq("trigger_type", opts.triggerType)
    .in("status", ["sent", "simulated"])
    .order("sent_at", { ascending: false })
    .limit(1);

  if (error) {
    // QA audit fix (2026-07-06): this used to fail OPEN (return not-blocked),
    // which — combined with whatsapp-cron's Stage 2 reconcile pass reading the
    // exact same table — meant a single transient notification_log read
    // failure could disable BOTH duplicate-send safety nets at once and let a
    // real Meta send go out twice. Fail closed: an unreadable log means we
    // cannot prove this wasn't already sent, so block for now and let the
    // next cron tick / manual retry re-check once the table is readable again.
    console.warn("[automationDuplicateGuard] log lookup failed — failing CLOSED (blocking send):", error.message);
    return { blocked: true, reason: "lookup_failed" };
  }

  if (sentRows && sentRows.length > 0) {
    const row = sentRows[0] as { status?: string; sent_at?: string | null };
    return {
      blocked: true,
      reason: "already_sent",
      priorSentAt: row.sent_at ?? null,
      priorStatus: row.status ?? null,
    };
  }

  return { blocked: false };
}

export async function logDuplicateBlocked(
  supabase: SupabaseClient,
  opts: {
    guestId: number;
    recipient: string;
    triggerType: string;
    reason: DuplicateBlockReason;
    priorSentAt?: string | null;
    source?: string;
  },
): Promise<boolean> {
  const { error } = await supabase.from("notification_log").insert({
    guest_id: opts.guestId,
    recipient: opts.recipient,
    trigger_type: opts.triggerType,
    channel: "whatsapp",
    status: "duplicate_blocked",
    payload: {
      reason: opts.reason,
      prior_sent_at: opts.priorSentAt ?? null,
      source: opts.source ?? "pipeline_guard",
      // FAIL VISIBLE: "already_sent" is a confirmed prior send; "lookup_failed"
      // is an unconfirmed precautionary block (couldn't read notification_log)
      // — these must not share the same "guest already received this" wording.
      message: opts.reason === "lookup_failed"
        ? "השליחה נחסמה כי לא ניתן היה לוודא בבטחה שהשלב לא נשלח כבר (שגיאת קריאה זמנית ב-notification_log)."
        : "ניסיון שליחה כפולה נחסם — האורח כבר קיבל את השלב הזה.",
    },
  });
  if (error) {
    console.warn("[automationDuplicateGuard] duplicate_blocked log insert failed:", error.message);
    return false;
  }
  return true;
}

export function duplicateBlockedResponseBody(
  dup: Extract<DuplicateCheckResult, { blocked: true }>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ok: true,
    skipped: true,
    status: "duplicate_blocked",
    reason: "duplicate_blocked",
    duplicate_reason: dup.reason,
    prior_sent_at: dup.priorSentAt ?? null,
    duplicate_logged: true,
    error: dup.reason === "lookup_failed"
      ? "לא ניתן היה לוודא שהשלב לא נשלח כבר (שגיאת בדיקה זמנית) — השליחה נחסמה למניעת כפילות ותנוסה שוב באוטומציה הבאה."
      : "שלב זה כבר נשלח לאורח — ניסיון כפול נחסם.",
    ...extra,
  };
}
