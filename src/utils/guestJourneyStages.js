// Guest automation journey — pipeline-aware (suite vs day-pass), mirrors automation-queue.

import {
  classifyStagePipelineSegment,
  filterQueueItemsForGuest,
  resolveGuestPipelineSegment,
} from "./pipelineSegment";

export const GUEST_JOURNEY_STAGES = [
  { key: "pre_arrival_2d", label: "שלב 1 — אישור הגעה", flag: "msg_pre_arrival_2d_sent", segment: "shared" },
  { key: "stage_2_arrival", label: "שלב 2 — אישור הגעה + פרטים", flag: null, segment: "shared" },
  { key: "night_before", label: "שלב 2.5 — ערב לפני (סוויטות)", flag: "msg_pre_arrival_sent", segment: "suite" },
  { key: "night_before_daypass", label: "שלב 2.5 — ערב לפני (בילוי יומי)", flag: "msg_pre_arrival_sent", segment: "daypass" },
  { key: "morning_suite", label: "שלב 3 — בוקר הגעה (סוויטות)", flag: "msg_morning_suite_sent", segment: "suite" },
  { key: "morning_welcome", label: "שלב 3 — בוקר הגעה (בילוי יומי)", flag: "msg_morning_welcome_sent", segment: "daypass" },
  { key: "mid_stay", label: "שלב 4 — שיחות נימוסים (סוויטות)", flag: "msg_mid_stay_sent", segment: "suite" },
  { key: "mid_stay_daypass", label: "שלב 4 — שיחות נימוסים (בילוי יומי)", flag: "msg_mid_stay_sent", segment: "daypass" },
  { key: "checkout_fb", label: "שלב 5 — משוב עזיבה (סוויטות)", flag: "msg_checkout_fb_sent", segment: "suite" },
  { key: "checkout_fb_daypass", label: "שלב 5 — משוב עזיבה (בילוי יומי)", flag: "msg_checkout_fb_sent", segment: "daypass" },
];

export const SKIP_REASON_LABELS = {
  guest_not_arrived: "הגעה עתידית — חסום",
  guest_never_checked_in: "לא צ׳ק-אין — חסום",
  stay_not_ended: "השהות לא הסתיימה",
  invalid_stay_dates: "תאריכי שהות שגויים",
  guest_cancelled: "אורח מבוטל",
  guest_checked_out: "אורח עזב",
  not_checked_in: "ממתין לצ׳ק-אין",
  awaiting_confirmation: "ממתין לאישור הגעה",
  already_sent: "כבר נשלח",
  automation_muted: "אוטומציה מושתקת",
  staff_claim_active: "בטיפול צוות",
  stage_suppressed: "בוטל ידנית",
  wrong_room_type: "לא רלוונטי לסוג האורח",
};

function stagesForGuest(guest) {
  const segment = resolveGuestPipelineSegment(guest);
  return GUEST_JOURNEY_STAGES.filter(
    (s) => s.segment === "shared" || s.segment === segment,
  );
}

/** Build step list from guest row flags (no queue API required). */
export function buildGuestJourneyFromFlags(guest) {
  if (!guest) return [];
  return stagesForGuest(guest).map((s) => ({
    ...s,
    sent: s.flag ? guest[s.flag] === true : false,
    status: s.flag && guest[s.flag] === true ? "sent" : "pending",
    pipelineSegment: s.segment,
  }));
}

/** Merge queue rows (automation-queue) onto journey steps when available. */
export function mergeQueueIntoJourney(steps, queueRows, guest) {
  const applicable = guest ? filterQueueItemsForGuest(queueRows, guest) : (queueRows ?? []);
  if (!applicable.length) return steps;
  const byKey = new Map(applicable.map((q) => [q.stageKey, q]));
  return steps.map((step) => {
    const q = byKey.get(step.key);
    if (!q) return step;
    const sent = q.status === "sent" || q.status === "simulated" || step.sent;
    return {
      ...step,
      sent,
      status: sent ? "sent" : q.skipReason ? "blocked" : q.dueNow ? "due" : "scheduled",
      skipReason: q.skipReason,
      skipLabel: q.skipReason ? (SKIP_REASON_LABELS[q.skipReason] ?? `⚠ ${q.skipReason}`) : null,
      scheduledFor: q.scheduledFor ?? null,
      suppressed: q.skipReason === "stage_suppressed",
    };
  });
}

export function getGuestPipelineLabel(guest) {
  return resolveGuestPipelineSegment(guest) === "suite" ? "🏨 סוויטות" : "☀️ בילוי יומי";
}

export { classifyStagePipelineSegment, resolveGuestPipelineSegment };
