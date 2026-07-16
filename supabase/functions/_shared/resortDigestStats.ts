// supabase/functions/_shared/resortDigestStats.ts
// Pure aggregation for the Resort Ops Digest (daily/weekly/monthly Hebrew summary
// to Eliad via the Whapi Suites device). Same separation as resortPulseStats.ts:
// these functions take already-period-scoped rows (the caller filters by date
// range via the Supabase query) and do zero I/O of their own — fully unit-testable.

import { israelYmd, ISRAEL_UTC_OFFSET_HOURS } from "./automationSchedule.ts";
import {
  applyStaffMessageTemplate,
  ELIAD_DIGEST_SHELL_DEFAULTS,
  mergeDigestConfig,
  resolveStaffTemplate,
  STAFF_TEMPLATE_KEYS,
  type StaffTemplateMap,
} from "./staffNotifyTemplates.ts";

// Same value as guestAlertWhapiNotify.ts's STAFF_APP_ORIGIN — duplicated, not
// imported. This module is deliberately zero-I/O / dependency-light (pure
// aggregation, fully unit-testable); importing guestAlertWhapiNotify.ts here
// would drag its Supabase-client call chain into every test/typecheck of this
// file for one string constant.
const STAFF_APP_ORIGIN = "https://dream-ai-system.vercel.app";

export type DigestGuestRow = {
  id: number;
  room: string | null;
  checkin_time: string | null;
  room_ready_at: string | null;
  room_ready_notified: boolean | null;
};

export type DigestTaskRow = {
  id: string;
  room_number: string | null;
  sla_category: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  sla_deadline: string | null;
};

export type ArrivalBucket = "before_15" | "15_18" | "18_22" | "after_22";

export type ArrivalEntry = {
  room: string;
  checkinTime: string;
  bucket: ArrivalBucket;
};

const BUCKET_LABELS: Record<ArrivalBucket, string> = {
  before_15: "לפני 15:00",
  "15_18": "15:00–18:00",
  "18_22": "18:00–22:00",
  after_22: "אחרי 22:00",
};

/** Israel local hour (0-23), DST-aware. Guards the "24" midnight quirk some Intl builds emit. */
function israelHour(iso: string): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  const hour = Number(raw);
  return hour === 24 ? 0 : hour;
}

export function bucketCheckinHour(checkinIso: string): ArrivalBucket {
  const hour = israelHour(checkinIso);
  // 22:00–04:59 is one continuous "very late night" band — a 00:30 arrival is
  // the same operational event as a 23:30 one, not a "before 15:00" early check-in.
  if (hour >= 22 || hour < 5) return "after_22";
  if (hour < 15) return "before_15";
  if (hour < 18) return "15_18";
  return "18_22";
}

/** Suites that actually checked in during the period, sorted by arrival time. */
export function computeArrivals(guests: DigestGuestRow[]): ArrivalEntry[] {
  return guests
    .filter((g): g is DigestGuestRow & { checkin_time: string } => !!g.checkin_time)
    .map((g) => ({
      room: g.room ?? "—",
      checkinTime: g.checkin_time,
      bucket: bucketCheckinHour(g.checkin_time),
    }))
    .sort((a, b) => a.checkinTime.localeCompare(b.checkinTime));
}

export type RoomReadyStatus = "on_time" | "late" | "unknown";

export type RoomReadyEntry = {
  room: string;
  checkinTime: string;
  roomReadyAt: string | null;
  status: RoomReadyStatus;
  lateMinutes: number | null;
};

/**
 * Compares room_ready_at against checkin_time per arrived guest.
 * FAIL VISIBLE: a guest who checked in with no room_ready_at is "unknown", never
 * silently folded into "on_time" — surfaces a real gap in the ops pipeline.
 */
export function computeRoomReadyTiming(guests: DigestGuestRow[]): RoomReadyEntry[] {
  return guests
    .filter((g): g is DigestGuestRow & { checkin_time: string } => !!g.checkin_time)
    .map((g) => {
      const room = g.room ?? "—";
      const checkinTime = g.checkin_time;
      if (!g.room_ready_at) {
        return { room, checkinTime, roomReadyAt: null, status: "unknown" as const, lateMinutes: null };
      }
      const checkinMs = new Date(checkinTime).getTime();
      const readyMs = new Date(g.room_ready_at).getTime();
      if (readyMs <= checkinMs) {
        return { room, checkinTime, roomReadyAt: g.room_ready_at, status: "on_time" as const, lateMinutes: null };
      }
      const lateMinutes = Math.round((readyMs - checkinMs) / 60_000);
      return { room, checkinTime, roomReadyAt: g.room_ready_at, status: "late" as const, lateMinutes };
    });
}

export type SuiteRequestSummary = {
  room: string;
  total: number;
  resolved: number;
  open: number;
  rejected: number;
  byCategory: Record<string, number>;
};

/** Groups tasks by suite. Tasks with no room_number (general ops) are excluded — this is a per-suite report. */
export function computeRequestsBySuite(tasks: DigestTaskRow[]): SuiteRequestSummary[] {
  const byRoom = new Map<string, SuiteRequestSummary>();
  for (const t of tasks) {
    const room = t.room_number?.trim();
    if (!room) continue;
    let entry = byRoom.get(room);
    if (!entry) {
      entry = { room, total: 0, resolved: 0, open: 0, rejected: 0, byCategory: {} };
      byRoom.set(room, entry);
    }
    entry.total += 1;
    if (t.status === "done") entry.resolved += 1;
    else if (t.status === "rejected") entry.rejected += 1;
    else entry.open += 1;
    const category = t.sla_category ?? "uncategorized";
    entry.byCategory[category] = (entry.byCategory[category] ?? 0) + 1;
  }
  return [...byRoom.values()].sort((a, b) => b.total - a.total);
}

/** Mike-confirmed default (session 2026-07-11): 3+ same-category requests from one suite in the digest period. */
export const ANOMALY_SAME_TYPE_THRESHOLD = 3;

export type AnomalyFlag = {
  room: string;
  category: string;
  count: number;
};

export function computeAnomalies(
  requestsBySuite: SuiteRequestSummary[],
  threshold: number = ANOMALY_SAME_TYPE_THRESHOLD,
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  for (const suite of requestsBySuite) {
    for (const [category, count] of Object.entries(suite.byCategory)) {
      if (count >= threshold) flags.push({ room: suite.room, category, count });
    }
  }
  return flags.sort((a, b) => b.count - a.count);
}

export type SlaComplianceStats = {
  /** Tasks with a real sla_deadline, excluding rejected (no valid resolution to measure). */
  withDeadline: number;
  withinSla: number;
  breached: number;
  /** Subset of `breached` that is still open right now — the actionable ones. */
  breachedStillOpen: number;
  /** Rounded percentage, or null when there's nothing with a deadline to measure (avoids a misleading "0%"). */
  complianceRate: number | null;
};

/**
 * SLA compliance from tasks.sla_deadline (already in the schema, unused by the
 * digest until now). FAIL VISIBLE: a "done" task with a missing/late resolved_at
 * counts as breached, never silently assumed compliant.
 */
export function computeSlaCompliance(tasks: DigestTaskRow[], now: Date): SlaComplianceStats {
  let withDeadline = 0;
  let withinSla = 0;
  let breached = 0;
  let breachedStillOpen = 0;
  const nowMs = now.getTime();

  for (const t of tasks) {
    if (!t.sla_deadline || t.status === "rejected") continue;
    withDeadline += 1;
    const deadlineMs = new Date(t.sla_deadline).getTime();

    if (t.status === "done") {
      const resolvedMs = t.resolved_at ? new Date(t.resolved_at).getTime() : null;
      if (resolvedMs !== null && resolvedMs <= deadlineMs) withinSla += 1;
      else breached += 1;
      continue;
    }

    if (nowMs > deadlineMs) {
      breached += 1;
      breachedStillOpen += 1;
    } else {
      withinSla += 1;
    }
  }

  return {
    withDeadline,
    withinSla,
    breached,
    breachedStillOpen,
    complianceRate: withDeadline > 0 ? Math.round((withinSla / withDeadline) * 100) : null,
  };
}

export type DigestSurveyRow = {
  overall_experience: number;
  patio: number;
  live_kitchen: number;
  chestnut_restaurant: number;
  service_team: number;
  spa: number;
  cleaning_maintenance: number;
};

export type SurveyDigestStats = {
  count: number;
  avgOverall: number | null;
  /** Low score on 1-3 scale: overall 1 or any category 1. */
  lowScoreCount: number;
};

const SURVEY_CATEGORY_KEYS = [
  "patio", "live_kitchen", "chestnut_restaurant", "service_team", "spa", "cleaning_maintenance",
] as const;

function isLowScoreSurveyRow(s: DigestSurveyRow): boolean {
  if (s.overall_experience <= 1) return true;
  return SURVEY_CATEGORY_KEYS.some((k) => s[k] <= 1);
}

/** Guest Experience Survey (day-pass + spa cohort) — additive, optional in the digest. */
export function computeSurveyDigestStats(rows: DigestSurveyRow[]): SurveyDigestStats {
  const avgOverall = rows.length
    ? rows.reduce((sum, r) => sum + r.overall_experience, 0) / rows.length
    : null;
  return {
    count: rows.length,
    avgOverall,
    lowScoreCount: rows.filter(isLowScoreSurveyRow).length,
  };
}

export type ResortDigestStats = {
  arrivals: ArrivalEntry[];
  roomReadyTiming: RoomReadyEntry[];
  requestsBySuite: SuiteRequestSummary[];
  anomalies: AnomalyFlag[];
  slaCompliance: SlaComplianceStats;
  /** Optional — only populated when the caller passes survey rows in. */
  surveys?: SurveyDigestStats | null;
};

export function computeResortDigestStats(inputs: {
  guests: DigestGuestRow[];
  tasks: DigestTaskRow[];
  surveys?: DigestSurveyRow[];
  now?: Date;
}): ResortDigestStats {
  const requestsBySuite = computeRequestsBySuite(inputs.tasks);
  return {
    arrivals: computeArrivals(inputs.guests),
    roomReadyTiming: computeRoomReadyTiming(inputs.guests),
    requestsBySuite,
    anomalies: computeAnomalies(requestsBySuite),
    slaCompliance: computeSlaCompliance(inputs.tasks, inputs.now ?? new Date()),
    surveys: inputs.surveys ? computeSurveyDigestStats(inputs.surveys) : null,
  };
}

/**
 * One-glance executive summary line — a CEO should know if the period needs
 * attention without reading the rest of the message. Pulls only from
 * already-computed stats (no new aggregation).
 */
export function composeExecutiveHeadline(stats: ResortDigestStats): string {
  const concerns: string[] = [];
  const unknownCount = stats.roomReadyTiming.filter((r) => r.status === "unknown").length;
  const lateCount = stats.roomReadyTiming.filter((r) => r.status === "late").length;

  if (unknownCount) concerns.push(`${unknownCount} חדרים בלי סימון "מוכן"`);
  if (lateCount) concerns.push(`${lateCount} חדרים התעכבו`);
  if (stats.slaCompliance.breachedStillOpen) {
    concerns.push(`${stats.slaCompliance.breachedStillOpen} משימות פתוחות שלא טופלו בזמן`);
  }
  if (stats.anomalies.length) concerns.push(`${stats.anomalies.length} סוויטות עם ריבוי בקשות חוזרות`);

  if (!concerns.length) return "✅ הכל תקין — אין נקודות לתשומת לב מיוחדת בתקופה זו.";
  return `⚠️ לתשומת לבך: ${concerns.join(" | ")}`;
}

const TASK_CATEGORY_LABEL_HE: Record<string, string> = {
  pest_control:    "הדברה",
  guest_amenities: "ציוד לאורח",
  maintenance:     "תחזוקה",
  uncategorized:   "כללי",
};

function taskCategoryLabelHe(category: string): string {
  return TASK_CATEGORY_LABEL_HE[category] ?? category;
}

/**
 * One deterministic action line for the CEO — derived only from computed stats.
 */
export function composeExecutiveActionHint(
  stats: ResortDigestStats,
  quietFallback?: string,
): string {
  const breachedOpen = stats.slaCompliance.breachedStillOpen;
  const unknownRooms = stats.roomReadyTiming.filter((r) => r.status === "unknown");
  const lateRooms = stats.roomReadyTiming.filter((r) => r.status === "late");
  const topAnomaly = stats.anomalies[0];
  const lowSurveys = stats.surveys?.lowScoreCount ?? 0;

  if (breachedOpen > 0) {
    return `👉 מומלץ היום: לבדוק ${breachedOpen} משימות שלא נסגרו ביעד הזמן — בלוח התפעול.`;
  }
  if (unknownRooms.length > 0) {
    const rooms = unknownRooms.slice(0, 3).map((r) => r.room).join(", ");
    const more = unknownRooms.length > 3 ? ` (+${unknownRooms.length - 3})` : "";
    return `👉 מומלץ היום: לוודא סימון «חדר מוכן» — ${rooms}${more}.`;
  }
  if (lateRooms.length > 0) {
    const worst = [...lateRooms].sort((a, b) => (b.lateMinutes ?? 0) - (a.lateMinutes ?? 0))[0];
    return `👉 מומלץ היום: לבדוק איחור במוכנות — ${worst.room} (${worst.lateMinutes} דק').`;
  }
  if (topAnomaly) {
    return `👉 מומלץ היום: ${topAnomaly.room} — ${topAnomaly.count} בקשות ${taskCategoryLabelHe(topAnomaly.category)} באותה תקופה (חריגה חוזרת).`;
  }
  if (lowSurveys > 0) {
    return `👉 מומלץ היום: ${lowSurveys} סקרים עם ציון נמוך — כדאי לעבור על המשוב בלוח.`;
  }
  return quietFallback ?? "👉 מצב שקט — אין פעולה דחופה מהדוח. שאל אותי «מה מצב הריזורט?» לעדכון חי.";
}

export type DigestPeriod = "daily" | "weekly" | "monthly";

const PERIOD_LABELS: Record<DigestPeriod, string> = {
  daily: "יומי",
  weekly: "שבועי",
  monthly: "חודשי",
};

/** Israel-local 00:00 on dateYmd, as a UTC instant. Same fixed-offset convention as automationSchedule.ts (ISRAEL_UTC_OFFSET_HOURS) — no DST adjustment, consistent with how the rest of the cron pipeline resolves local times. */
function israelMidnightUtc(dateYmd: string): Date {
  const utcMidnightMs = new Date(`${dateYmd}T00:00:00.000Z`).getTime();
  return new Date(utcMidnightMs - ISRAEL_UTC_OFFSET_HOURS * 3_600_000);
}

/** dateYmd + N calendar days (noon anchor avoids any UTC-midnight rollover edge case). */
function addDaysYmd(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthYmd(dateYmd: string): string {
  return `${dateYmd.slice(0, 7)}-01`;
}

function firstOfPrevMonthYmd(dateYmd: string): string {
  const [y, m] = dateYmd.slice(0, 7).split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
}

export type DigestRange = {
  /** Ymd stored in resort_digest_log — identifies the period being summarized, for idempotency. */
  periodDate: string;
  /** Inclusive UTC instant. */
  rangeStart: Date;
  /** Exclusive UTC instant. */
  rangeEnd: Date;
  /** Human-readable header for the Hebrew message. */
  label: string;
};

/**
 * Resolves the {periodDate, range, label} for a cron tick, always summarizing a
 * period that has FULLY ended by the time it runs (never "today so far"):
 *   daily   → yesterday's full calendar day (cron runs 07:00 Israel next morning)
 *   weekly  → the 7 days ending yesterday (cron runs Sunday 07:00)
 *   monthly → the previous calendar month (cron runs the 1st, 07:00)
 */
export function resolveDigestRange(period: DigestPeriod, now: Date): DigestRange {
  const todayYmd = israelYmd(now);

  if (period === "daily") {
    const periodDate = addDaysYmd(todayYmd, -1);
    return {
      periodDate,
      rangeStart: israelMidnightUtc(periodDate),
      rangeEnd: israelMidnightUtc(todayYmd),
      label: periodDate,
    };
  }

  if (period === "weekly") {
    const periodDate = addDaysYmd(todayYmd, -7);
    return {
      periodDate,
      rangeStart: israelMidnightUtc(periodDate),
      rangeEnd: israelMidnightUtc(todayYmd),
      label: `${periodDate}–${addDaysYmd(todayYmd, -1)}`,
    };
  }

  const periodDate = firstOfPrevMonthYmd(todayYmd);
  const rangeEndYmd = firstOfMonthYmd(todayYmd);
  return {
    periodDate,
    rangeStart: israelMidnightUtc(periodDate),
    rangeEnd: israelMidnightUtc(rangeEndYmd),
    label: periodDate.slice(0, 7),
  };
}

/**
 * A scannable digest shows the worst few examples, not every row — at real
 * volume (e.g. a weekly period with 150+ arrivals) an uncapped per-item dump
 * turns "smart summary" into an unreadable wall of text. Caller must pre-sort
 * `items` worst-first; this only truncates and appends a "+N more" trailer.
 */
export function formatCappedList<T>(items: T[], formatter: (item: T) => string, max: number): string[] {
  const lines = items.slice(0, max).map(formatter);
  const remaining = items.length - Math.min(items.length, max);
  if (remaining > 0) lines.push(`  ...ועוד ${remaining} נוספים`);
  return lines;
}

/** Max per-item lines shown for any single drill-down list before collapsing to "+N more". */
const MAX_DIGEST_LIST_ITEMS = 5;

/** Rules that mention digests / ops reports — surfaced on the morning push so learning sticks. */
export function filterDigestRelevantRules(ruleTexts: string[]): string[] {
  return ruleTexts
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => /דוח|סיכום|digest|תפעול|הגעות|מוכנות|חריג/i.test(r));
}

export type ComposeResortDigestOpts = {
  /** CEO display name — digest is voiced as their personal assistant. */
  assistantForName?: string;
  /** Learned prefs that apply to this report (already filtered). */
  learnedDigestNotes?: string[];
  /** DB-editable shell fragments. */
  templates?: StaffTemplateMap;
};

/** Composes the Hebrew WhatsApp body in the personal-assistant voice. Deterministic — no LLM. */
export function composeResortDigestMessage(
  stats: ResortDigestStats,
  period: DigestPeriod,
  periodLabel: string,
  opts: ComposeResortDigestOpts = {},
): string {
  const forName = (opts.assistantForName ?? "אליעד").trim() || "אליעד";
  const shellRow = resolveStaffTemplate(opts.templates, STAFF_TEMPLATE_KEYS.ELIAD_DIGEST_SHELL);
  const shell = mergeDigestConfig(ELIAD_DIGEST_SHELL_DEFAULTS, shellRow?.digest_config);

  const lines: string[] = [
    applyStaffMessageTemplate(shell.opening_line, { name: forName }),
    applyStaffMessageTemplate(shell.period_line, {
      period_he: PERIOD_LABELS[period],
      period_label: periodLabel,
    }),
    "",
    composeExecutiveHeadline(stats),
    composeExecutiveActionHint(stats, shell.action_hint_quiet),
  ];

  lines.push("", `הגעות (${stats.arrivals.length}):`);
  if (!stats.arrivals.length) {
    lines.push("  אין הגעות בתקופה זו.");
  } else {
    const counts: Record<ArrivalBucket, number> = { before_15: 0, "15_18": 0, "18_22": 0, after_22: 0 };
    for (const a of stats.arrivals) counts[a.bucket] += 1;
    for (const bucket of Object.keys(BUCKET_LABELS) as ArrivalBucket[]) {
      if (counts[bucket]) lines.push(`  ${BUCKET_LABELS[bucket]}: ${counts[bucket]}`);
    }
  }

  const onTime = stats.roomReadyTiming.filter((r) => r.status === "on_time");
  const late = [...stats.roomReadyTiming.filter((r) => r.status === "late")]
    .sort((a, b) => (b.lateMinutes ?? 0) - (a.lateMinutes ?? 0)); // worst delay first
  const unknown = stats.roomReadyTiming.filter((r) => r.status === "unknown");
  const readyTotal = stats.roomReadyTiming.length;
  const onTimeRate = readyTotal > 0 ? Math.round((onTime.length / readyTotal) * 100) : null;
  const avgLateMinutes = late.length
    ? Math.round(late.reduce((sum, r) => sum + (r.lateMinutes ?? 0), 0) / late.length)
    : null;

  lines.push("", "מוכנות חדרים:");
  lines.push(
    `  בזמן: ${onTime.length}${onTimeRate !== null ? ` (${onTimeRate}%)` : ""}` +
      ` | באיחור: ${late.length}${avgLateMinutes !== null ? ` (ממוצע ${avgLateMinutes} דק')` : ""}` +
      ` | לא סומן ⚠️: ${unknown.length}`,
  );
  lines.push(...formatCappedList(late, (r) => `  ⏰ ${r.room} — איחור ${r.lateMinutes} דק'`, MAX_DIGEST_LIST_ITEMS));
  lines.push(...formatCappedList(unknown, (r) => `  ⚠️ ${r.room} — לא סומן "חדר מוכן"`, MAX_DIGEST_LIST_ITEMS));

  lines.push("", `בקשות צוות לפי סוויטה (${stats.requestsBySuite.length} סוויטות):`);
  if (!stats.requestsBySuite.length) {
    lines.push("  אין בקשות בתקופה זו.");
  } else {
    lines.push(
      ...formatCappedList(
        stats.requestsBySuite, // already sorted by total desc — busiest suites first
        (s) => {
          const rejectedPart = s.rejected ? ` | נדחו ${s.rejected}` : "";
          return `  ${s.room}: ${s.total} (טופלו ${s.resolved} | פתוחות ${s.open}${rejectedPart})`;
        },
        MAX_DIGEST_LIST_ITEMS,
      ),
    );
    const sla = stats.slaCompliance;
    if (sla.complianceRate !== null) {
      const breachedPart = sla.breachedStillOpen
        ? ` | לא בזמן ועדיין פתוחות: ${sla.breachedStillOpen}`
        : "";
      lines.push(
        `  ${shell.sla_label}: ${sla.complianceRate}% (${sla.withinSla}/${sla.withDeadline})${breachedPart}`,
      );
    }
  }

  if (stats.anomalies.length) {
    lines.push("", "🚩 חריגות:");
    lines.push(
      ...formatCappedList(
        stats.anomalies, // already sorted by count desc — worst repeat-offender first
        (a) => `  ${a.room} — ${a.count}× ${taskCategoryLabelHe(a.category)} באותה תקופה`,
        MAX_DIGEST_LIST_ITEMS,
      ),
    );
  }

  if (stats.surveys) {
    const sv = stats.surveys;
    lines.push("", `סקרי חוויית אורח (${sv.count}):`);
    if (!sv.count) {
      lines.push("  אין סקרים בתקופה זו.");
    } else {
      lines.push(
        `  ממוצע חוויה כללית: ${sv.avgOverall !== null ? sv.avgOverall.toFixed(1) : "—"}/10` +
          (sv.lowScoreCount ? ` | ציונים נמוכים: ${sv.lowScoreCount}` : ""),
      );
      lines.push(`  📊 ${STAFF_APP_ORIGIN}/?page=feedback_dashboard&tab=surveys`);
    }
  }

  const notes = (opts.learnedDigestNotes ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 5);
  if (notes.length) {
    lines.push("", "📌 לפי מה שלימדת אותי:");
    for (const n of notes) lines.push(`  • ${n}`);
  }

  lines.push(
    "",
    "—",
    shell.footer_1,
    shell.footer_2,
  );

  return lines.join("\n");
}
