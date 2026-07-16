// supabase/functions/_shared/architectHealthHint.ts
// Pure logic for Mike's (architect) event-gated system-health pulse. automation-health-cron
// (10-min pg_cron tick, migration 163) calls these to decide whether a check-state flip is
// architect-relevant and to compose the personal Whapi DM line. Zero I/O, fully unit-testable —
// same separation as resortDigestStats.ts / teamOpsAnalytics.ts.
//
// Deliberately fires only on a genuine ok<->alerting flip (never on automation-health-cron's
// existing periodic repeat-ping) — Mike learns once when something breaks and once when it's
// fixed, not nagged every ALERT_REPEAT_HOURS while an issue stays open.

export const ARCHITECT_RELEVANT_CHECK_KEYS: ReadonlySet<string> = new Set([
  "whapi_device_health",
  "pending_approval_spike",
  "human_requested_spike",
]);

export const PENDING_APPROVAL_ALERT_THRESHOLD = 5;
export const HUMAN_REQUESTED_ALERT_THRESHOLD = 3;

export function isPendingApprovalSpike(count: number): boolean {
  return count >= PENDING_APPROVAL_ALERT_THRESHOLD;
}

export function isHumanRequestedSpike(count: number): boolean {
  return count >= HUMAN_REQUESTED_ALERT_THRESHOLD;
}

const CHECK_KEY_LABEL_HE: Record<string, string> = {
  whapi_device_health: "מכשיר Whapi",
  pending_approval_spike: "משימות ממתינות לאישור",
  human_requested_spike: "בקשות human_requested ב-Inbox",
};

function labelFor(checkKey: string): string {
  return CHECK_KEY_LABEL_HE[checkKey] ?? checkKey;
}

function detailSummary(checkKey: string, detail: Record<string, unknown>): string {
  switch (checkKey) {
    case "whapi_device_health":
      return String(detail.status ?? detail.error ?? "");
    case "pending_approval_spike":
      return `${detail.count ?? "?"} משימות (סף: ${detail.threshold ?? PENDING_APPROVAL_ALERT_THRESHOLD})`;
    case "human_requested_spike":
      return `${detail.count ?? "?"} שיחות (סף: ${detail.threshold ?? HUMAN_REQUESTED_ALERT_THRESHOLD})`;
    default:
      return "";
  }
}

/**
 * Mike's personal Whapi DM line for a genuine check-state flip. Caller (automation-health-cron)
 * must only invoke this when prevStatus !== status for a key in ARCHITECT_RELEVANT_CHECK_KEYS.
 */
export function composeArchitectHealthHint(
  checkKey: string,
  transitionedToOk: boolean,
  detail: Record<string, unknown>,
): string {
  const label = labelFor(checkKey);
  if (transitionedToOk) {
    return `מייק, ${label} חזר לתקין — סגרתי את ההתראה.`;
  }
  const detailText = detailSummary(checkKey, detail);
  return `מייק, get_system_health העלה חריגה: ${label}${detailText ? ` — ${detailText}` : ""}. גם קבוצת האוטומציה קיבלה את זה; בדקתי ברגע זה, לא ניחוש.`;
}
