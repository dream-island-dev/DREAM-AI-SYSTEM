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

type LookupFailMode = "fail_closed" | "fail_open";

function resolveLookupFailMode(): LookupFailMode {
  const raw = String(Deno.env.get("AUTOMATION_DUPLICATE_LOOKUP_FAIL_MODE") ?? "fail_open")
    .trim()
    .toLowerCase();
  return raw === "fail_closed" ? "fail_closed" : "fail_open";
}

// Master kill-switch, separate from the old per-call force:true bypass.
// Mike doesn't trust this guard right now — set AUTOMATION_DUPLICATE_GUARD_ENABLED=false
// in Supabase secrets to disable it globally without touching call sites.
// Defaults to enabled ("true") when unset, so behavior is unchanged unless the secret is set.
let loggedGuardDisabled = false;

function isGuardEnabled(): boolean {
  const raw = String(Deno.env.get("AUTOMATION_DUPLICATE_GUARD_ENABLED") ?? "true")
    .trim()
    .toLowerCase();
  const enabled = raw !== "false";
  if (!enabled && !loggedGuardDisabled) {
    loggedGuardDisabled = true;
    console.warn("[automationDuplicateGuard] guard disabled via AUTOMATION_DUPLICATE_GUARD_ENABLED=false");
  }
  return enabled;
}

export async function checkPipelineDuplicate(
  supabase: SupabaseClient,
  opts: {
    guestId: number;
    triggerType: string;
    force?: boolean;
    /** room_ready only — dedup per physical suite, not per guest profile */
    roomId?: string | null;
  },
): Promise<DuplicateCheckResult> {
  if (opts.force) return { blocked: false };
  if (!isGuardEnabled()) return { blocked: false };

  let query = supabase
    .from("notification_log")
    .select("id, status, sent_at, payload")
    .eq("guest_id", opts.guestId)
    .eq("trigger_type", opts.triggerType)
    .in("status", ["sent", "simulated"])
    .order("sent_at", { ascending: false })
    .limit(20);

  const { data: sentRows, error } = await query;

  if (error) {
    const mode = resolveLookupFailMode();
    if (mode === "fail_closed") {
      console.warn(
        "[automationDuplicateGuard] log lookup failed — fail_closed mode (blocking send):",
        error.message,
      );
      return { blocked: true, reason: "lookup_failed" };
    }

    // Delivery-first default: avoid dropping guest communication on transient
    // notification_log read failures. Keep visibility via warning logs and
    // automation-health checks.
    console.warn(
      "[automationDuplicateGuard] log lookup failed — fail_open mode (allowing send):",
      error.message,
    );
    return { blocked: false };
  }

  const roomKey = opts.roomId?.trim() || null;
  const matching = (sentRows ?? []).filter((raw) => {
    const row = raw as { status?: string; sent_at?: string | null; payload?: Record<string, unknown> | null };
    if (opts.triggerType !== "room_ready" || !roomKey) return true;
    const loggedRoom = String((row.payload as Record<string, unknown>)?.room_id ?? "").trim();
    return loggedRoom === roomKey;
  });

  if (matching.length > 0) {
    const row = matching[0] as { status?: string; sent_at?: string | null };
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
