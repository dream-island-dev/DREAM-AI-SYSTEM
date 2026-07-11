// supabase/functions/_shared/handoffEscalation.ts
//
// Hybrid unanswered-guest escalation (session 2026-07-11):
//   • HARD — guest_request tasks stuck in pending_approval (reception never
//     tapped Approve) → auto-approve + Whapi ops dispatch after N minutes,
//     then page management (Mike / Eliad / Adir).
//   • SOFT — Inbox human_requested handoffs that are NOT physical room ops
//     (spa, late checkout, finance, generic staff_handoff) → ping duty
//     reception only after a longer window. Never open an ops task.
//
// Pure helpers live here so sla-escalation-cron stays thin and unit-testable.

/** Minutes a guest_request may sit in pending_approval before auto-approve. */
export const PENDING_APPROVAL_AUTO_APPROVE_MINUTES = 7;

/** Minutes a soft Inbox handoff may sit unanswered before Adir/reception ping. */
export const SOFT_HANDOFF_SLA_MINUTES = 20;

/**
 * human_request_type values that already have (or should have) a physical
 * ops task — hard path is the pending_approval watcher, not this soft clock.
 */
export const URGENT_OPS_HUMAN_REQUEST_TYPES = new Set([
  "operational_request",
]);

/**
 * Soft / reception-owned handoffs — page duty manager only, never field ops.
 * Anything not in URGENT_OPS and not listed here still counts as soft
 * (fail-safe: unknown types must not open Whapi ops cards).
 */
export const SOFT_HANDOFF_HUMAN_REQUEST_TYPES = new Set([
  "staff_handoff",
  "date_change",
  "financial_issue",
  "callback",
  "call",
  "chat",
  "guest_alert",
  "fallback_no_match",
]);

export function isUrgentOpsHumanRequestType(type: string | null | undefined): boolean {
  return URGENT_OPS_HUMAN_REQUEST_TYPES.has(String(type ?? "").trim());
}

/** True when an Inbox red-dot should use the soft (non-ops) clock. */
export function isSoftHandoffHumanRequestType(type: string | null | undefined): boolean {
  const t = String(type ?? "").trim();
  if (!t) return true; // unknown / null → soft (never invent an ops card)
  if (isUrgentOpsHumanRequestType(t)) return false;
  return true;
}

export function isOlderThanMinutes(
  createdAt: string | Date,
  minutes: number,
  now: Date = new Date(),
): boolean {
  const ms = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return now.getTime() - ms >= minutes * 60_000;
}

export function pendingApprovalCutoffIso(
  minutes: number = PENDING_APPROVAL_AUTO_APPROVE_MINUTES,
  now: Date = new Date(),
): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

export function softHandoffCutoffIso(
  minutes: number = SOFT_HANDOFF_SLA_MINUTES,
  now: Date = new Date(),
): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

/** Dedupe bare-digit phones from a mixed raw list (env + known executives). */
export function dedupePhoneDigits(rawPhones: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawPhones) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    const normalized = digits.startsWith("0") ? "972" + digits.slice(1) : digits;
    if (!normalized || normalized.length < 10) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function buildPendingAutoApproveManagerText(args: {
  room: string | null | undefined;
  description: string | null | undefined;
  ageMinutes: number;
  taskId: string | number;
}): string {
  return (
    `🚨 AUTO-DISPATCH — Guest room request sat ${args.ageMinutes} min without reception approval.\n` +
    `Suite: ${args.room ?? "—"}\n` +
    `Request: ${args.description ?? "—"}\n` +
    `Task #${args.taskId} was auto-approved and sent to Operations.\n` +
    `Please confirm field response.`
  );
}

export function buildSoftHandoffManagerText(args: {
  phone: string;
  requestType: string | null | undefined;
  guestLabel: string;
  ageMinutes: number;
  preview: string;
}): string {
  return (
    `⚠️ Unanswered guest handoff — ${args.ageMinutes} min (soft / non-ops).\n` +
    `Guest: ${args.guestLabel}\n` +
    `Type: ${args.requestType ?? "staff_handoff"}\n` +
    `Phone: ${args.phone}\n` +
    `Message: "${args.preview}"\n` +
    `Check DREAM BOT Inbox — do NOT open a field-ops card for spa / late checkout / finance.`
  );
}
