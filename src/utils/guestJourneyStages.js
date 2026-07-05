// Guest automation journey — maps guests.msg_* flags to human-readable pipeline steps.

export const GUEST_JOURNEY_STAGES = [
  { key: "pre_arrival_2d", label: "שלב 1 — אישור הגעה (T-2)", flag: "msg_pre_arrival_2d_sent" },
  { key: "stage_2_arrival", label: "שלב 2 — אישור הגעה + פרטים", flag: "msg_stage_2_arrival_sent" },
  { key: "night_before", label: "שלב 2.5 — ערב לפני הגעה", flag: "msg_pre_arrival_sent" },
  { key: "morning_suite", label: "שלב 3 — בוקר הגעה (סוויטה)", flag: "msg_morning_suite_sent", suiteOnly: true },
  { key: "morning_welcome", label: "שלב 3 — בוקר הגעה", flag: "msg_morning_welcome_sent", nonSuiteOnly: true },
  { key: "mid_stay", label: "שלב 4 — אמצע שהייה", flag: "msg_mid_stay_sent" },
  { key: "checkout_fb", label: "שלב 5 — משוב אחרי עזיבה", flag: "msg_checkout_fb_sent" },
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
};

/** Build step list from guest row flags (no queue API required). */
export function buildGuestJourneyFromFlags(guest) {
  if (!guest) return [];
  const isSuite = guest.room_type === "suite";
  return GUEST_JOURNEY_STAGES.filter((s) => {
    if (s.suiteOnly && !isSuite) return false;
    if (s.nonSuiteOnly && isSuite) return false;
    return true;
  }).map((s) => ({
    ...s,
    sent: guest[s.flag] === true,
    status: guest[s.flag] === true ? "sent" : "pending",
  }));
}

/** Merge queue rows (automation-queue) onto journey steps when available. */
export function mergeQueueIntoJourney(steps, queueRows) {
  if (!queueRows?.length) return steps;
  const byKey = new Map(queueRows.map((q) => [q.stageKey, q]));
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
    };
  });
}
