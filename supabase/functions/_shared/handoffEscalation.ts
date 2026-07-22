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

import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import { handoffTypeLabelHe } from "./adirNotifyMessages.ts";
import {
  composeFromStaffTemplate,
  STAFF_TEMPLATE_KEYS,
  type StaffTemplateMap,
} from "./staffNotifyTemplates.ts";

/** Minutes a guest_request may sit in pending_approval before auto-approve. */
export const PENDING_APPROVAL_AUTO_APPROVE_MINUTES = 7;

/** Minutes a soft Inbox handoff may sit unanswered before Adir/reception ping. */
export const SOFT_HANDOFF_SLA_MINUTES = 20;

/**
 * human_request_type values that already have (or should have) a physical
 * ops task — hard path is the pending_approval watcher, not this soft clock.
 * Empty since the 2026-07-22 Human-First cutover: the bot no longer opens an
 * automatic Ops Board task for "operational_request" (see
 * _shared/createGuestOpsTask.ts header) — a staff member may still open one
 * manually, but that no longer needs a dedicated escalation path here, since
 * the Inbox flag itself is now covered by the soft clock below.
 */
export const URGENT_OPS_HUMAN_REQUEST_TYPES = new Set<string>([]);

/**
 * Soft / reception-owned handoffs — page duty manager only, never field ops.
 * Anything not in URGENT_OPS and not listed here still counts as soft
 * (fail-safe: unknown types must not open Whapi ops cards). "operational_request"
 * moved here 2026-07-22 — it no longer creates a task, so without this it had
 * no escalation clock at all if staff missed the Inbox red dot.
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
  "operational_request",
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
  return [
    "🚨 בקשת חדר נשלחה אוטומטית לתחזוקה",
    `עברו ${args.ageMinutes} דק׳ בלי אישור קבלה — המערכת אישרה ושיגרה לבד.`,
    "",
    `🏨 סוויטה: ${args.room ?? "—"}`,
    `📋 בקשה: ${args.description ?? "—"}`,
    "",
    "👉 מה לעשות:",
    `וודא שהצוות בשטח מטפל. משימה #${args.taskId}.`,
  ].join("\n");
}

export function buildSoftHandoffManagerText(args: {
  phone: string;
  requestType: string | null | undefined;
  guestLabel: string;
  ageMinutes: number;
  preview: string;
  templates?: StaffTemplateMap;
}): string {
  const digits = args.phone.replace(/\D/g, "");
  const inboxLine = digits
    ? `💬 אינבוקס: ${buildStaffAppDeepLink({ page: "wa_inbox", phone: digits })}`
    : "";
  const fromDb = composeFromStaffTemplate(args.templates, STAFF_TEMPLATE_KEYS.ADIR_SOFT_HANDOFF, {
    age_minutes: args.ageMinutes,
    guest_label: args.guestLabel,
    request_type_label: handoffTypeLabelHe(args.requestType),
    preview: args.preview,
    inbox_line: inboxLine,
    requests_board_link: buildStaffAppDeepLink({ page: "requests_board" }),
  });
  if (fromDb) return fromDb;

  const lines = [
    "⚠️ אורח מחכה לתשובה",
    `עברו ${args.ageMinutes} דק׳ מאז שהבוט העביר לצוות.`,
    "",
    `👤 ${args.guestLabel}`,
    `📌 ${handoffTypeLabelHe(args.requestType)}`,
    `💬 «${args.preview}»`,
    "",
    "👉 מה לעשות:",
    "זו בקשה שלא דורשת תחזוקה בשטח (ספא / חיוב / שינוי תאריך).",
    "ענה לאורח מהאינבוקס — אל תפתח כרטיס תחזוקה.",
  ];
  if (digits) lines.push(inboxLine);
  lines.push(`📋 לוח בקשות: ${buildStaffAppDeepLink({ page: "requests_board" })}`);
  return lines.join("\n");
}
