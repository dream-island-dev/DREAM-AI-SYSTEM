// Shared automation pipeline duplicate guard — used by whatsapp-send + whatsapp-webhook.
// Blocks repeat delivery when notification_log already has sent/simulated for guest+trigger.
// Guest flag alone (without a successful log) does NOT block — allows split-brain repair.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type DuplicateBlockReason = "already_sent";

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
    console.warn("[automationDuplicateGuard] log lookup failed:", error.message);
    return { blocked: false };
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
      message: "ניסיון שליחה כפולה נחסם — האורח כבר קיבל את השלב הזה.",
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
    error: "שלב זה כבר נשלח לאורח — ניסיון כפול נחסם.",
    ...extra,
  };
}
