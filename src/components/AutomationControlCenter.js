// src/components/AutomationControlCenter.js
// Unified "Smart Automation Builder & Live Monitor" — admin-only.
//
// Consolidates what used to be split across three places that never
// referenced each other (hardcoded PIPELINE_TEMPLATE maps in
// whatsapp-send/index.ts, bot_scripts content, and the decorative read-only
// timeline diagram in BroadcastDashboard.js) into one editable space backed
// by the automation_stages table (migration 065).
//
// Phase 4 is LIVE: whatsapp-cron (timing — see its own header comment) and
// whatsapp-send (template/session-message/buttons routing — see BRANCH D)
// both already read from automation_stages for every stage except
// room_ready (event-driven from the RoomBoard/AICopilot toggle, no row
// here). Toggling is_active or editing timing/content here changes what
// guests actually RECEIVE, not just what the admin sees.
//
// The one exception (legacy): stage_2_arrival was event_immediate-only until
// migration 127 — it is now hours_after_event and appears in the Live Queue.
// whatsapp-webhook still sends immediately on «כן מגיעים» regardless of offset_hours;
// offset_hours applies to cron/ACC catch-up for guests who confirmed but never received Stage 2.
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import TemplateManagerPanel, { STATUS_META } from "./TemplateManagerPanel";
import TemplateTestPanel from "./TemplateTestPanel";
import ScheduledOverrideConfirmModal from "./ScheduledOverrideConfirmModal";
import QueueBulkScheduleModal from "./QueueBulkScheduleModal";
import QuietHoursGate from "./QuietHoursGate";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";
import { formatIsraelDateTime, isFutureScheduledQueueItem } from "../utils/israelTime";

const JOURNEY_PHASE_LABELS = {
  pre_arrival: "🌴 לפני ההגעה",
  arrival_day: "☀️ יום ההגעה",
  mid_stay:    "🏨 במהלך השהות",
  post_stay:   "⭐ אחרי העזיבה",
};

const NODE_TYPE_META = {
  meta_template:   { label: "תבנית Meta (דורש אישור)", bg: "#E0F2FE", color: "#0369A1" },
  session_message: { label: "הודעת סשן (דינמית וחופשית)", bg: "#E8F5EF", color: "#1A7A4A" },
  hybrid:          { label: "היברידי — סשן או תבנית", bg: "#F3F0FF", color: "#7C3AED" },
};

const APPLIES_TO_LABELS = { all: "כל האורחים", suite: "סוויטות בלבד", non_suite: "לא-סוויטות" };

// Pipeline grouping for Timeline tab — mirrors migration 094/099 bifurcation.
const SHARED_STAGE_KEYS = new Set(["pre_arrival_2d", "stage_2_arrival", "stage_2_pay"]);
const SUITE_PIPELINE_KEYS = new Set([
  "night_before", "morning_suite", "mid_stay", "checkout_fb", "room_ready",
]);
const DAYPASS_PIPELINE_KEYS = new Set([
  "night_before_daypass", "morning_welcome", "mid_stay_daypass", "checkout_fb_daypass",
]);

// Must stay in sync with CORE_PIPELINE_STAGE_KEYS in automationSchedule.ts.
const CORE_PIPELINE_STAGE_KEYS = [
  "pre_arrival_2d",
  "stage_2_arrival",
  "night_before", "night_before_daypass",
  "morning_suite", "morning_welcome",
  "mid_stay", "mid_stay_daypass",
  "checkout_fb", "checkout_fb_daypass",
];

// Live Queue tab — completed rows belong in History only (UI projection filter).
const QUEUE_FINALIZED_STATUSES = new Set(["sent", "simulated", "skipped"]);

/** Permanent ineligibility — never show in live queue (matches automation-queue). */
const QUEUE_HIDDEN_SKIP_REASONS = new Set([
  "wrong_room_type",
  "guest_cancelled",
  "automation_muted",
  "automation_courtesy_only",
  "already_sent",
  "guest_already_departed",
  "missing_anchor_date",
  "missing_anchor_timestamp",
  "unknown_schedule_mode",
  "date_passed",
]);

const SKIP_REASON_LABELS = {
  not_checked_in: "ממתין לצ׳ק-אין",
  not_arrival_day: "לא יום ההגעה",
  not_on_property: "אורח לא בנכס",
  quiet_hours_passed: "עבר חלון השעות",
  staff_claim_active: "שיחה בטיפול צוות",
  awaiting_confirmation: "ממתין לאישור הגעה",
};

function queueYmd(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function isActiveQueueItem(q) {
  if (QUEUE_FINALIZED_STATUSES.has(q.status)) {
    if (q.status === "skipped") return false;
  }
  if (QUEUE_HIDDEN_SKIP_REASONS.has(q.skipReason)) return false;
  return true;
}

function sortQueueItemsByStage(items, stages) {
  const order = new Map(stages.map((s) => [s.stage_key, s.sequence_order ?? 999]));
  return [...items].sort((a, b) => {
    const oa = order.get(a.stageKey) ?? a.sequenceOrder ?? 999;
    const ob = order.get(b.stageKey) ?? b.sequenceOrder ?? 999;
    if (oa !== ob) return oa - ob;
    const ta = a.scheduledFor ? new Date(a.scheduledFor).getTime() : Infinity;
    const tb = b.scheduledFor ? new Date(b.scheduledFor).getTime() : Infinity;
    return ta - tb;
  });
}

function formatArrivalDayHeader(dateKey) {
  if (!dateKey || dateKey === "__none__") return "⚠ ללא תאריך הגעה";
  const todayKey = queueYmd();
  const tomorrowKey = queueYmd(new Date(Date.now() + 86400000));
  const label = new Date(`${dateKey}T12:00:00`).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (dateKey === todayKey) return `היום · ${label}`;
  if (dateKey === tomorrowKey) return `מחר · ${label}`;
  return label;
}

function groupQueueByArrivalDay(items, stages) {
  const dayMap = new Map();
  for (const item of items) {
    const dateKey = item.arrivalDate || "__none__";
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, new Map());
    const guestMap = dayMap.get(dateKey);
    if (!guestMap.has(item.guestId)) {
      guestMap.set(item.guestId, {
        guestId: item.guestId,
        guestName: item.guestName,
        phone: item.phone ?? null,
        room: item.room,
        room_type: item.room_type,
        effectiveSuite: item.effectiveSuite,
        roomTypeConflict: item.roomTypeConflict,
        arrivalDate: item.arrivalDate,
        departureDate: item.departureDate,
        items: [],
      });
    }
    guestMap.get(item.guestId).items.push(item);
  }

  const todayKey = queueYmd();
  return [...dayMap.entries()]
    .sort(([a], [b]) => {
      if (a === "__none__") return 1;
      if (b === "__none__") return -1;
      return a.localeCompare(b);
    })
    .map(([dateKey, guestMap]) => {
      const guests = [...guestMap.values()].map((g) => ({
        ...g,
        items: sortQueueItemsByStage(g.items, stages),
      }));
      guests.sort((a, b) => (a.guestName ?? "").localeCompare(b.guestName ?? "", "he"));
      const itemCount = guests.reduce((n, g) => n + g.items.length, 0);
      return {
        dateKey,
        label: formatArrivalDayHeader(dateKey),
        isPast: dateKey !== "__none__" && dateKey < todayKey,
        isToday: dateKey === todayKey,
        guests,
        itemCount,
      };
    });
}

function formatQueueScheduleCell(q) {
  if (q.scheduledFor) {
    const when = new Date(q.scheduledFor).toLocaleString("he-IL", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    if (q.staffScheduled && isFutureScheduledQueueItem(q)) {
      return (
        <span title={`תזמון צוות: ${formatIsraelDateTime(q.scheduledFor)}`}>
          📅 {when}
        </span>
      );
    }
    return when;
  }
  if (q.skipReason === "awaiting_confirmation") return "מיד לאחר אישור הגעה";
  if (q.stageKey === "stage_2_arrival" && q.dueNow) return "מיידי (אחרי אישור)";
  return "—";
}

function formatQueueAttemptAt(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function queueStatusBadge(q) {
  if (q.status === "sent") return { cls: "badge-green", text: "✅ נשלח" };
  if (q.status === "simulated") return { cls: "badge-green", text: "✅ סימולציה" };
  if (q.status === "duplicate_blocked") return { cls: "badge-orange", text: "🔁 כפילות נחסמה" };
  if (q.status === "blocked_by_meta") return { cls: "badge-orange", text: "🟠 ממתין לאישור" };
  if (q.status === "failed_missing_link") return { cls: "badge-red", text: "❌ חסר קישור תשלום" };
  if (q.dueNow && q.status === "pending") return { cls: "badge-gold", text: "⚡ מוכן לשליחה" };
  if (q.staffScheduled && isFutureScheduledQueueItem(q)) return { cls: "badge-blue", text: "📅 מתוזמן" };
  if (q.skipReason && SKIP_REASON_LABELS[q.skipReason]) {
    return { cls: "badge-blue", text: `🕐 ${SKIP_REASON_LABELS[q.skipReason]}` };
  }
  if (q.status === "failed" || q.status === "timeout") return { cls: "badge-red", text: q.status === "timeout" ? "לא ודאי" : "נכשל" };
  return { cls: "badge-blue", text: "מתוזמן" };
}

/** At-a-glance delivery proof under the status badge (notification_log.sent_at). */
function queueDeliveryProofLine(q) {
  const at = formatQueueAttemptAt(q.lastAttemptAt);
  if (!at) return null;
  if (q.status === "sent" || q.status === "simulated") return `אושר ב־${at}`;
  if (q.status === "failed" || q.status === "timeout" || q.status === "blocked_by_meta" || q.status === "duplicate_blocked") {
    return `ניסיון אחרון: ${at}`;
  }
  return null;
}

/** Guest-level rollup — one badge for the whole automation journey row. */
function summarizeGuestQueueHealth(items) {
  let sent = 0;
  let failed = 0;
  let blocked = 0;
  let dueNow = 0;
  for (const q of items) {
    if (q.status === "sent" || q.status === "simulated") sent += 1;
    else if (q.status === "failed" || q.status === "timeout" || q.status === "failed_missing_link") failed += 1;
    else if (q.status === "blocked_by_meta") blocked += 1;
    else if (q.dueNow && q.status === "pending") dueNow += 1;
  }
  return { sent, failed, blocked, dueNow };
}

/** Meta burst protection — mirrors whatsapp-cron INTER_SEND_DELAY_MS. */
const BULK_SEND_PULSE_MS = 2500;

const STAGE_SHORT_LABELS = {
  pre_arrival_2d: "שלב 1",
  stage_2_arrival: "שלב 2",
  stage_2_pay: "שלב 2 Pay",
  night_before: "שלב 2.5",
  night_before_daypass: "שלב 2.5",
  morning_suite: "שלב 3",
  morning_welcome: "שלב 3",
  morning_daypass: "שלב 3",
  mid_stay: "שלב 4",
  mid_stay_daypass: "שלב 4",
  checkout_fb: "שלב 5",
  checkout_fb_daypass: "שלב 5",
};

function shortStageLabel(displayName, stageKey) {
  return STAGE_SHORT_LABELS[stageKey]
    ?? displayName?.split(/[—–-]/)[0]?.trim()
    ?? stageKey;
}

/**
 * Effective day-pass classification for a queue item/guest group — MUST match
 * server routing (suiteNames.ts / automation-queue's effectiveSuite): a guest
 * whose room is a real suite routes as SUITE even if room_type says day_guest
 * (session 125 P0). Falls back to raw room_type when effectiveSuite is absent
 * (older cached queue payloads).
 */
function isDayPassQueueItem(q) {
  if (q?.effectiveSuite === true) return false;
  return q?.room_type === "day_guest" || q?.room_type === "premium_day_guest";
}

function isQueueItemGated(q, dayPassAllowedStages) {
  return isDayPassQueueItem(q) && !dayPassAllowedStages.has(q.stageKey);
}

/** ⚠ FAIL VISIBLE — suite room + day-pass room_type (server routes as suite). */
function RoomTypeConflictBadge({ compact = false }) {
  return (
    <span
      className="badge badge-orange"
      title="סתירת סיווג: החדר הוא סוויטה אך סוג האורח מסומן יום-כיף — השרת מנתב כסוויטה. ערוך את האורח ותקן את סוג החדר."
      style={{ whiteSpace: "nowrap" }}
    >
      ⚠ {compact ? "סתירה" : "סתירת סיווג"}
    </span>
  );
}

/** Per-day chips: one entry per stage_key with dispatchable item keys. */
function buildDayStageChips(day, isDispatchable, dayPassAllowedStages) {
  const byStage = new Map();
  for (const guest of day.guests) {
    for (const q of guest.items) {
      if (!isDispatchable(q) || isQueueItemGated(q, dayPassAllowedStages)) continue;
      const itemKey = `${q.guestId}_${q.stageKey}`;
      if (!byStage.has(q.stageKey)) {
        byStage.set(q.stageKey, {
          stageKey: q.stageKey,
          displayName: q.displayName,
          sequenceOrder: q.sequenceOrder ?? 999,
          itemKeys: [],
        });
      }
      byStage.get(q.stageKey).itemKeys.push(itemKey);
    }
  }
  return [...byStage.values()].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
}

function attentionItemKey(r) {
  return `${r.phone}_${r.stageKey}_${r.sentAt}`;
}

/** Stages whatsapp-cron polls (excludes legacy event_immediate). */
function isCronScheduledStage(stage) {
  return !!stage?.is_active && stage.schedule_mode !== "event_immediate";
}

/** Live Queue visibility — cron stages + Stage 2 (immediate on «כן מגיעים»). */
const QUEUE_ALWAYS_VISIBLE_STAGE_KEYS = new Set(["stage_2_arrival", "stage_2_pay"]);

function isQueueVisibleStage(stage) {
  if (!stage?.is_active) return false;
  if (QUEUE_ALWAYS_VISIBLE_STAGE_KEYS.has(stage.stage_key)) return true;
  return stage.schedule_mode !== "event_immediate";
}

/** Align Live Queue rows with current automation_stages (is_active + labels). */
function mergeQueueWithStages(queue, stages) {
  const activeCronKeys = new Set(
    stages.filter(isQueueVisibleStage).map((s) => s.stage_key),
  );
  const stageByKey = Object.fromEntries(stages.map((s) => [s.stage_key, s]));
  return (queue ?? [])
    .filter((q) => activeCronKeys.has(q.stageKey))
    .map((q) => {
      const stage = stageByKey[q.stageKey];
      return {
        ...q,
        displayName: stage?.display_name ?? q.displayName,
        journeyPhase: stage?.journey_phase ?? q.journeyPhase,
        nodeType: stage?.node_type ?? q.nodeType,
      };
    });
}

function classifyStagePipeline(stage) {
  if (SHARED_STAGE_KEYS.has(stage.stage_key)) return "shared";
  if (DAYPASS_PIPELINE_KEYS.has(stage.stage_key) || stage.applies_to === "non_suite") return "daypass";
  if (SUITE_PIPELINE_KEYS.has(stage.stage_key) || stage.applies_to === "suite") return "suite";
  return "other";
}

const PIPELINE_SECTION_META = {
  shared:  { icon: "🔗", label: "שלבים משותפים (כל האורחים)", border: "var(--gold)",       bg: "rgba(201,169,110,0.08)" },
  suite:   { icon: "🏨", label: "צינור סוויטות",              border: "#0369A1",           bg: "rgba(3,105,161,0.06)" },
  daypass: { icon: "☀️", label: "צינור בילוי יומי",           border: "#7C3AED",           bg: "rgba(124,58,237,0.06)" },
  other:   { icon: "⚙️", label: "שלבים נוספים",               border: "var(--border)",     bg: "rgba(0,0,0,0.02)" },
};

// Session 30 Sprint 5.1 — manager-facing translation for the raw bot_scripts
// script_key tokens shown in the session-message dropdown. Same FAIL VISIBLE
// fallback convention as metaTemplateFriendly() below: an untranslated key
// still renders (prefixed "⚠") instead of silently showing the raw snake_case
// token, so a future script_key added without an entry here is still usable,
// just visibly unpolished rather than broken.
const SCRIPT_KEY_FRIENDLY = {
  stage_3_morning:          "הודעת בוקר (שלב 3)",
  complaint_reply:          "מענה לתלונה",
  negative_feedback_reply:  "מענה למשוב שלילי",
  upsell_reply:             "הצעת שדרוג (Upsell)",
  fallback_reply:           "מענה ברירת מחדל (Fallback)",
  greeting_reply:           "ברכת פתיחה — היי / שלום",
  positive_feedback_reply:  "מענה למשוב חיובי",
  upsell_accepted_reply:    "אישור קבלת שדרוג",
  upsell_decline_reply:     "סירוב לשדרוג",
  ongoing_concierge:        "שיח קונסיירג׳ שוטף",
  stage_2_arrival:          "הודעת הגעה (שלב 2)",
  callback_reply:           "מענה לבקשת חזרה טלפונית",
  spa_menu:                 "תפריט טיפולי ספא",
  stage_2_payment_reply:    "מענה לתשלום (שלב 2)",
  night_before_reminder:    "תזכורת ערב לפני — כניסה ושעות (שלב 2.5)",
  pre_arrival_2d:           "פנייה ראשונה — אישור הגעה (שלב 1 — טקסט חופשי)",
  mid_stay:                 "בדיקת שלום באמצע השהות (שלב 4 — טקסט חופשי)",
  mid_stay_daypass:         "בדיקת שלום באמצע הביקור (שלב 4 — בילוי יומי)",
  checkout_fb:              "בקשת משוב לאחר העזיבה (שלב 5 — טקסט חופשי)",
  checkout_fb_daypass:      "בקשת משוב לאחר הביקור (שלב 5 — בילוי יומי)",
  night_before_daypass:     "תזכורת ערב לפני — בילוי יומי (שלב 2.5)",
  morning_daypass:          "בוקר הגעה — בילוי יומי (שלב 3)",
};
function scriptKeyFriendly(key) {
  return SCRIPT_KEY_FRIENDLY[key] ?? `⚠ ${key}`;
}

// Manager-facing description per Meta template — raw tokens like
// "dream_arrival_confirmation" mean nothing to a non-technical resort
// manager. FAIL VISIBLE fallback: an unmapped template shows "⚠ raw_name"
// rather than disappearing, same convention as STATUS_META in GuestsPage.js.
const META_TEMPLATE_FRIENDLY = {
  dream_arrival_confirmation:    "פנייה ראשונה — בקשת אישור הגעה (יומיים לפני ההגעה)",
  dream_checkin_reminder_v2:     "תזכורת ערב לפני ההגעה",
  suite_welcome_morning:         "ברכת בוקר ביום ההגעה",
  suite_welcome_morning_shabbat: "ברכת בוקר ביום ההגעה (שבת)",
  dream_room_ready:              "מסירת מפתח — החדר מוכן (אישור מנהל)",
  dream_mid_stay_check:          "בדיקת שלום באמצע השהות",
  dream_checkout_feedback:       "בקשת משוב לאחר העזיבה",
  dream_payment_and_workshops:   "תשלום יתרה + הרשמה לסדנאות",
  dream_suite_reminder:          "תזכורת סוויטה — IMAGE header",
  night_before_suites:           "ערב לפני — סוויטות (יום חול)",
  night_before_suites_shabbat:   "ערב לפני — סוויטות (שבת/חג)",
};
function metaTemplateFriendly(name) {
  return META_TEMPLATE_FRIENDLY[name] ?? `⚠ ${name}`;
}

function timeInputValue(pgTime) {
  return pgTime ? String(pgTime).slice(0, 5) : "";
}

// ── Live preview helpers ─────────────────────────────────────────────────────
// Frontend-only sample resolver for the manager-facing preview box below.
// Deliberately separate from whatsapp-webhook/index.ts's resolvePlaceholders()/
// resolvePaymentPlaceholders() — zero shared code, same convention those two
// already use between each other — so nothing here can ever affect what a
// real guest receives. Mirrors their exact SPA_LINE/OPTIONAL_SPA_TEXT/
// SPA_TIME wording so the preview looks like the real thing.
const SAMPLE_VALUES = {
  GUEST_NAME: "דניאל כהן",
  WORKSHOP_URL: "https://dream-island.co.il/workshops",
  PAYMENT_LINK: "https://pay.dream-island.co.il/abc123",
  PAYMENT_AMOUNT: "450",
  GOOGLE_REVIEW_URL: "https://g.page/r/dream-island/review",
  // Stage 2.5 (night_before_reminder) — whatsapp-send's resolveNightBeforeTimes()
  // picks weekday (12:00/15:00) vs Shabbat/holiday (bot_config-driven) hours per
  // real guest arrival date. This preview has no guest/date behind it, so it
  // always shows the weekday pair labeled as a sample — not a live render of
  // either branch. Display-only; never read by the real sender.
  ENTRY_TIME: "12:00 (יום חול — דוגמה)",
  CHECK_IN_TIME: "15:00 (יום חול — דוגמה)",
};

// Stage keys that route their Meta template deterministically by arrival day-of-week.
// These stages no longer use positional time variables {{2}}/{{3}} — the correct
// entry/check-in times are baked directly into the approved template body text
// (separate weekday vs Shabbat templates), so manual variable injection in the UI
// is both unnecessary and misleading. The auto-fill panel is replaced by a
// read-only routing info panel for these stage keys.
const DETERMINISTIC_ROUTE_STAGE_KEYS = new Set(["night_before", "morning_suite", "morning_welcome"]);
function resolveSampleText(template) {
  if (!template) return "";
  const sampleSpaTime = "14:00";
  return template
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, SAMPLE_VALUES.GUEST_NAME)
    .replace(/\{\{\s*WORKSHOP_URL\s*\}\}/gi, SAMPLE_VALUES.WORKSHOP_URL)
    .replace(/\{\{\s*PAYMENT_LINK\s*\}\}/gi, SAMPLE_VALUES.PAYMENT_LINK)
    .replace(/\{\{\s*PAYMENT_AMOUNT\s*\}\}/gi, SAMPLE_VALUES.PAYMENT_AMOUNT)
    .replace(/\{\{\s*GOOGLE_REVIEW_URL\s*\}\}/gi, SAMPLE_VALUES.GOOGLE_REVIEW_URL)
    .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, `מתואם לכם טיפול בספא בשעה ${sampleSpaTime}. בנוסף, `)
    .replace(/\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/gi, `מתואם לכם טיפול בספא בשעה ${sampleSpaTime}.\n`)
    .replace(/\{\{\s*SPA_TIME\s*\}\}/gi, `הטיפול שלכם בספא מתואם לשעה ${sampleSpaTime}`)
    .replace(/\{\{\s*entry_time\s*\}\}/gi, SAMPLE_VALUES.ENTRY_TIME)
    .replace(/\{\{\s*check_in_time\s*\}\}/gi, SAMPLE_VALUES.CHECK_IN_TIME);
}

// Highlights any {{TOKEN}} surviving resolveSampleText (typo or unsupported
// placeholder) so an admin catches it before a real guest would receive it
// raw — same FAIL VISIBLE convention as metaTemplateFriendly()'s "⚠ raw_name"
// fallback above.
function renderResolvedPreview(template) {
  const resolved = resolveSampleText(template);
  const parts = resolved.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) =>
    /^\{\{[^}]+\}\}$/.test(part) ? (
      <span key={i} title="placeholder לא מוכר — ייתכן שיישלח גולמי לאורח" style={{
        background: "#FFE5E5", color: "#C0392B", padding: "0 4px", borderRadius: 4, fontWeight: 700,
      }}>⚠ {part}</span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function MessagePreviewBubble({ children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>
        👁️ תצוגה מקדימה — כך האורח יראה את ההודעה (דוגמה)
      </div>
      <div style={{
        background: "#DCF8C6", borderRadius: "10px 10px 10px 2px", padding: "10px 14px",
        fontSize: 13, lineHeight: 1.7, direction: "rtl", whiteSpace: "pre-wrap", maxWidth: 420,
        boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
      }}>
        {children}
      </div>
    </div>
  );
}

function ButtonChipsPreview({ buttons }) {
  const visible = (buttons ?? []).filter((b) => b.label?.trim());
  if (visible.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, maxWidth: 420 }}>
      {visible.map((b, i) => (
        <div key={i} style={{
          textAlign: "center", padding: "8px 12px", background: "#fff",
          border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, color: "#0a84ff",
        }}>
          {b.type === "url" ? "🔗" : "↩️"} {b.label}
        </div>
      ))}
    </div>
  );
}

// Read-only Meta template body preview — same visual pattern as
// TemplateManagerPanel.js's template list, reused via the shared STATUS_META
// import rather than forking a second badge-color definition.
//
// previewTimings is kept in the signature for forward-compatibility but is
// always null — arrival stages now route deterministically (separate Shabbat/
// weekday templates), so {{2}}/{{3}} no longer exist as template variables.
// resolveMetaBodyPreview short-circuits on null and shows the raw body text.
function MetaTemplatePreviewBox({ stage, metaTemplatesByName, previewTimings }) {
  const tmpl = metaTemplatesByName[stage.meta_template_name];
  if (!tmpl) {
    return (
      <div style={{ fontSize: 12, color: "#C0392B", background: "#FFF0EE", borderRadius: 8, padding: "8px 12px", marginTop: 8 }}>
        ⚠ לא נמצאה תבנית בשם זה ב-Meta — נסה לסנכרן בלשונית "תבניות Meta"
      </div>
    );
  }
  const st = STATUS_META[tmpl.status] ?? STATUS_META.PENDING;
  const isApproved = tmpl.status === "APPROVED";

  // Resolve {{1}}/{{2}}/{{3}} only when the admin has clicked "Auto-fill".
  // {{1}} is always guest name; {{2}}/{{3}} are time slots — correct mapping
  // per whatsapp-send's PIPELINE_VARS (session 56). Previous wrong mapping
  // (Room → {{2}}, Date → {{3}}) is eliminated by never substituting those.
  const resolveMetaBodyPreview = (text) => {
    if (!text || !previewTimings) return text;
    return text
      .replace(/\{\{1\}\}/g, SAMPLE_VALUES.GUEST_NAME)
      .replace(/\{\{2\}\}/g, previewTimings.entryTime)
      .replace(/\{\{3\}\}/g, previewTimings.checkInTime);
  };

  const displayBody = previewTimings ? resolveMetaBodyPreview(tmpl.bodyText) : tmpl.bodyText;

  return (
    <div style={{ marginTop: 8 }}>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
        background: isApproved ? "#E8F5EF" : st.bg,
        color: isApproved ? "#1A7A4A" : st.color,
        border: `1px solid ${isApproved ? "#1A7A4A" : st.border}`,
      }}>
        {isApproved ? "✅ תבנית META מאושרת — לקריאה בלבד" : st.label}
      </span>
      {tmpl.bodyText && (
        <div style={{
          fontSize: 12, color: "#444", background: "var(--ivory)", borderRadius: 8,
          padding: "8px 12px", lineHeight: 1.6, maxHeight: 100, overflowY: "auto", marginTop: 6,
          direction: tmpl.language === "he" || tmpl.language === "ar" ? "rtl" : "ltr",
          textAlign: tmpl.language === "he" || tmpl.language === "ar" ? "right" : "left",
        }}>
          {displayBody}
        </div>
      )}
      {tmpl.buttons?.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {tmpl.buttons.map((b, i) => (
            <span key={i} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 14, background: "#EFF6FF", color: "#1E40AF", border: "1px solid #93C5FD" }}>
              {b.type === "URL" ? "🔗" : "↩️"} {b.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Extracted from the inline stages.map() body so the live-preview draft text
// can have its own useState — hooks can't be called conditionally inside a
// .map() callback, but a dedicated component per list item is exactly what
// hooks rules expect.
function StageCard({
  stage, isOpen, onToggle, patchStage, scriptsByKey, saveSessionMessage,
  availableScriptKeys, addButton, updateButton, removeButton, convertToTemplate,
  metaTemplatesByName,
}) {
  const nt = NODE_TYPE_META[stage.node_type] ?? NODE_TYPE_META.hybrid;
  const phaseLabel = JOURNEY_PHASE_LABELS[stage.journey_phase] ?? stage.journey_phase;
  const savedScriptText = scriptsByKey[stage.session_message_script_key] ?? "";

  // Local draft so the preview below updates live as the admin types, without
  // changing when the actual Supabase write happens (still on blur, via
  // saveSessionMessage — unchanged from before this feature existed).
  const [draftText, setDraftText] = useState(savedScriptText);
  useEffect(() => { setDraftText(savedScriptText); }, [stage.session_message_script_key, savedScriptText]);

  // Same deferred-save-on-blur pattern as draftText above, but this one
  // patches automation_stages directly (session_message_image_url lives on
  // that row, not in bot_scripts) — reuses patchStage, no new save helper.
  const [draftImageUrl, setDraftImageUrl] = useState(stage.session_message_image_url ?? "");
  useEffect(() => { setDraftImageUrl(stage.session_message_image_url ?? ""); }, [stage.session_message_image_url]);

  // Auto-fill state removed — arrival stages route deterministically via
  // DETERMINISTIC_ROUTE_STAGE_KEYS; no manual {{2}}/{{3}} injection needed.

  return (
    <div className="card" style={{ marginBottom: 12, opacity: stage.is_active ? 1 : 0.6, border: isOpen ? "1px solid var(--gold)" : undefined }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", cursor: "pointer", borderBottom: isOpen ? "1px solid var(--border)" : "none" }}
        onClick={onToggle}
      >
        <span style={{ fontSize: 14, color: "var(--text-muted)", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▶</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{stage.display_name}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, color: "#92702C", background: "rgba(201,169,110,0.15)" }}>{phaseLabel}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, color: nt.color, background: nt.bg }}>{nt.label}</span>
          </div>
        </div>
        <div
          onClick={(e) => { e.stopPropagation(); patchStage(stage, { is_active: !stage.is_active }); }}
          style={{ width: 44, height: 24, borderRadius: 12, cursor: "pointer", background: stage.is_active ? "var(--gold)" : "#D1D5DB", position: "relative", flexShrink: 0 }}
        >
          <div style={{ position: "absolute", top: 3, borderRadius: "50%", width: 18, height: 18, background: "#fff", right: stage.is_active ? 3 : "auto", left: stage.is_active ? "auto" : 3, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
        </div>
      </div>

      {isOpen && (
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* ── Timing ── */}
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: "block" }}>⏱ תזמון</label>
            {stage.schedule_mode === "day_offset_with_time" && (
              <div className="actr-timing-row" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {stage.anchor_event === "departure_date" ? "יחסית לתאריך עזיבה" : "יחסית לתאריך הגעה"}
                </span>
                <input type="number" value={stage.day_offset ?? 0} style={{ width: 70 }}
                  onChange={(e) => patchStage(stage, { day_offset: parseInt(e.target.value, 10) || 0 })} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>ימים, משעה</span>
                <input type="time" value={timeInputValue(stage.local_time)} style={{ width: 110 }}
                  onChange={(e) => patchStage(stage, { local_time: e.target.value || null })} />
                {stage.stage_key === "night_before" && (
                  <>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>עד שעה (שקט לילי)</span>
                    <input type="time" value={timeInputValue(stage.local_time_end)} style={{ width: 110 }}
                      onChange={(e) => patchStage(stage, { local_time_end: e.target.value || null })} />
                  </>
                )}
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(שעון ישראל)</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                  (0 = יום ההגעה/הנוכחות, מספר שלילי = ימים לפני ההגעה)
                </span>
              </div>
            )}
            {stage.schedule_mode === "hours_after_event" && (
              <div className="actr-timing-row" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {stage.offset_hours ?? 0} שעות אחרי {stage.anchor_event === "checkin_time" ? "צ׳ק-אין" : "אישור הגעה"}
                </span>
                <input type="number" value={stage.offset_hours ?? 0} style={{ width: 70 }}
                  onChange={(e) => patchStage(stage, { offset_hours: parseInt(e.target.value, 10) || 0 })} />
              </div>
            )}
            {stage.schedule_mode === "event_immediate" && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>מופעל אוטומטית בתגובה ישירה — אין תזמון יומי</span>
            )}
          </div>

          {/* ── Stage 4 check-in gate (mid_stay suites only) ── */}
          {stage.stage_key === "mid_stay" && (() => {
            const requireCheckedIn = stage.require_checked_in !== false;
            return (
              <div style={{
                padding: "12px 14px", borderRadius: 10,
                border: `1px solid ${requireCheckedIn ? "var(--border)" : "var(--gold)"}`,
                background: requireCheckedIn ? "rgba(0,0,0,0.02)" : "rgba(201,169,110,0.08)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>🛎️ דרוש צ׳ק-אין לפני שליחה (שלב 4)</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
                      {requireCheckedIn
                        ? "פעיל — ההודעה תישלח רק לאורחים בסטטוס «צ׳ק-אין». מתאים כשהצוות מעדכן סטטוסים בזמן."
                        : "כבוי — ההודעה תישלח לפי תזמון בלבד, גם בלי צ׳ק-אין. מתאים לתקופת הסנכרון עם הצוות."}
                    </div>
                  </div>
                  <div
                    role="switch"
                    aria-checked={requireCheckedIn}
                    title={requireCheckedIn ? "כבה — שלח לפי תזמון בלבד" : "הפעל — דרוש צ׳ק-אין"}
                    onClick={(e) => { e.stopPropagation(); patchStage(stage, { require_checked_in: !requireCheckedIn }); }}
                    style={{
                      width: 44, height: 24, borderRadius: 12, cursor: "pointer", flexShrink: 0,
                      background: requireCheckedIn ? "var(--gold)" : "#D1D5DB",
                      position: "relative",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 3, borderRadius: "50%", width: 18, height: 18,
                      background: "#fff", right: requireCheckedIn ? 3 : "auto", left: requireCheckedIn ? "auto" : 3,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }} />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Applies to ── */}
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>חל על</label>
            <select value={stage.applies_to} onChange={(e) => patchStage(stage, { applies_to: e.target.value })}>
              {Object.entries(APPLIES_TO_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {/* ── Session message (only for session_message/hybrid) ── */}
          {stage.node_type !== "meta_template" && (
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>🟢 הודעת סשן (חופשית, בתוך חלון 24ש׳)</label>
              <select
                value={stage.session_message_script_key ?? ""}
                onChange={(e) => patchStage(stage, { session_message_script_key: e.target.value || null })}
                style={{ marginBottom: 8 }}
              >
                <option value="">— ללא (יפול ישר לתבנית Meta) —</option>
                {availableScriptKeys.map((k) => <option key={k} value={k}>{scriptKeyFriendly(k)}</option>)}
              </select>
              {stage.session_message_script_key && (
                <>
                  <textarea
                    rows={4}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    onBlur={(e) => saveSessionMessage(stage.session_message_script_key, e.target.value)}
                    style={{ direction: "rtl", fontFamily: "Heebo, sans-serif", lineHeight: 1.7, resize: "vertical", width: "100%" }}
                  />
                  <div style={{ marginTop: 10 }}>
                    <MessagePreviewBubble>{renderResolvedPreview(draftText)}</MessagePreviewBubble>
                    <ButtonChipsPreview buttons={stage.interactive_buttons} />
                  </div>
                  <div className="form-field" style={{ marginTop: 10, marginBottom: 0 }}>
                    <label style={{ fontSize: 12 }}>🖼️ תמונה מצורפת (אופציונלי — נשלחת כ-image message, ללא כפתורים)</label>
                    <input
                      type="text"
                      value={draftImageUrl}
                      onChange={(e) => setDraftImageUrl(e.target.value)}
                      onBlur={(e) => patchStage(stage, { session_message_image_url: e.target.value.trim() || null })}
                      placeholder="https://dream-ai-system.vercel.app/images/..."
                      style={{ direction: "ltr", fontFamily: "monospace", fontSize: 12 }}
                    />
                    {draftImageUrl && (
                      <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                        תצוגה מקדימה: <a href={draftImageUrl} target="_blank" rel="noreferrer">{draftImageUrl}</a>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Meta template selector — editable dropdown, saves to automation_stages.meta_template_name ── */}
          {/* The 24h-window override happens in whatsapp-send (BRANCH D): if the guest's             */}
          {/* wa_window_expires_at is still open, a session_message is sent instead of this template. */}
          {/* This dropdown controls only the Meta-template fallback path (window closed / hybrid).   */}
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>🔵 תבנית Meta (Fallback)</label>
            {(() => {
              // Build option list: all templates from the live Meta fetch.
              // Non-approved templates are kept so the current selection always
              // appears in the list (FAIL VISIBLE — no silent disappearance).
              const allOptions = Object.values(metaTemplatesByName).map((t) => ({
                name: t.name,
                approved: t.status === "APPROVED",
              }));
              // If the current value isn't in the live list (e.g. newly registered
              // but not yet fetched), keep it visible as a PENDING fallback row.
              const currentInList = allOptions.some((o) => o.name === stage.meta_template_name);
              if (stage.meta_template_name && !currentInList) {
                allOptions.push({ name: stage.meta_template_name, approved: false });
              }
              allOptions.sort((a, b) => (b.approved ? 1 : 0) - (a.approved ? 1 : 0) || a.name.localeCompare(b.name));
              return (
                <select
                  value={stage.meta_template_name ?? ""}
                  onChange={(e) => patchStage(stage, { meta_template_name: e.target.value || null })}
                  style={{ marginBottom: 6 }}
                >
                  <option value="">— ללא תבנית Meta —</option>
                  {allOptions.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.approved ? "✅" : "⏳"} {metaTemplateFriendly(o.name)}
                      {" — "}{o.name}
                    </option>
                  ))}
                </select>
              );
            })()}
            {stage.meta_template_name && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                טכני: <code style={{ background: "#F3F4F6", padding: "2px 6px", borderRadius: 4 }}>{stage.meta_template_name}</code>
                {" — "}ערוך תוכן בלשונית &quot;📋 תבניות Meta&quot;
              </div>
            )}
            {/* Deterministic routing info — night_before / morning_suite / morning_welcome.
                Template selection is automatic (arrival day-of-week → template name).
                Variables {{2}}/{{3}} are removed; times are baked into the template body. */}
            {stage.meta_template_name && DETERMINISTIC_ROUTE_STAGE_KEYS.has(stage.stage_key) && (
              <div style={{
                marginTop: 10, padding: "10px 14px",
                background: "rgba(124,58,237,0.06)", borderRadius: 8,
                border: "1px solid #C4B5FD",
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "#7C3AED" }}>
                  🗓️ ניתוב אוטומטי לפי יום הגעה — ללא הזנה ידנית
                </div>
                {stage.stage_key === "night_before" ? (
                  <div style={{ fontSize: 11, color: "#555", lineHeight: 1.8 }}>
                    📅 ראשון–שישי →{" "}
                    <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>night_before_suites</code>
                    <br />
                    🕍 שבת →{" "}
                    <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>night_before_suites_shabbat</code>
                    <br />
                    <span style={{ color: "var(--text-muted)" }}>
                      שליחה אוטומטית (cron) תמיד דרך תבנית Meta — גם בתוך חלון 24ש&apos;. סקריפט חופשי רק בשגר ידני → ערוץ Bot Script.
                    </span>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "#555", lineHeight: 1.8 }}>
                    📅 ראשון–שישי →{" "}
                    <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>suite_welcome_morning</code>
                    <br />
                    🕍 שבת →{" "}
                    <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>suite_welcome_morning_shabbat</code>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#92702C", marginTop: 6, fontStyle: "italic" }}>
                  משתנים {"{{2}}"} / {"{{3}}"} הוסרו — השעות מוטמעות בגוף התבנית המאושרת.
                </div>
              </div>
            )}

            {stage.meta_template_name && (
              <MetaTemplatePreviewBox
                stage={stage}
                metaTemplatesByName={metaTemplatesByName}
                previewTimings={null}
              />
            )}
          </div>

          {/* ── Interactive buttons (session-message side only) ── */}
          {stage.node_type !== "meta_template" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>כפתורים אינטראקטיביים (עד 3)</label>
                <button className="btn btn-ghost btn-sm" onClick={() => addButton(stage)} disabled={(stage.interactive_buttons ?? []).length >= 3}>➕ הוסף</button>
              </div>
              {(stage.interactive_buttons ?? []).map((b, idx) => (
                <div key={idx} className="actr-btn-row" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <select value={b.type} onChange={(e) => updateButton(stage, idx, { type: e.target.value })} style={{ width: 130 }}>
                    <option value="quick_reply">תגובה מהירה</option>
                    <option value="url">קישור</option>
                  </select>
                  <input type="text" placeholder="טקסט הכפתור" value={b.label}
                    onChange={(e) => updateButton(stage, idx, { label: e.target.value })} style={{ flex: 1 }} />
                  {b.type === "url" && (
                    <input type="text" placeholder="https://..." value={b.url ?? ""}
                      onChange={(e) => updateButton(stage, idx, { url: e.target.value })} style={{ flex: 1, direction: "ltr" }} />
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => removeButton(stage, idx)} style={{ color: "#C0392B" }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {stage.meta_template_name && stage.node_type !== "meta_template" && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary btn-sm" onClick={() => convertToTemplate(stage)}>
                🔁 המר לתבנית Meta
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Linear Automation Flow Builder — Session 27 Sprint 4.4. Lightweight, separate
// from the automation_stages timeline above: this is a draft layer (migration
// 078's custom_automations/custom_automation_steps) for sketching an ad-hoc
// multi-step sequence — name, trigger timing, ordered steps each either a Meta
// template or free text. Not wired to whatsapp-cron/whatsapp-send — capturing
// the design is the scope of this sprint, runtime dispatch is a future step.
// ══════════════════════════════════════════════════════════════════════════════
function blankStep() {
  return { step_type: "free_text", meta_template_name: "", free_text: "" };
}

function CustomAutomationBuilder({ metaTemplatesByName, showToast }) {
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [anchorEvent, setAnchorEvent] = useState("arrival_date");
  const [dayOffset, setDayOffset] = useState(0);
  const [localTime, setLocalTime] = useState("09:00");
  const [steps, setSteps] = useState([blankStep()]);

  const approvedTemplateNames = Object.values(metaTemplatesByName)
    .filter((t) => t.status === "APPROVED")
    .map((t) => t.name);

  const fetchAutomations = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("custom_automations")
      .select("*, custom_automation_steps(*)")
      .order("created_at", { ascending: false });
    if (error) showToast("err", "שגיאה בטעינת אוטומציות: " + error.message);
    else setAutomations(data ?? []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { fetchAutomations(); }, [fetchAutomations]);

  const addStep    = () => setSteps((prev) => [...prev, blankStep()]);
  const updateStep = (idx, patch) => setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const removeStep = (idx) => setSteps((prev) => prev.filter((_, i) => i !== idx));

  const resetForm = () => {
    setName(""); setAnchorEvent("arrival_date"); setDayOffset(0); setLocalTime("09:00");
    setSteps([blankStep()]);
  };

  const handleSave = async () => {
    if (!name.trim()) return showToast("err", "יש לתת שם לאוטומציה");
    for (const s of steps) {
      if (s.step_type === "meta_template" && !s.meta_template_name) return showToast("err", "יש לבחור תבנית Meta לכל שלב מסוג זה");
      if (s.step_type === "free_text" && !s.free_text.trim()) return showToast("err", "יש למלא תוכן לכל שלב טקסט חופשי");
    }
    setSaving(true);
    try {
      const { data: automation, error: autoErr } = await supabase
        .from("custom_automations")
        .insert([{
          name: name.trim(),
          trigger_anchor_event: anchorEvent,
          trigger_day_offset: dayOffset,
          trigger_local_time: localTime || null,
        }])
        .select()
        .single();
      if (autoErr) throw new Error(autoErr.message);

      const stepRows = steps.map((s, i) => ({
        automation_id: automation.id,
        step_order: i,
        step_type: s.step_type,
        meta_template_name: s.step_type === "meta_template" ? s.meta_template_name : null,
        free_text: s.step_type === "free_text" ? s.free_text.trim() : null,
      }));
      const { error: stepsErr } = await supabase.from("custom_automation_steps").insert(stepRows);
      if (stepsErr) throw new Error(stepsErr.message);

      showToast("ok", `✅ האוטומציה "${name.trim()}" נשמרה`);
      resetForm();
      fetchAutomations();
    } catch (e) {
      showToast("err", "שגיאה בשמירה: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, automationName) => {
    const { error } = await supabase.from("custom_automations").delete().eq("id", id);
    if (error) showToast("err", "שגיאה במחיקה: " + error.message);
    else {
      showToast("ok", `🗑️ "${automationName}" נמחקה`);
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginBottom: 24, borderColor: "var(--gold)" }}>
        <div className="card-header"><div className="card-title">✨ יצירת אוטומציה חדשה</div></div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>שם האוטומציה *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: רצף יום הולדת VIP" />
          </div>

          <div>
            <label style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: "block" }}>⏱ תזמון הפעלה</label>
            <div className="actr-timing-row" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <select value={anchorEvent} onChange={(e) => setAnchorEvent(e.target.value)}>
                <option value="arrival_date">יחסית לתאריך הגעה</option>
                <option value="departure_date">יחסית לתאריך עזיבה</option>
              </select>
              <input type="number" value={dayOffset} style={{ width: 70 }}
                onChange={(e) => setDayOffset(parseInt(e.target.value, 10) || 0)} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>ימים, משעה</span>
              <input type="time" value={localTime} style={{ width: 110 }}
                onChange={(e) => setLocalTime(e.target.value)} />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(שעון ישראל)</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                (0 = יום ההגעה/הנוכחות, מספר שלילי = ימים לפני ההגעה)
              </span>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>שלבים (לפי סדר ריצה)</label>
              <button className="btn btn-ghost btn-sm" onClick={addStep}>➕ הוסף שלב</button>
            </div>
            {steps.map((s, idx) => (
              <div key={idx} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", minWidth: 22 }}>#{idx + 1}</span>
                  <select value={s.step_type} onChange={(e) => updateStep(idx, { step_type: e.target.value })} style={{ flex: 1 }}>
                    <option value="meta_template">🔵 תבנית Meta</option>
                    <option value="free_text">🟢 טקסט חופשי</option>
                  </select>
                  <button
                    className="btn btn-ghost btn-sm" onClick={() => removeStep(idx)}
                    disabled={steps.length === 1} style={{ color: "#C0392B" }}
                  >✕</button>
                </div>
                {s.step_type === "meta_template" ? (
                  <select value={s.meta_template_name} onChange={(e) => updateStep(idx, { meta_template_name: e.target.value })}>
                    <option value="">— בחר תבנית מאושרת —</option>
                    {approvedTemplateNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <textarea
                    rows={3} value={s.free_text}
                    onChange={(e) => updateStep(idx, { free_text: e.target.value })}
                    placeholder="תוכן ההודעה החופשית..."
                    style={{ direction: "rtl", width: "100%", resize: "vertical", fontFamily: "Heebo, sans-serif" }}
                  />
                )}
              </div>
            ))}
          </div>

          <button className="btn btn-primary" disabled={saving} onClick={handleSave} style={{ alignSelf: "flex-end", minWidth: 160 }}>
            {saving ? "⏳ שומר..." : "💾 שמור אוטומציה"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">📂 אוטומציות שמורות ({automations.length})</div></div>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>⏳ טוען...</div>
        ) : automations.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            אין עדיין אוטומציות מותאמות שמורות
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {automations.map((a, i) => (
              <div key={a.id} style={{ padding: "14px 20px", borderBottom: i < automations.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}</div>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(a.id, a.name)} style={{ color: "#C0392B" }}>🗑️ מחק</button>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {a.trigger_day_offset} ימים {a.trigger_anchor_event === "departure_date" ? "מתאריך עזיבה" : "מתאריך הגעה"}, בשעה {timeInputValue(a.trigger_local_time) || "—"}
                  {" · "}{(a.custom_automation_steps ?? []).length} שלבים
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ManualDispatchModal ──────────────────────────────────────────────────────
// Self-contained modal for staff to force-dispatch any automation stage for
// any guest, bypassing cron scheduling and the idempotency guard.
// Key design rules from the architecture plan:
//   1. room_type-aware template bifurcation is enforced server-side — we only
//      choose the STAGE and the CHANNEL, not the actual template name.
//   2. Toast feedback shows the *specific* error returned by the API, not a
//      generic message.
//   3. Two-step confirm: preview → dispatch (no accidental sends).
//   4. The flag column IS stamped on success so cron doesn't double-fire.
const DAY_PASS_ALLOWED_FOR_MODAL = new Set([
  "pre_arrival_2d", "stage_2_arrival", "night_before_daypass", "morning_welcome",
  "mid_stay_daypass", "checkout_fb_daypass",
]);

const DAYPASS_ONLY_STAGE_KEYS = new Set([
  "night_before_daypass", "morning_welcome", "mid_stay_daypass", "checkout_fb_daypass",
]);

async function lookupPendingScheduledTask(guestId, stageKey) {
  if (!supabase || !guestId || !stageKey) return null;
  const { data, error } = await supabase
    .from("scheduled_tasks")
    .select("id, scheduled_for")
    .eq("guest_id", guestId)
    .eq("stage_key", stageKey)
    .eq("status", "pending")
    .maybeSingle();
  if (error) console.warn("[dispatch] scheduled_tasks lookup:", error.message);
  return data;
}

const NIGHT_BEFORE_OVERRIDE_IMAGE =
  "https://dream-ai-system.vercel.app/images/dreamislandsuite.jpg";

async function invokeForcedDispatch({ guestId, stageKey, forceChannel, scheduledFor, imageUrl }) {
  return supabase.functions.invoke("whatsapp-send", {
    body: {
      trigger: stageKey,
      guestId,
      force: true,
      // night_before now properly honors force_channel too (2026-07-09 fix) — no
      // longer special-cased/omitted here. See whatsapp-send's night_before block.
      ...(forceChannel ? { force_channel: forceChannel } : {}),
      manual_override: true,
      scheduled_for: scheduledFor ?? undefined,
      image_url: imageUrl ?? (stageKey === "night_before" ? NIGHT_BEFORE_OVERRIDE_IMAGE : undefined),
    },
  });
}

function ManualDispatchModal({ item, stages, onClose, onDispatched, showToast }) {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  // Effective classification — matches server routing (suite room wins).
  const isDayType = isDayPassQueueItem(item);

  // Filter to stages the backend will actually allow for this room_type.
  const allowedStages = stages.filter((s) => {
    if (isDayType) return DAY_PASS_ALLOWED_FOR_MODAL.has(s.stage_key);
    return !DAYPASS_ONLY_STAGE_KEYS.has(s.stage_key);
  });

  const [stageKey, setStageKey]   = useState(item.stageKey ?? (allowedStages[0]?.stage_key ?? ""));
  const [channel, setChannel]     = useState("meta_template");
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending]     = useState(false);
  const [result, setResult]       = useState(null); // {ok, message}
  const [overrideConfirm, setOverrideConfirm] = useState(null);
  const [dispatchError, setDispatchError] = useState(null);

  const selectedStage   = stages.find((s) => s.stage_key === stageKey);
  const hasScriptKey    = !!selectedStage?.session_message_script_key;
  // night_before's Shabbat/holiday-aware fast-path now properly honors
  // force_channel (2026-07-09 fix) — Whapi is gated by hasScriptKey only,
  // same as every other stage, no more stage-specific exclusion here.

  // When stage changes, revert to meta_template if session/whapi is not available.
  useEffect(() => {
    if (channel === "session_message" && !hasScriptKey) setChannel("meta_template");
    if (channel === "whapi_session" && !hasScriptKey) setChannel("meta_template");
  }, [stageKey, hasScriptKey, channel]);

  const runDispatch = async (scheduledFor) => {
    if (!supabase) return;
    setSending(true);
    setResult(null);
    setDispatchError(null);
    try {
      const { data, error } = await invokeForcedDispatch({
        guestId: item.guestId,
        stageKey,
        forceChannel: channel,
        scheduledFor,
      });
      if (error) throw new Error(error.message);
      if (data?.ok) {
        const tmplPart = data?.template ? ` (${data.template})` : "";
        const successMsg = `✅ ${item.guestName} — ${selectedStage?.display_name ?? stageKey}${tmplPart} — נשלח!`;
        showToast("ok", successMsg);
        setResult({ ok: true, message: successMsg });
        setOverrideConfirm(null);
        onDispatched?.();
      } else {
        const apiMsg = data?.error ?? data?.reason ?? "שגיאה לא ידועה";
        setResult({ ok: false, message: `❌ שגיאה: ${apiMsg}` });
        setDispatchError(apiMsg);
        showToast("err", `❌ ${item.guestName}: ${apiMsg}`);
      }
    } catch (e) {
      const msg = (e?.message ?? String(e));
      setResult({ ok: false, message: `❌ ${msg}` });
      setDispatchError(msg);
      showToast("err", "שגיאה: " + msg);
    } finally {
      setSending(false);
    }
  };

  const handleDispatch = async () => {
    if (!supabase) return;
    if (!ensureCanSend()) {
      showToast("err", "שליחה חסומה בשעות שקט — סמן את האישור למטה");
      return;
    }
    const dbPending = await lookupPendingScheduledTask(item.guestId, stageKey);
    const scheduledFor = dbPending?.scheduled_for ?? item.scheduledFor;
    const needsOverrideConfirm =
      !!dbPending ||
      isFutureScheduledQueueItem({ ...item, stageKey, scheduledFor, status: item.status ?? "pending" });
    if (needsOverrideConfirm && scheduledFor) {
      setOverrideConfirm({ scheduledFor });
      return;
    }
    await runDispatch(scheduledFor);
  };

  const canDispatch = stageKey && item.guestId && !sending && !result?.ok && canSend;

  if (overrideConfirm) {
    return (
      <ScheduledOverrideConfirmModal
        guestName={item.guestName}
        stageLabel={selectedStage?.display_name ?? stageKey}
        scheduledFor={overrideConfirm.scheduledFor}
        sending={sending}
        error={dispatchError}
        onCancel={() => {
          if (!sending) setOverrideConfirm(null);
        }}
        onConfirm={() => runDispatch(overrideConfirm.scheduledFor)}
      />
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10100,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "28px 32px",
        maxWidth: 520, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        direction: "rtl", display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>⚡ שגר ידני — Override</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, padding: "2px 8px" }}>✕</button>
        </div>

        {/* Guest info */}
        <div style={{ background: "rgba(201,169,110,0.1)", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          <strong>{item.guestName}</strong>
          {item.room && <span style={{ color: "var(--text-muted)", marginRight: 8 }}>· {item.room}</span>}
          {isDayType && (
            <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 12, background: "#FEF3C7", color: "#92400E", marginRight: 8 }}>
              יום-כיף
            </span>
          )}
        </div>

        {/* Stage selector */}
        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>שלב לשליחה</label>
          <select value={stageKey} onChange={(e) => setStageKey(e.target.value)} disabled={sending}>
            {allowedStages.length === 0 && <option value="">— אין שלבים זמינים —</option>}
            {allowedStages.map((s) => (
              <option key={s.stage_key} value={s.stage_key}>{s.display_name ?? s.stage_key}</option>
            ))}
          </select>
        </div>

        {/* Channel */}
        <div>
          <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 8 }}>ערוץ שליחה</label>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setChannel("meta_template")}
              disabled={sending}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 10, border: `2px solid ${channel === "meta_template" ? "var(--gold)" : "var(--border)"}`,
                background: channel === "meta_template" ? "rgba(201,169,110,0.12)" : "#fff",
                fontWeight: channel === "meta_template" ? 700 : 400, cursor: "pointer", fontSize: 13,
              }}
            >
              🔵 Meta Template<br />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>עובד תמיד (ללא חלון 24ש')</span>
            </button>
            <button
              onClick={() => hasScriptKey && setChannel("session_message")}
              disabled={sending || !hasScriptKey}
              title={!hasScriptKey ? "שלב זה אינו מוגדר עם Bot Script" : undefined}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 10, border: `2px solid ${channel === "session_message" ? "#1A7A4A" : "var(--border)"}`,
                background: channel === "session_message" ? "rgba(26,122,74,0.08)" : (hasScriptKey ? "#fff" : "#f5f5f5"),
                fontWeight: channel === "session_message" ? 700 : 400,
                cursor: hasScriptKey ? "pointer" : "not-allowed", fontSize: 13,
                color: hasScriptKey ? "inherit" : "var(--text-muted)",
              }}
            >
              🟢 Bot Script<br />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {hasScriptKey ? "מאלץ שליחה גם אם חלון סגור" : "לא זמין לשלב זה"}
              </span>
            </button>
            <button
              onClick={() => hasScriptKey && setChannel("whapi_session")}
              disabled={sending || !hasScriptKey}
              title={!hasScriptKey ? "שלב זה אינו מוגדר עם Bot Script" : undefined}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 10, border: `2px solid ${channel === "whapi_session" ? "#1A7A4A" : "var(--border)"}`,
                background: channel === "whapi_session" ? "rgba(26,122,74,0.08)" : (hasScriptKey ? "#fff" : "#f5f5f5"),
                fontWeight: channel === "whapi_session" ? 700 : 400,
                cursor: hasScriptKey ? "pointer" : "not-allowed", fontSize: 13,
                color: hasScriptKey ? "inherit" : "var(--text-muted)",
              }}
            >
              📱 Whapi (מכשיר הסוויטות)<br />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {hasScriptKey ? "אותו טקסט Bot Script, דרך המכשיר המחובר" : "לא זמין לשלב זה"}
              </span>
            </button>
          </div>
        </div>

        {/* Confirmation step */}
        {!confirmed && !result && (
          <div style={{
            background: "#FFF8E7", border: "1px solid #C9A96E", borderRadius: 10,
            padding: "12px 14px", fontSize: 13,
          }}>
            <strong>⚠ שים לב:</strong> שגר ידני יתעלם מלו"ז ה-cron. דגל ה-pipeline יסומן לאחר שליחה מוצלחת — ה-cron לא ישלח פעם נוספת.
          </div>
        )}

        <QuietHoursGate
          active={quietActive}
          checked={overrideChecked}
          onChange={setOverrideChecked}
        />

        {/* Result */}
        {result && (
          <div style={{
            background: result.ok ? "#E8F5EF" : "#FFF0EE",
            border: `1px solid ${result.ok ? "#1A7A4A" : "#C0392B"}`,
            borderRadius: 10, padding: "12px 14px", fontSize: 13,
            color: result.ok ? "#1A7A4A" : "#C0392B",
          }}>
            {result.message}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>{result?.ok ? "סגור" : "ביטול"}</button>
          {!result?.ok && (
            <>
              {!confirmed ? (
                <button
                  className="btn btn-primary"
                  onClick={() => setConfirmed(true)}
                  disabled={!canDispatch}
                >
                  ⚡ אשר שגר ידני
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleDispatch}
                  disabled={!canDispatch}
                  style={{ background: "#C0392B", borderColor: "#C0392B" }}
                >
                  {sending ? "⏳ שולח..." : "🚀 שגר עכשיו (מאושר)"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueGuestInboxLink({ guestName, phone, onOpenDreamBotChat }) {
  const hasPhone = Boolean(phone);
  const canOpen = hasPhone && typeof onOpenDreamBotChat === "function";
  const title = canOpen
    ? "פתח שיחת DREAM BOT עם האורח"
    : hasPhone
      ? "אין הרשאה לפתיחת שיחה"
      : "אין מספר טלפון לשיחה — עדכן בפרופיל האורח";

  if (!canOpen) {
    return (
      <span
        style={{ fontWeight: 800, fontSize: 14, color: "var(--text-muted)", cursor: "not-allowed" }}
        title={title}
      >
        {guestName ?? "—"}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenDreamBotChat({ phone, guestName })}
      title={title}
      style={{
        fontWeight: 800,
        fontSize: 14,
        padding: 0,
        border: "none",
        background: "none",
        color: "var(--gold-dark)",
        cursor: "pointer",
        textDecoration: "underline",
        textUnderlineOffset: 3,
        fontFamily: "inherit",
      }}
    >
      💬 {guestName ?? "—"}
    </button>
  );
}

export default function AutomationControlCenter({ onOpenDreamBotChat }) {
  const [subTab, setSubTab] = useState("timeline"); // timeline | queue | history | builder | preview | templates | health
  const [stages, setStages] = useState([]);
  const [scriptsByKey, setScriptsByKey] = useState({});
  const [availableScriptKeys, setAvailableScriptKeys] = useState([]);
  const [loadingStages, setLoadingStages] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast] = useState(null);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [metaTemplatesByName, setMetaTemplatesByName] = useState({});

  // ── Live queue state ──────────────────────────────────────────────────────
  const [queueData, setQueueData] = useState(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueError, setQueueError] = useState(null);
  const [queueRefreshedAt, setQueueRefreshedAt] = useState(null);
  const [queuePreviewDate, setQueuePreviewDate] = useState(""); // YYYY-MM-DD — empty = live clock
  const queueSyncTimerRef = useRef(null);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [dismissedAttentionKeys, setDismissedAttentionKeys] = useState(new Set());

  // ── Automation health watchdog (read-only preview) ───────────────────────
  const [healthChecks, setHealthChecks] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [healthError, setHealthError] = useState(null);
  const [healthRefreshedAt, setHealthRefreshedAt] = useState(null);
  const HEALTH_CHECK_LABELS = {
    cron_heartbeat_wa_cron: "דופק whatsapp-cron",
    duplicate_lookup_failed: "חסימת כפילות שנכשלה בקריאה (lookup_failed)",
    notification_failed_rate: "קצב כשלים בהודעות אוטומציה",
    ai_failover_rate: "קצב failover בין מנועי AI",
    template_approval_lookup: "בדיקת תבניות מול Meta",
    automation_stages_read_error: "קריאת automation_stages",
  };
  const healthCheckLabel = (checkKey) => {
    if (HEALTH_CHECK_LABELS[checkKey]) return HEALTH_CHECK_LABELS[checkKey];
    if (checkKey.startsWith("template_approval:")) return `תבנית Meta: ${checkKey.slice("template_approval:".length)}`;
    return checkKey;
  };

  // ── Segment tabs + bulk dispatch ─────────────────────────────────────────
  const [queueSegment, setQueueSegment] = useState("suite");   // "suite" | "daypass"
  const [collapsedArrivalDays, setCollapsedArrivalDays] = useState(new Set());
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [dispatching, setDispatching] = useState(false);
  const [dispatchProgress, setDispatchProgress] = useState(null);
  const [dispatchSummary, setDispatchSummary] = useState(null);
  const [showDispatchConfirm, setShowDispatchConfirm] = useState(false);
  // Queue bulk Whapi action (Phase 2) — same confirm modal + send loop as the
  // Meta bulk-send above, switched to force_channel="whapi_session" per item.
  const [dispatchViaWhapi, setDispatchViaWhapi] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  // ── Opt-in automation: bulk unmute after import ───────────────────────────
  const [mutedGuests, setMutedGuests] = useState([]);
  const [loadingMutedGuests, setLoadingMutedGuests] = useState(false);
  const [mutedGuestsError, setMutedGuestsError] = useState(null);
  const [selectedMutedGuestIds, setSelectedMutedGuestIds] = useState(new Set());
  const [unmutingGuests, setUnmutingGuests] = useState(false);
  const [mutedPanelOpen, setMutedPanelOpen] = useState(true);

  // ── Manual Dispatch / Override ───────────────────────────────────────────
  const [manualDispatchItem, setManualDispatchItem] = useState(null);
  const [sendNowConfirm, setSendNowConfirm] = useState(null);
  const [sendNowSending, setSendNowSending] = useState(false);
  const [sendNowError, setSendNowError] = useState(null);
  const [staffTestPhone, setStaffTestPhone] = useState("");

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const dismissAttentionItem = useCallback((key) => {
    setDismissedAttentionKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const fetchStages = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoadingStages(false); return; }
    setLoadingStages(true);
    const [{ data: stageRows, error: stageErr }, { data: scriptRows, error: scriptErr }] = await Promise.all([
      supabase.from("automation_stages").select("*").order("sequence_order"),
      supabase.from("bot_scripts").select("script_key, message_text"),
    ]);
    if (stageErr) showToast("err", "שגיאה בטעינת שלבים: " + stageErr.message);
    else setStages(stageRows ?? []);
    if (scriptErr) showToast("err", "שגיאה בטעינת סקריפטים: " + scriptErr.message);
    else {
      const map = {};
      (scriptRows ?? []).forEach((s) => { map[s.script_key] = s.message_text ?? ""; });
      setScriptsByKey(map);
      setAvailableScriptKeys((scriptRows ?? []).map((s) => s.script_key));
    }
    setLoadingStages(false);
  }, [showToast]);

  useEffect(() => { fetchStages(); }, [fetchStages]);

  // Fetched once on mount (same get-wa-templates({all:true}) call
  // TemplateManagerPanel.js makes) so the Timeline tab's Meta template
  // preview box has body text available without requiring the admin to
  // first visit the "📋 תבניות Meta" tab.
  const fetchMetaTemplates = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { data, error } = await supabase.functions.invoke("get-wa-templates", { body: { all: true } });
      if (error) throw new Error(error.message);
      const map = {};
      (data?.templates ?? []).forEach((t) => { map[t.name] = t; });
      setMetaTemplatesByName(map);
    } catch (err) {
      showToast("err", "שגיאה בטעינת תבניות Meta — תצוגת התבנית בלוח הזמנים תהיה חסרה: " + (err?.message ?? err));
    }
  }, [showToast]);

  useEffect(() => { fetchMetaTemplates(); }, [fetchMetaTemplates]);

  const fetchQueue = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const body = queuePreviewDate
        ? { previewAt: `${queuePreviewDate}T12:00:00.000Z` }
        : undefined;
      const { data, error } = await supabase.functions.invoke("automation-queue", { body });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "unknown error");
      setQueueData(data);
      setQueueRefreshedAt(new Date());

      const futureTasks = (data.queue ?? []).filter(
        (q) => q.scheduledFor
          && !q.staffScheduled
          && new Date(q.scheduledFor).getTime() > Date.now()
          && !["sent", "simulated"].includes(q.status),
      );
      if (futureTasks.length > 0) {
        const { error: syncErr } = await supabase.rpc("upsert_scheduled_tasks_batch", {
          p_tasks: futureTasks.map((q) => ({
            guest_id: q.guestId,
            stage_key: q.stageKey,
            scheduled_for: q.scheduledFor,
          })),
        });
        if (syncErr) console.warn("[queue] scheduled_tasks sync:", syncErr.message);
      }
    } catch (err) {
      setQueueError(err?.message ?? String(err));
    } finally {
      setLoadingQueue(false);
    }
  }, [queuePreviewDate]);

  // preview:true — read-only, never writes state or sends a Whapi alert
  // (automation-health-cron/index.ts honors this regardless of
  // AUTOMATION_HEALTH_ENABLED, so opening this tab is always safe).
  const fetchHealth = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingHealth(true);
    setHealthError(null);
    try {
      const { data, error } = await supabase.functions.invoke("automation-health-cron", { body: { preview: true } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "unknown error");
      setHealthChecks(data.checks ?? []);
      setHealthRefreshedAt(new Date());
    } catch (err) {
      setHealthError(err?.message ?? String(err));
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const fetchMutedGuests = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingMutedGuests(true);
    setMutedGuestsError(null);
    try {
      const todayKey = queueYmd();
      const { data, error } = await supabase
        .from("guests")
        .select("id, name, phone, room, arrival_date, room_type, status")
        .eq("automation_muted", true)
        .gte("arrival_date", todayKey)
        .neq("status", "cancelled")
        .order("arrival_date", { ascending: true })
        .limit(200);
      if (error) throw error;
      setMutedGuests(data ?? []);
      setSelectedMutedGuestIds(new Set());
    } catch (err) {
      setMutedGuestsError(err?.message ?? String(err));
      setMutedGuests([]);
    } finally {
      setLoadingMutedGuests(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === "queue") {
      fetchQueue();
      fetchMutedGuests();
    }
  }, [subTab, fetchQueue, fetchMutedGuests, queuePreviewDate]);

  useEffect(() => {
    if (subTab === "health") fetchHealth();
  }, [subTab, fetchHealth]);

  const scheduleQueueRefresh = useCallback(() => {
    if (queueSyncTimerRef.current) clearTimeout(queueSyncTimerRef.current);
    queueSyncTimerRef.current = setTimeout(() => {
      fetchQueue();
      fetchMutedGuests();
    }, 600);
  }, [fetchQueue, fetchMutedGuests]);

  const toggleMutedGuest = useCallback((guestId) => {
    setSelectedMutedGuestIds((prev) => {
      const next = new Set(prev);
      if (next.has(guestId)) next.delete(guestId); else next.add(guestId);
      return next;
    });
  }, []);

  const toggleAllMutedGuests = useCallback(() => {
    setSelectedMutedGuestIds((prev) => {
      if (mutedGuests.length > 0 && mutedGuests.every((g) => prev.has(g.id))) {
        return new Set();
      }
      return new Set(mutedGuests.map((g) => g.id));
    });
  }, [mutedGuests]);

  const handleBulkUnmuteGuests = useCallback(async () => {
    if (!supabase || selectedMutedGuestIds.size === 0) return;
    setUnmutingGuests(true);
    try {
      const ids = [...selectedMutedGuestIds];
      const { error } = await supabase
        .from("guests")
        .update({ automation_muted: false })
        .in("id", ids);
      if (error) throw error;
      showToast("ok", `✓ הופעלה אוטומציה ל-${ids.length} אורחים`);
      await Promise.all([fetchMutedGuests(), fetchQueue()]);
    } catch (err) {
      showToast("err", "שגיאה בהפעלת אוטומציה: " + (err?.message ?? err));
    } finally {
      setUnmutingGuests(false);
    }
  }, [selectedMutedGuestIds, fetchMutedGuests, fetchQueue, showToast]);

  useEffect(() => () => {
    if (queueSyncTimerRef.current) clearTimeout(queueSyncTimerRef.current);
  }, []);

  useEffect(() => {
    if (!queueData?.queue) return;
    const todayKey = queueYmd();
    const past = new Set();
    for (const q of queueData.queue) {
      if (q.arrivalDate && q.arrivalDate < todayKey) past.add(q.arrivalDate);
    }
    setCollapsedArrivalDays(past);
  }, [queueData]);

  useEffect(() => {
    if (queueData && queueData.attentionRequired.length > 0) setAttentionOpen(true);
  }, [queueData]);

  // ── Execution history ("מה נשלח") ────────────────────────────────────────
  const [historyData, setHistoryData] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");

  const fetchHistory = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase.functions.invoke("automation-history");
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "unknown error");
      setHistoryData(data.history ?? []);
    } catch (err) {
      setHistoryError(err?.message ?? String(err));
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { if (subTab === "history") fetchHistory(); }, [subTab, fetchHistory]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user?.id) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.phone) setStaffTestPhone(profile.phone);
    });
  }, []);

  const runQueueSendNow = useCallback(async (item, scheduledFor) => {
    if (!supabase) return;
    // night_before: no force_channel pin — whatsapp-send zero-guard uses live window + force=true
    const forceChannel =
      item.stageKey === "night_before"
        ? undefined
        : item.predictedChannel === "session_message"
          ? "session_message"
          : "meta_template";
    setSendNowSending(true);
    setSendNowError(null);
    try {
      const { data, error } = await invokeForcedDispatch({
        guestId: item.guestId,
        stageKey: item.stageKey,
        forceChannel,
        scheduledFor,
      });
      if (error) throw new Error(error.message);
      if (data?.ok) {
        if (data?.skipped) {
          if (data?.status === "duplicate_blocked") {
            showToast("err", `🔁 ${item.guestName} — שלב כבר נשלח (כפילות נחסמה ונרשמה בהיסטוריה)`);
          } else {
            showToast("ok", `↩️ ${item.guestName} — ${item.displayName ?? item.stageKey} — דולג (${data.reason ?? "כבר נשלח"})`);
          }
        } else {
          showToast("ok", `✅ ${item.guestName} — ${item.displayName ?? item.stageKey} — נשלח עכשיו`);
        }
        setSendNowConfirm(null);
        fetchQueue();
      } else {
        const apiMsg = data?.error ?? data?.reason ?? "שגיאה לא ידועה";
        setSendNowError(apiMsg);
        showToast("err", `❌ ${item.guestName}: ${apiMsg}`);
      }
    } catch (e) {
      const msg = e?.message ?? String(e);
      setSendNowError(msg);
      showToast("err", "שגיאה: " + msg);
    } finally {
      setSendNowSending(false);
    }
  }, [showToast, fetchQueue]);

  const requestQueueSendNow = useCallback(async (item) => {
    if (!item?.guestId || !item?.stageKey) return;
    const dbPending = await lookupPendingScheduledTask(item.guestId, item.stageKey);
    const scheduledFor = dbPending?.scheduled_for ?? item.scheduledFor;
    const needsConfirm =
      !!dbPending ||
      isFutureScheduledQueueItem({ ...item, scheduledFor });
    if (needsConfirm && scheduledFor) {
      setSendNowError(null);
      setSendNowConfirm({ item, scheduledFor });
      return;
    }
    await runQueueSendNow(item, scheduledFor);
  }, [runQueueSendNow]);

  const patchStage = async (stage, patch) => {
    setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("automation_stages").update(patch).eq("id", stage.id);
    if (error) {
      showToast("err", "שגיאה בשמירה: " + error.message);
      fetchStages(); // revert to DB truth
    } else {
      showToast("ok", `✅ "${stage.display_name}" עודכן`);
      scheduleQueueRefresh();
    }
  };

  const saveSessionMessage = async (scriptKey, text) => {
    const { error } = await supabase.from("bot_scripts").update({ message_text: text }).eq("script_key", scriptKey);
    if (error) showToast("err", "שגיאה בשמירת הודעת הסשן: " + error.message);
    else { setScriptsByKey((prev) => ({ ...prev, [scriptKey]: text })); showToast("ok", "✅ הודעת הסשן נשמרה"); }
  };

  const addButton = (stage) => {
    const buttons = stage.interactive_buttons ?? [];
    if (buttons.length >= 3) return;
    patchStage(stage, { interactive_buttons: [...buttons, { type: "quick_reply", label: "", url: "" }] });
  };
  const updateButton = (stage, idx, patch) => {
    const buttons = (stage.interactive_buttons ?? []).map((b, i) => (i === idx ? { ...b, ...patch } : b));
    patchStage(stage, { interactive_buttons: buttons });
  };
  const removeButton = (stage, idx) => {
    patchStage(stage, { interactive_buttons: (stage.interactive_buttons ?? []).filter((_, i) => i !== idx) });
  };

  const convertToTemplate = (stage) => {
    const body = stage.session_message_script_key ? (scriptsByKey[stage.session_message_script_key] ?? "") : "";
    const buttons = (stage.interactive_buttons ?? [])
      .filter((b) => b.label?.trim())
      .map((b) => ({ type: b.type === "url" ? "URL" : "QUICK_REPLY", text: b.label, url: b.url }));
    setTemplateDraft({
      name: stage.stage_key,
      language: "he",
      category: "UTILITY",
      body: body.replace(/\{\{[^}]+\}\}/g, "{{1}}"), // bot_scripts placeholders aren't Meta {{n}} vars — admin fills these in manually before submitting
      header: "",
      footer: "",
      buttons,
    });
    setSubTab("templates");
  };

  // ── Day Pass stage whitelist — mirrors whatsapp-send's server-side gate ────
  // Must stay in sync with DAY_PASS_ALLOWED_TRIGGERS in whatsapp-send/index.ts.
  // Keeping this as a module-level const would hide the dependency; keeping it
  // here makes the pairing with handleBulkDispatch obvious at review time.
  //
  // night_before (Stage 2.5) is now permitted for day_guest: the server routes
  // to dream_checkin_reminder_v2 instead of the suite template variants, so
  // day-pass guests receive an appropriate evening reminder. morning_*, mid_stay,
  // room_ready remain blocked (suite amenities only).
  // Stage 2.5 split (migration 093): day-pass guests use 'night_before_daypass',
  // not 'night_before' (which now applies to suite guests only).
  // Stage 3 (morning_welcome) is now allowed for day-pass — bifurcated in whatsapp-send.
  const DAY_PASS_ALLOWED_STAGES = new Set([
    "pre_arrival_2d", "night_before_daypass", "morning_welcome",
    "mid_stay_daypass", "checkout_fb_daypass",
  ]);

  // Stages whose dispatch block pre-dates the Whapi work and never learned to
  // check force_channel — mirrors WHAPI_UNSUPPORTED_STAGES in whatsapp-send/
  // index.ts. Excluded client-side (Disable, Don't Hide — shown as a blocked
  // result with reason, not silently dropped) so a mixed selection doesn't
  // rely on the server's per-stage guard alone.
  const WHAPI_UNSUPPORTED_STAGES = new Set(["morning_suite", "morning_welcome", "room_ready"]);

  // ── Bulk dispatch — same call as whatsapp-cron uses (viaWhapi pins
  // force_channel="whapi_session" instead — manual dispatch only, never
  // changes what cron itself sends) ────────────────────────────────────────
  const handleBulkDispatch = async (displayQueue, viaWhapi = false) => {
    if (!isSupabaseConfigured || !supabase) return;
    setDispatching(true);
    const results = [];
    const keysToSend = [...selectedItems].filter((itemKey) =>
      displayQueue.some((q) => `${q.guestId}_${q.stageKey}` === itemKey),
    );

    for (let i = 0; i < keysToSend.length; i++) {
      const itemKey = keysToSend[i];
      setDispatchProgress({ current: i + 1, total: keysToSend.length });
      const item = displayQueue.find((q) => `${q.guestId}_${q.stageKey}` === itemKey);
      if (!item) continue;

      // Client-side Safety Gate — matches server guard in whatsapp-send BRANCH D.
      if (isQueueItemGated(item, DAY_PASS_ALLOWED_STAGES)) {
        results.push({ item, result: "blocked", reason: "day_pass_stage_gate" });
        continue;
      }
      if (viaWhapi && WHAPI_UNSUPPORTED_STAGES.has(item.stageKey)) {
        results.push({ item, result: "blocked", reason: "whapi_unsupported_stage" });
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: viaWhapi
            ? { trigger: item.stageKey, guestId: item.guestId, force: true, force_channel: "whapi_session" }
            : { trigger: item.stageKey, guestId: item.guestId },
        });
        if (error) {
          results.push({ item, result: "error", error: error.message });
        } else if (data?.skipped) {
          if (data?.status === "duplicate_blocked") {
            results.push({ item, result: "duplicate", reason: data.reason ?? "duplicate_blocked" });
          } else {
            results.push({ item, result: "skipped", reason: data.reason });
          }
        } else if (data?.ok) {
          results.push({ item, result: "sent", simulation: data.simulation });
        } else {
          results.push({ item, result: "failed", error: data?.error ?? "unknown" });
        }
      } catch (e) {
        results.push({ item, result: "error", error: e?.message ?? String(e) });
      }

      // Pulse between sends — same 2.5s cadence as whatsapp-cron (Meta rate-limit safety).
      if (i < keysToSend.length - 1) {
        await new Promise((r) => setTimeout(r, BULK_SEND_PULSE_MS));
      }
    }

    setDispatching(false);
    setDispatchProgress(null);
    setSelectedItems(new Set());
    setDispatchViaWhapi(false);
    setDispatchSummary({
      total:   results.length,
      sent:    results.filter((r) => r.result === "sent").length,
      skipped: results.filter((r) => r.result === "skipped").length,
      duplicates: results.filter((r) => r.result === "duplicate").length,
      blocked: results.filter((r) => r.result === "blocked").length,
      failed:  results.filter((r) => r.result === "failed" || r.result === "error").length,
      details: results,
    });
    fetchQueue();
  };

  const handleBulkSchedule = async (payload) => {
    if (!supabase || !payload?.length) return;
    setScheduling(true);
    setScheduleError(null);
    try {
      const { data, error } = await supabase.rpc("staff_schedule_tasks_batch", { p_tasks: payload });
      if (error) throw error;
      const count = typeof data === "number" ? data : payload.length;
      showToast("ok", `📅 נשמר תזמון ל-${count} הודעות — ה-cron ישלח בזמן`);
      setShowScheduleModal(false);
      setSelectedItems(new Set());
      fetchQueue();
    } catch (err) {
      const msg = err?.message ?? String(err);
      setScheduleError(msg);
      showToast("err", "שגיאה בשמירת תזמון: " + msg);
    } finally {
      setScheduling(false);
    }
  };

  // stage_key → display_name, reused by the Queue tab so it never shows a
  // raw stage_key/trigger_type token to the manager.
  const stageDisplayNames = stages.reduce((acc, s) => {
    acc[s.stage_key] = s.display_name;
    return acc;
  }, {});

  const cronActiveStageKeys = stages.filter(isCronScheduledStage).map((s) => s.stage_key);
  const eventImmediateStageKeys = stages
    .filter((s) => s.is_active && s.schedule_mode === "event_immediate")
    .map((s) => s.stage_key);
  const missingCoreStages = CORE_PIPELINE_STAGE_KEYS.filter((k) => !cronActiveStageKeys.includes(k));

  return (
    <div>
      <style>{`
        @media (max-width: 640px) {
          .actr-tabs { flex-direction: column; }
          .actr-tabs button { width: 100%; text-align: center; padding: 12px 16px !important; min-height: 44px; }
          .actr-timing-row { flex-direction: column !important; align-items: stretch !important; }
          .actr-timing-row input, .actr-timing-row select { width: 100% !important; min-height: 40px; }
          .actr-btn-row { flex-direction: column !important; }
          .actr-btn-row input, .actr-btn-row select { width: 100% !important; }
          .actr-card-header { flex-wrap: wrap; }
        }
        .actr-touch-btn { min-height: 40px; padding: 10px 16px; }
        .actr-scroll::-webkit-scrollbar { width: 6px; }
        .actr-scroll::-webkit-scrollbar-track { background: var(--ivory); border-radius: 3px; }
        .actr-scroll::-webkit-scrollbar-thumb { background: var(--gold); border-radius: 3px; }
        .actr-scroll::-webkit-scrollbar-thumb:hover { background: var(--gold-dark); }
      `}</style>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      <div className="actr-tabs" style={{ display: "flex", borderBottom: "2px solid var(--border)", marginBottom: 20, gap: 4 }}>
        {[
          { key: "timeline", label: "🗺️ מסע האורח" },
          { key: "queue",    label: "📡 תור חי + מוניטור" },
          { key: "history",  label: "📜 מה נשלח" },
          { key: "builder",  label: "✨ אוטומציה חדשה" },
          { key: "preview",  label: "🧪 בדיקת תבניות" },
          { key: "templates", label: "📋 תבניות Meta" },
          { key: "health",    label: "🩺 בריאות אוטומציה" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "10px 20px", fontSize: 14, fontWeight: subTab === key ? 800 : 500,
            color: subTab === key ? "var(--gold-dark)" : "var(--text-muted)",
            borderBottom: subTab === key ? "2px solid var(--gold-dark)" : "2px solid transparent",
            marginBottom: -2, fontFamily: "Heebo, sans-serif",
          }}>{label}</button>
        ))}
      </div>

      {subTab === "timeline" && (
        <div style={{ maxWidth: 900 }}>
          <div style={{
            background: "linear-gradient(135deg, rgba(201,169,110,0.12) 0%, rgba(201,169,110,0.04) 100%)",
            border: "1px solid var(--gold)", borderRadius: 12, padding: "14px 20px", marginBottom: 24,
            fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6,
          }}>
            ⚙️ עריכת תזמון/תוכן כאן <strong>חיה</strong> — whatsapp-cron ו-whatsapp-send קוראים בפועל מהטבלה הזו ומחליטים לפיה
            מתי ומה לשלוח לאורחים. הפעלה/כיבוי או שינוי שלב כאן משפיע ישירות על מה שהאורח מקבל בוואטסאפ, לא רק על מה שמוצג בלוח.
            <br />
            שלב 2 (אישור הגעה): נשלח מיד כשהאורח לוחץ «כן מגיעים», מופיע גם ב<strong>תור חי</strong> לאורחים שאישרו וטרם קיבלו — ניתן לשגר ידנית/מאסיבית משם. <code>offset_hours</code> משפיע רק על תזמון cron/תור (גיבוי), לא על לחיצת האורח.
          </div>

          {loadingStages ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>⏳ טוען שלבים...</div>
          ) : (
            <div>
              {["shared", "suite", "daypass", "other"].map((pipelineKey) => {
                const sectionStages = stages.filter((s) => classifyStagePipeline(s) === pipelineKey);
                if (sectionStages.length === 0) return null;
                const meta = PIPELINE_SECTION_META[pipelineKey];
                return (
                  <div key={pipelineKey} style={{ marginBottom: 32 }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 16px", marginBottom: 12,
                      borderRadius: 12,
                      border: `2px solid ${meta.border}`,
                      background: meta.bg,
                    }}>
                      <span style={{ fontSize: 20 }}>{meta.icon}</span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: "var(--black)" }}>{meta.label}</div>
                        {pipelineKey === "daypass" && (
                          <div style={{ fontSize: 12, color: "#7C3AED", marginTop: 2 }}>
                            שלבים 1–2 משותפים · 2.5–5 ייעודיים לבילוי יומי · שער שרת חוסם שלבי סוויטות
                          </div>
                        )}
                        {pipelineKey === "suite" && (
                          <div style={{ fontSize: 12, color: "#0369A1", marginTop: 2 }}>
                            שלבים 1–2 משותפים · 2.5–5 ייעודיים לסוויטות · היברידי: סשן חופשי בתוך 24ש׳, תבנית Meta מחוץ לחלון
                          </div>
                        )}
                      </div>
                      <span style={{ marginRight: "auto", fontSize: 12, color: "var(--text-muted)" }}>
                        {sectionStages.length} שלבים
                      </span>
                    </div>
                    {sectionStages.map((stage) => (
                      <StageCard
                        key={stage.id}
                        stage={stage}
                        isOpen={expanded === stage.id}
                        onToggle={() => setExpanded(expanded === stage.id ? null : stage.id)}
                        patchStage={patchStage}
                        scriptsByKey={scriptsByKey}
                        saveSessionMessage={saveSessionMessage}
                        availableScriptKeys={availableScriptKeys}
                        addButton={addButton}
                        updateButton={updateButton}
                        removeButton={removeButton}
                        convertToTemplate={convertToTemplate}
                        metaTemplatesByName={metaTemplatesByName}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subTab === "queue" && (() => {
        // ── Segment filtering ─────────────────────────────────────────────
        const isActiveQueueItemLocal = (q) => isActiveQueueItem(q);
        const allQueue    = mergeQueueWithStages(queueData?.queue, stages).filter(isActiveQueueItemLocal);
        // Effective segmentation — a conflicted guest (suite room, day-pass
        // room_type) appears under 🏨 סוויטות, matching real cron routing.
        const suiteQueue  = allQueue.filter((q) => !isDayPassQueueItem(q));
        const dayPassQueue = allQueue.filter((q) => isDayPassQueueItem(q));
        const displayQueue = queueSegment === "daypass" ? dayPassQueue : suiteQueue;
        const arrivalDayGroups = groupQueueByArrivalDay(displayQueue, stages);

        const toggleArrivalDay = (dateKey) => {
          setCollapsedArrivalDays((prev) => {
            const next = new Set(prev);
            if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
            return next;
          });
        };

        // An item is dispatchable if it hasn't been successfully sent yet
        // and has a valid guestId to call whatsapp-send with.
        const isDispatchable = (q) =>
          q.guestId
          && !["sent", "simulated", "skipped"].includes(q.status)
          && !QUEUE_HIDDEN_SKIP_REASONS.has(q.skipReason)
          && q.skipReason !== "awaiting_confirmation";

        const allDispatchableKeys = displayQueue
          .filter(isDispatchable)
          .map((q) => `${q.guestId}_${q.stageKey}`);
        const allSelected = allDispatchableKeys.length > 0 &&
          allDispatchableKeys.every((k) => selectedItems.has(k));

        const toggleAll = () => {
          if (allSelected) {
            setSelectedItems(new Set());
          } else {
            setSelectedItems(new Set(allDispatchableKeys));
          }
        };
        const toggleItem = (key) => {
          setSelectedItems((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          });
        };
        const toggleItemKeys = (keys, select) => {
          setSelectedItems((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => (select ? next.add(k) : next.delete(k)));
            return next;
          });
        };
        const toggleStageKeys = (itemKeys) => {
          const allSel = itemKeys.length > 0 && itemKeys.every((k) => selectedItems.has(k));
          toggleItemKeys(itemKeys, !allSel);
        };

        const stageChipStyle = (allSel, someSel) => ({
          fontSize: 12,
          padding: "5px 12px",
          borderRadius: 20,
          cursor: "pointer",
          border: allSel ? "1px solid var(--gold-dark)" : someSel ? "1px dashed var(--gold)" : "1px solid var(--border)",
          background: allSel ? "rgba(201,169,110,0.2)" : someSel ? "rgba(201,169,110,0.08)" : "#fff",
          color: allSel ? "var(--gold-dark)" : "var(--black)",
          fontWeight: allSel ? 700 : 500,
          whiteSpace: "nowrap",
        });

        return (
          <div>
            {/* ── Manual Dispatch Modal ── */}
            {manualDispatchItem && (
              <ManualDispatchModal
                item={manualDispatchItem}
                stages={stages}
                showToast={showToast}
                onClose={() => setManualDispatchItem(null)}
                onDispatched={() => {
                  setManualDispatchItem(null);
                  fetchQueue();
                }}
              />
            )}

            {showScheduleModal && (
              <QueueBulkScheduleModal
                items={displayQueue.filter((q) => selectedItems.has(`${q.guestId}_${q.stageKey}`))}
                dayLabels={Object.fromEntries(arrivalDayGroups.map((d) => [d.dateKey, d.label]))}
                saving={scheduling}
                error={scheduleError}
                onClose={() => {
                  if (!scheduling) {
                    setShowScheduleModal(false);
                    setScheduleError(null);
                  }
                }}
                onConfirm={handleBulkSchedule}
              />
            )}

            {sendNowConfirm && (
              <ScheduledOverrideConfirmModal
                guestName={sendNowConfirm.item.guestName}
                stageLabel={sendNowConfirm.item.displayName ?? sendNowConfirm.item.stageKey}
                scheduledFor={sendNowConfirm.scheduledFor}
                sending={sendNowSending}
                error={sendNowError}
                onCancel={() => {
                  if (!sendNowSending) setSendNowConfirm(null);
                }}
                onConfirm={() => runQueueSendNow(sendNowConfirm.item, sendNowConfirm.scheduledFor)}
              />
            )}

            {/* ── Dispatch Confirmation Modal ── */}
            {showDispatchConfirm && (
              <div style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 10001,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{
                  background: "#fff", borderRadius: 16, padding: "28px 32px",
                  maxWidth: 440, width: "90%", direction: "rtl", boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
                }}>
                  <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 10 }}>
                    {dispatchViaWhapi ? "📱 אשר שגר דרך מכשיר הסוויטות" : "🚀 אשר שגר הודעות"}
                  </div>
                  <div style={{ fontSize: 14, color: "#444", lineHeight: 1.7, marginBottom: 20 }}>
                    עומד לשלוח <strong>{selectedItems.size} הודעות</strong> לאורחים שנבחרו
                    {dispatchViaWhapi ? " דרך מכשיר הסוויטות (Whapi)" : ""}.
                    {dispatchViaWhapi && (() => {
                      const displayQ = queueSegment === "daypass" ? dayPassQueue : suiteQueue;
                      const unsupportedCount = [...selectedItems].filter((k) => {
                        const q = displayQ.find((qq) => `${qq.guestId}_${qq.stageKey}` === k);
                        return q && WHAPI_UNSUPPORTED_STAGES.has(q.stageKey);
                      }).length;
                      return unsupportedCount > 0 ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#92400E", background: "#FFF8E7", borderRadius: 8, padding: "8px 12px", border: "1px solid #C9A96E" }}>
                          ⚠ {unsupportedCount} מהנבחרים בשלב שעדיין לא נתמך דרך Whapi (בוקר הגעה / מסירת מפתח) — ידולגו ויוצגו בתוצאות.
                        </div>
                      ) : null;
                    })()}
                    {queueSegment === "daypass" && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#7C3AED", background: "rgba(124,58,237,0.06)", borderRadius: 8, padding: "8px 12px", border: "1px solid #C4B5FD" }}>
                        🔒 אורחי יום-כיף — Stage 1 ו-Stage 2.5 ישתמשו בתבנית{" "}
                        <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>dream_checkin_reminder_v2</code>.
                        Stage 3 (בוקר הגעה) ישתמש ב-{" "}
                        <code style={{ background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>suite_welcome_morning</code>{" "}
                        (או הודעה חופשית אם חלון 24ש' פתוח).
                        שלבים שאינם מורשים (אמצע שהות, מסירת מפתח) יחסמו בשרת.
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: 12, color: "#92702C" }}>
                      ⚠ פעולה זו אינה הפיכה. וודא שרשימת הנמענים נכונה לפני האישור.
                    </div>
                    <div style={{ marginTop: 10, fontSize: 12, color: "#444", background: "var(--ivory)", borderRadius: 8, padding: "8px 12px", border: "1px solid var(--border)" }}>
                      ⏱ שליחה בפעימות של {BULK_SEND_PULSE_MS / 1000} שניות בין הודעה להודעה (הגנה מפני חסימת Meta).
                      {selectedItems.size > 1 && (
                        <span> משך משוער: כ-{Math.ceil(((selectedItems.size - 1) * BULK_SEND_PULSE_MS) / 1000 / 60)} דק׳.</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-start" }}>
                    <button
                      className="btn btn-primary"
                      style={{ minWidth: 140 }}
                      onClick={() => {
                        setShowDispatchConfirm(false);
                        // displayQueue is captured from the outer IIFE scope via closure.
                        // We re-derive it here to avoid stale-closure issues.
                        const displayQ = queueSegment === "daypass" ? dayPassQueue : suiteQueue;
                        handleBulkDispatch(displayQ, dispatchViaWhapi);
                      }}
                    >
                      {dispatchViaWhapi ? "📱 אשר ושגר" : "🚀 אשר ושגר"}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setShowDispatchConfirm(false);
                        setDispatchViaWhapi(false);
                      }}
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Dispatch Summary Modal ── */}
            {dispatchSummary && (
              <div style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 10000,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{
                  background: "#fff", borderRadius: 16, padding: "28px 32px",
                  maxWidth: 480, width: "90%", direction: "rtl", boxShadow: "0 12px 48px rgba(0,0,0,0.2)",
                }}>
                  <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 20 }}>📊 תוצאות שליחה</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
                    <div>📨 סה"כ בוצעו: <strong>{dispatchSummary.total}</strong></div>
                    {dispatchSummary.sent > 0 && (
                      <div style={{ color: "#1A7A4A" }}>✅ נשלחו בהצלחה: <strong>{dispatchSummary.sent}</strong></div>
                    )}
                    {dispatchSummary.skipped > 0 && (
                      <div style={{ color: "#92702C" }}>↩️ כבר נשלחו (דולגו): <strong>{dispatchSummary.skipped}</strong></div>
                    )}
                    {dispatchSummary.duplicates > 0 && (
                      <div style={{ color: "#7C3AED" }}>🔁 כפילויות נחסמו: <strong>{dispatchSummary.duplicates}</strong></div>
                    )}
                    {dispatchSummary.blocked > 0 && (
                      <div style={{ color: "#7C3AED" }}>🔒 חסומות: <strong>{dispatchSummary.blocked}</strong></div>
                    )}
                    {dispatchSummary.failed > 0 && (
                      <div style={{ color: "#C0392B" }}>❌ נכשלו: <strong>{dispatchSummary.failed}</strong></div>
                    )}
                  </div>
                  {dispatchSummary.blocked > 0 && (
                    <div style={{ marginTop: 16, maxHeight: 140, overflowY: "auto" }}>
                      {dispatchSummary.details
                        .filter((r) => r.result === "blocked")
                        .map((r, i) => (
                          <div key={i} style={{ fontSize: 11, color: "#7C3AED", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                            {r.item.guestName ?? r.item.guestId} — {r.item.displayName}:{" "}
                            {r.reason === "whapi_unsupported_stage" ? "שלב לא נתמך עדיין דרך Whapi" : "שער יום-כיף"}
                          </div>
                        ))}
                    </div>
                  )}
                  {dispatchSummary.failed > 0 && (
                    <div style={{ marginTop: 16, maxHeight: 180, overflowY: "auto" }}>
                      {dispatchSummary.details
                        .filter((r) => r.result === "failed" || r.result === "error")
                        .map((r, i) => (
                          <div key={i} style={{ fontSize: 11, color: "#C0392B", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                            {r.item.guestName ?? r.item.guestId} — {r.item.displayName}: {r.error ?? r.reason}
                          </div>
                        ))}
                    </div>
                  )}
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 24, width: "100%" }}
                    onClick={() => setDispatchSummary(null)}
                  >
                    סגור
                  </button>
                </div>
              </div>
            )}

            {/* ── Opt-in automation: bulk approve muted imports ── */}
            {(loadingMutedGuests || mutedGuestsError || mutedGuests.length > 0) && (
              <div style={{
                marginBottom: 16, borderRadius: 12, overflow: "hidden",
                border: "2px solid #F59E0B", background: "rgba(245,158,11,0.08)",
              }}>
                <button
                  type="button"
                  onClick={() => setMutedPanelOpen((o) => !o)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px", border: "none", cursor: "pointer",
                    background: "rgba(245,158,11,0.15)", fontFamily: "Heebo,sans-serif",
                    textAlign: "right",
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: 14, color: "#92400E" }}>
                    🔇 אורחים מושתקים (ייבוא opt-in)
                    {!loadingMutedGuests && mutedGuests.length > 0 && (
                      <span style={{ fontWeight: 600, marginRight: 8 }}>({mutedGuests.length})</span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, color: "#92400E" }}>{mutedPanelOpen ? "▲" : "▼"}</span>
                </button>
                {mutedPanelOpen && (
                  <div style={{ padding: "12px 16px 16px" }}>
                    {loadingMutedGuests && (
                      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>⏳ טוען רשימת מושתקים...</div>
                    )}
                    {mutedGuestsError && (
                      <div style={{ fontSize: 13, color: "#C0392B", fontWeight: 700 }}>
                        ⚠ {mutedGuestsError}
                      </div>
                    )}
                    {!loadingMutedGuests && !mutedGuestsError && mutedGuests.length === 0 && (
                      <div style={{ fontSize: 13, color: "#065f46" }}>✓ אין אורחים עתידיים עם אוטומציה מושתקת</div>
                    )}
                    {!loadingMutedGuests && mutedGuests.length > 0 && (
                      <>
                        <p style={{ fontSize: 12, color: "#78350F", margin: "0 0 10px", lineHeight: 1.5 }}>
                          אורחים שיובאו עם «ייבוא ללא וואטסאפ» — סמן והפעל אוטומציה לפני שליחה מהתור.
                        </p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm actr-touch-btn"
                            onClick={toggleAllMutedGuests}
                            disabled={unmutingGuests}
                          >
                            {mutedGuests.every((g) => selectedMutedGuestIds.has(g.id)) ? "☐ בטל הכל" : "☑ בחר הכל"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary actr-touch-btn"
                            disabled={unmutingGuests || selectedMutedGuestIds.size === 0}
                            title={selectedMutedGuestIds.size === 0 ? "בחר לפחות אורח אחד" : ""}
                            onClick={handleBulkUnmuteGuests}
                          >
                            {unmutingGuests ? "⏳ מפעיל..." : `✅ הפעל אוטומציה (${selectedMutedGuestIds.size})`}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm actr-touch-btn"
                            onClick={fetchMutedGuests}
                            disabled={unmutingGuests || loadingMutedGuests}
                          >
                            🔄 רענן
                          </button>
                        </div>
                        <div style={{
                          maxHeight: 220, overflowY: "auto", border: "1px solid rgba(245,158,11,0.35)",
                          borderRadius: 8, background: "#fff",
                        }}>
                          {mutedGuests.map((g) => (
                            <label
                              key={g.id}
                              style={{
                                display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                                borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 13,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedMutedGuestIds.has(g.id)}
                                onChange={() => toggleMutedGuest(g.id)}
                                disabled={unmutingGuests}
                                style={{ width: 18, height: 18, accentColor: "var(--gold)" }}
                              />
                              <span style={{ flex: 1, fontWeight: 600 }}>{g.name || "—"}</span>
                              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                                {g.arrival_date ? new Date(`${g.arrival_date}T12:00:00`).toLocaleDateString("he-IL") : "—"}
                              </span>
                              <span style={{ color: "var(--text-muted)", fontSize: 12, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                                {g.room || "—"}
                              </span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
              {/* ── Segment tabs ── */}
              <div style={{ display: "flex", gap: 4, background: "var(--ivory)", borderRadius: 8, padding: 3 }}>
                {[
                  { key: "suite",   label: `🏨 סוויטות (${suiteQueue.length})` },
                  { key: "daypass", label: `☀️ יום-כיף (${dayPassQueue.length})` },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { setQueueSegment(key); setSelectedItems(new Set()); }}
                    style={{
                      background: queueSegment === key ? "#fff" : "transparent",
                      border: "none", cursor: "pointer",
                      padding: "6px 14px", borderRadius: 6, fontSize: 13,
                      fontWeight: queueSegment === key ? 700 : 500,
                      color: queueSegment === key ? "var(--gold-dark)" : "var(--text-muted)",
                      boxShadow: queueSegment === key ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.15s",
                    }}
                  >{label}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  תצוגת יום:
                  <input
                    type="date"
                    value={queuePreviewDate}
                    onChange={(e) => setQueuePreviewDate(e.target.value)}
                    style={{
                      padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)",
                      fontFamily: "Heebo, sans-serif", fontSize: 12,
                    }}
                  />
                  {queuePreviewDate && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setQueuePreviewDate(""); }}
                      title="חזור לשעון חי"
                    >
                      חי
                    </button>
                  )}
                </label>
                {queueData?.systemStatus?.previewAt && queuePreviewDate && (
                  <span style={{ fontSize: 10, color: "var(--gold-dark)" }} title="מדמה את אותו resolver כמו cron">
                    סימולציה: {new Date(queueData.systemStatus.previewAt).toLocaleDateString("he-IL")}
                  </span>
                )}
                {queueRefreshedAt && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }} title="מתעדכן אוטומטית אחרי שינוי במסע האורח">
                    עודכן: {queueRefreshedAt.toLocaleTimeString("he-IL")}
                  </span>
                )}
                <button className="btn btn-ghost btn-sm" onClick={fetchQueue} disabled={loadingQueue}>
                  {loadingQueue ? "⏳" : "↺"} רענון
                </button>
              </div>
            </div>

            {queueSegment === "daypass" && (
              <div style={{
                background: "rgba(124,58,237,0.06)", border: "1px solid #C4B5FD",
                borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#7C3AED",
              }}>
                🔒 <strong>שער Day Pass פעיל</strong> — אורחי יום-כיף מקבלים שישה שלבים:
                אישור הגעה (Stage 1), תזכורת ערב לפני (Stage 2.5 ←{" "}
                <code style={{ background: "rgba(124,58,237,0.1)", padding: "1px 5px", borderRadius: 4 }}>dream_checkin_reminder_v2</code>),
                בוקר הגעה (Stage 3 ←{" "}
                <code style={{ background: "rgba(124,58,237,0.1)", padding: "1px 5px", borderRadius: 4 }}>suite_welcome_morning</code>),
                שיחות נימוסים (Stage 4 ←{" "}
                <code style={{ background: "rgba(124,58,237,0.1)", padding: "1px 5px", borderRadius: 4 }}>dream_mid_stay_check</code>),
                ומשוב (Stage 5 ←{" "}
                <code style={{ background: "rgba(124,58,237,0.1)", padding: "1px 5px", borderRadius: 4 }}>dream_checkout_feedback</code>).
                שלבי סוויטות (morning_suite, mid_stay, night_before וכו׳) חסומים אוטומטית גם בממשק וגם בשרת.
              </div>
            )}

            {queueError && (
              <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#C0392B" }}>
                שגיאה בטעינת התור: {queueError}
              </div>
            )}

            {queueData && (
              <>
                {/* ── Pulse ── */}
                <div className="card" style={{ marginBottom: 16, padding: "16px 20px" }}>
                  <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>💓 פעימת חיים</div>
                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13 }}>
                    <span>{queueData.systemStatus.cronEnabled ? "🟢" : "🔴"} CRON_ENABLED (תזמון אוטומטי)</span>
                    <span>{queueData.systemStatus.automationEnabled ? "🟢" : "🔴"} AUTOMATION_ENABLED (שליחה כללית)</span>
                    <span>{queueData.systemStatus.simulation ? "🟡 סימולציה" : "🟢 שליחה אמיתית"}</span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    <strong>שלבים בתזמון cron ({cronActiveStageKeys.length}):</strong>{" "}
                    {cronActiveStageKeys.length > 0 ? cronActiveStageKeys.join(", ") : "—"}
                  </div>
                  {eventImmediateStageKeys.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                      <strong>שלבים מיידיים (webhook, לא בתור):</strong>{" "}
                      {eventImmediateStageKeys.join(", ")}
                    </div>
                  )}
                  {missingCoreStages.length > 0 && (
                    <div style={{
                      marginTop: 8, fontSize: 12, color: "#C0392B",
                      background: "#FFF0EE", borderRadius: 8, padding: "8px 12px",
                      border: "1px solid #C0392B",
                    }}>
                      ⚠ שלבי צינור חסרים/מושבתים: <code>{missingCoreStages.join(", ")}</code>
                      {missingCoreStages.some((k) => k.includes("mid_stay") || k.includes("checkout_fb")) && (
                        <span> — ודא ש-migration 099 הורץ (פיצול Stage 4/5 לסוויטות+יום-כיף).</span>
                      )}
                    </div>
                  )}
                  {(!queueData.systemStatus.cronEnabled || !queueData.systemStatus.automationEnabled) && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                      ⚠ אחד או יותר ממפסקי החיים כבוי — האוטומציה האוטומטית (cron) לא תשלח הודעות בפועל כרגע. זהו המצב המתועד הנוכחי, לא תקלה.
                    </div>
                  )}
                </div>

                {/* ── Attention required (accordion, top-5, clear-all) ── */}
                {(() => {
                  const isCriticalAttention = (r) =>
                    r.status === "failed" || r.status === "timeout";
                  const visibleAttention = queueData.attentionRequired
                    .filter(isCriticalAttention)
                    .filter((r) => !dismissedAttentionKeys.has(attentionItemKey(r)))
                    .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0))
                    .slice(0, 5);
                  const totalActive = queueData.attentionRequired.filter(
                    (r) => isCriticalAttention(r) && !dismissedAttentionKeys.has(attentionItemKey(r)),
                  ).length;
                  const hasCritical = visibleAttention.length > 0;
                  const dismissAll = (e) => {
                    e.stopPropagation();
                    const keys = new Set(dismissedAttentionKeys);
                    queueData.attentionRequired
                      .filter(isCriticalAttention)
                      .forEach((r) => keys.add(attentionItemKey(r)));
                    setDismissedAttentionKeys(keys);
                    setAttentionOpen(false);
                  };
                  return (
                    <div className="card" style={{ marginBottom: 16, border: hasCritical && attentionOpen ? "1px solid #C0392B" : undefined }}>
                      <div
                        className="card-header"
                        style={{ cursor: "pointer", userSelect: "none" }}
                        onClick={() => setAttentionOpen((o) => !o)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 12 }}>
                          <div className="card-title" style={{ color: hasCritical ? "#C0392B" : "#1A7A4A", display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, display: "inline-block", transform: attentionOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▶</span>
                            {hasCritical ? "🔴" : "✅"} דורש טיפול
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
                              ({hasCritical ? `${visibleAttention.length}${totalActive > 5 ? ` מוצגים מתוך ${totalActive}` : ""}` : "0"})
                            </span>
                          </div>
                          {hasCritical && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: "#C0392B", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}
                              onClick={dismissAll}
                            >
                              ✕ ניקוי וסגירת הכל
                            </button>
                          )}
                        </div>
                      </div>
                      {attentionOpen && (
                        hasCritical ? (
                          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                            <div className="actr-scroll" style={{ maxHeight: 260, overflowY: "auto" }}>
                              <table className="table" style={{ minWidth: 480 }}>
                                <thead><tr><th>אורח</th><th>שלב</th><th>סטטוס</th><th>זמן</th></tr></thead>
                                <tbody>
                                  {visibleAttention.map((r, i) => (
                                    <tr key={i}>
                                      <td>
                                        <QueueGuestInboxLink
                                          guestName={r.guestName ?? r.phone ?? "—"}
                                          phone={r.phone}
                                          onOpenDreamBotChat={onOpenDreamBotChat}
                                        />
                                      </td>
                                      <td>{stageDisplayNames[r.stageKey] ?? `⚠ ${r.stageKey}`}</td>
                                      <td><span className="badge badge-red">{r.status === "timeout" ? "לא ודאי" : "נכשל"}</span></td>
                                      <td style={{ fontSize: 12 }}>{r.sentAt ? new Date(r.sentAt).toLocaleString("he-IL") : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>אין כשלים ב-7 הימים האחרונים 🎉</div>
                        )
                      )}
                    </div>
                  );
                })()}

                {/* ── Blocked by Meta — template pending approval (orange, non-critical) ── */}
                {(() => {
                  const blockedItems = queueData.attentionRequired.filter(
                    (r) => r.status === "blocked_by_meta"
                      && !dismissedAttentionKeys.has(attentionItemKey(r)),
                  );
                  if (blockedItems.length === 0) return null;
                  const dismissAllBlocked = () => {
                    const keys = new Set(dismissedAttentionKeys);
                    queueData.attentionRequired
                      .filter((r) => r.status === "blocked_by_meta")
                      .forEach((r) => keys.add(attentionItemKey(r)));
                    setDismissedAttentionKeys(keys);
                  };
                  return (
                    <div className="card" style={{ marginBottom: 16, border: "1px solid #E67E22" }}>
                      <div className="card-header">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 12 }}>
                          <div className="card-title" style={{ color: "#B5600A", display: "flex", alignItems: "center", gap: 8 }}>
                            🟠 ממתין לאישור Meta
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
                              ({blockedItems.length})
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <span className="badge badge-orange">⏳ Pending</span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ color: "#B5600A", fontSize: 12, whiteSpace: "nowrap" }}
                              title="הסר את כל השורות מהתצוגה — לא משפיע על האוטומציה בשרת"
                              onClick={dismissAllBlocked}
                            >
                              🗑️ נקה הכל
                            </button>
                          </div>
                        </div>
                      </div>
                      <div style={{ padding: "8px 16px 10px", background: "rgba(230,126,34,0.05)", fontSize: 12, color: "#7F8C8D", borderBottom: "1px solid rgba(230,126,34,0.2)" }}>
                        ✅ לוגיקת האוטומציה הפנימית הופעלה — Meta טרם אישרה את התבנית. ה-CRON יחזור וינסה שוב בכל 15 דקות, ללא פעולה נדרשת ממך.
                      </div>
                      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                        <table className="table" style={{ minWidth: 540 }}>
                          <thead>
                            <tr>
                              <th>אורח</th>
                              <th>שלב</th>
                              <th>תבנית Meta</th>
                              <th>סטטוס</th>
                              <th>זמן</th>
                              <th style={{ width: 56, textAlign: "center" }}>פעולות</th>
                            </tr>
                          </thead>
                          <tbody>
                            {blockedItems.map((r, i) => {
                              const rowKey = attentionItemKey(r);
                              return (
                              <tr key={rowKey || i}>
                                <td>
                                  <QueueGuestInboxLink
                                    guestName={r.guestName ?? r.phone ?? "—"}
                                    phone={r.phone}
                                    onOpenDreamBotChat={onOpenDreamBotChat}
                                  />
                                </td>
                                <td>{stageDisplayNames[r.stageKey] ?? `⚠ ${r.stageKey}`}</td>
                                <td style={{ fontSize: 11, fontFamily: "monospace", color: "#B5600A" }}>
                                  {r.payload?.template ?? "—"}
                                </td>
                                <td><span className="badge badge-orange">⏳ ממתין לאישור</span></td>
                                <td style={{ fontSize: 11 }}>
                                  {r.sentAt ? new Date(r.sentAt).toLocaleString("he-IL") : "—"}
                                </td>
                                <td style={{ textAlign: "center" }}>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    title="הסר מהתצוגה — לא משפיע על האוטומציה בשרת"
                                    onClick={() => dismissAttentionItem(rowKey)}
                                    style={{ fontSize: 14, padding: "2px 8px", color: "#B5600A" }}
                                  >
                                    🗑️
                                  </button>
                                </td>
                              </tr>
                            );})}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Duplicate blocked — automation shield (informational) ── */}
                {(() => {
                  const duplicateItems = queueData.attentionRequired.filter(
                    (r) => r.status === "duplicate_blocked"
                      && !dismissedAttentionKeys.has(attentionItemKey(r)),
                  );
                  if (duplicateItems.length === 0) return null;
                  const dismissAllDup = () => {
                    const keys = new Set(dismissedAttentionKeys);
                    queueData.attentionRequired
                      .filter((r) => r.status === "duplicate_blocked")
                      .forEach((r) => keys.add(attentionItemKey(r)));
                    setDismissedAttentionKeys(keys);
                  };
                  return (
                    <div className="card" style={{ marginBottom: 16, border: "1px solid #7C3AED" }}>
                      <div className="card-header">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 12 }}>
                          <div className="card-title" style={{ color: "#5B21B6", display: "flex", alignItems: "center", gap: 8 }}>
                            🔁 כפילויות נחסמו
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
                              ({duplicateItems.length})
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: "#5B21B6", fontSize: 12, whiteSpace: "nowrap" }}
                            title="הסר מהתצוגה — לא משפיע על האוטומציה"
                            onClick={dismissAllDup}
                          >
                            🗑️ נקה הכל
                          </button>
                        </div>
                      </div>
                      <div style={{ padding: "8px 16px 10px", background: "rgba(124,58,237,0.05)", fontSize: 12, color: "#7F8C8D", borderBottom: "1px solid rgba(124,58,237,0.2)" }}>
                        מגן האוטומציה זיהה ניסיון לשלוח שוב שלב שכבר נשלח בהצלחה — ההודעה לא יצאה לאורח. רשומה בטאב «מה נשלח».
                      </div>
                      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                        <table className="table" style={{ minWidth: 480 }}>
                          <thead><tr><th>אורח</th><th>שלב</th><th>זמן</th><th style={{ width: 56 }} /></tr></thead>
                          <tbody>
                            {duplicateItems.map((r, i) => {
                              const rowKey = attentionItemKey(r);
                              return (
                                <tr key={rowKey || i}>
                                  <td>
                                    <QueueGuestInboxLink
                                      guestName={r.guestName ?? r.phone ?? "—"}
                                      phone={r.phone}
                                      onOpenDreamBotChat={onOpenDreamBotChat}
                                    />
                                  </td>
                                  <td>{stageDisplayNames[r.stageKey] ?? `⚠ ${r.stageKey}`}</td>
                                  <td style={{ fontSize: 11 }}>{r.sentAt ? new Date(r.sentAt).toLocaleString("he-IL") : "—"}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      title="הסר מהתצוגה"
                                      onClick={() => dismissAttentionItem(rowKey)}
                                      style={{ fontSize: 14, padding: "2px 8px", color: "#5B21B6" }}
                                    >
                                      🗑️
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Missing payment link — Stage 2 Pay guardrail failures ── */}
                {(() => {
                  const missingLinkItems = queueData.attentionRequired.filter(
                    (r) => r.status === "failed_missing_link",
                  );
                  if (missingLinkItems.length === 0) return null;
                  return (
                    <div className="card" style={{ marginBottom: 16, border: "1px solid #C0392B" }}>
                      <div className="card-header">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                          <div className="card-title" style={{ color: "#C0392B", display: "flex", alignItems: "center", gap: 8 }}>
                            ❌ חסר קישור תשלום ישיר
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
                              ({missingLinkItems.length})
                            </span>
                          </div>
                          <span className="badge badge-red">Stage 2 Pay</span>
                        </div>
                      </div>
                      <div style={{ padding: "8px 16px 10px", background: "rgba(192,57,43,0.05)", fontSize: 12, color: "#7F8C8D", borderBottom: "1px solid rgba(192,57,43,0.2)" }}>
                        שיגור נכשל: חסר קישור תשלום ישיר — עדכנו קישור תשלום באורח או הזינו ezgo_portal_url לשחזור אוטומטי.
                      </div>
                      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                        <table className="table" style={{ minWidth: 540 }}>
                          <thead>
                            <tr>
                              <th>אורח</th>
                              <th>שלב</th>
                              <th>סטטוס</th>
                              <th>זמן</th>
                            </tr>
                          </thead>
                          <tbody>
                            {missingLinkItems.map((r, i) => (
                              <tr key={i}>
                                <td>
                                  <QueueGuestInboxLink
                                    guestName={r.guestName ?? r.phone ?? "—"}
                                    phone={r.phone}
                                    onOpenDreamBotChat={onOpenDreamBotChat}
                                  />
                                </td>
                                <td>{stageDisplayNames[r.stageKey] ?? `⚠ ${r.stageKey}`}</td>
                                <td><span className="badge badge-red">שיגור נכשל: חסר קישור תשלום ישיר</span></td>
                                <td style={{ fontSize: 12 }}>{r.sentAt ? new Date(r.sentAt).toLocaleString("he-IL") : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Upcoming queue — grouped by arrival day ── */}
                <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>
                    📋 תור לפי יום הגעה — {queueSegment === "daypass" ? "יום-כיף" : "סוויטות"}
                    <span style={{ fontWeight: 500, fontSize: 13, color: "var(--text-muted)", marginRight: 8 }}>
                      ({displayQueue.length} שלבים · {arrivalDayGroups.reduce((n, d) => n + d.guests.length, 0)} אורחים)
                    </span>
                  </div>
                  {displayQueue.length > 0 && (
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        style={{ width: 16, height: 16 }}
                      />
                      בחר הכל לשיגור
                    </label>
                  )}
                </div>

                {displayQueue.length === 0 ? (
                  <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                    אין פריטים בתור עבור קטגוריה זו כרגע
                  </div>
                ) : (
                  arrivalDayGroups.map((day) => {
                    const isCollapsed = collapsedArrivalDays.has(day.dateKey);
                    const dayBorder = day.isToday
                      ? "var(--gold)"
                      : day.isPast
                      ? "var(--border)"
                      : queueSegment === "daypass"
                      ? "#C4B5FD"
                      : "#93C5FD";
                    const dayBg = day.isToday
                      ? "rgba(201,169,110,0.08)"
                      : day.isPast
                      ? "rgba(0,0,0,0.02)"
                      : queueSegment === "daypass"
                      ? "rgba(124,58,237,0.04)"
                      : "rgba(3,105,161,0.04)";

                    return (
                      <div
                        key={day.dateKey}
                        className="card"
                        style={{ marginBottom: 14, border: `2px solid ${dayBorder}`, overflow: "hidden" }}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleArrivalDay(day.dateKey)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleArrivalDay(day.dateKey); }}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "12px 18px", cursor: "pointer", background: dayBg,
                            borderBottom: isCollapsed ? "none" : `1px solid ${dayBorder}`,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{
                              fontSize: 11, display: "inline-block",
                              transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                              transition: "transform 0.2s", color: "var(--text-muted)",
                            }}>▶</span>
                            <span style={{ fontWeight: 800, fontSize: 15 }}>📅 {day.label}</span>
                            {day.isToday && <span className="badge badge-gold">היום</span>}
                            {day.isPast && <span className="badge" style={{ background: "#eee", color: "#666" }}>עבר</span>}
                          </div>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {day.guests.length} אורחים · {day.itemCount} שלבים
                          </span>
                        </div>

                        {!isCollapsed && (() => {
                          const stageChips = buildDayStageChips(day, isDispatchable, DAY_PASS_ALLOWED_STAGES);
                          const dayKeys = stageChips.flatMap((s) => s.itemKeys);
                          const allDaySel = dayKeys.length > 0 && dayKeys.every((k) => selectedItems.has(k));
                          const someDaySel = !allDaySel && dayKeys.some((k) => selectedItems.has(k));
                          if (stageChips.length === 0) return null;
                          return (
                            <div
                              style={{ padding: "10px 16px", borderBottom: `1px solid ${dayBorder}`, background: "var(--ivory)" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>
                                בחירה מהירה לפי שלב
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                <button
                                  type="button"
                                  style={stageChipStyle(allDaySel, someDaySel)}
                                  onClick={() => toggleStageKeys(dayKeys)}
                                >
                                  {allDaySel ? "✓" : someDaySel ? "◐" : "☐"}{" "}
                                  כל היום ({dayKeys.length})
                                </button>
                                {stageChips.map(({ stageKey, displayName, itemKeys }) => {
                                  const allSel = itemKeys.length > 0 && itemKeys.every((k) => selectedItems.has(k));
                                  const someSel = !allSel && itemKeys.some((k) => selectedItems.has(k));
                                  return (
                                    <button
                                      key={stageKey}
                                      type="button"
                                      style={stageChipStyle(allSel, someSel)}
                                      onClick={() => toggleStageKeys(itemKeys)}
                                      title={displayName}
                                    >
                                      {allSel ? "✓" : someSel ? "◐" : "☐"}{" "}
                                      {shortStageLabel(displayName, stageKey)} ({itemKeys.length})
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {!isCollapsed && day.guests.map((guest) => {
                          const health = summarizeGuestQueueHealth(guest.items);
                          return (
                          <div
                            key={guest.guestId}
                            style={{ borderBottom: "1px solid var(--border)", padding: "12px 16px 14px" }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                              <QueueGuestInboxLink
                                guestName={guest.guestName}
                                phone={guest.phone}
                                onOpenDreamBotChat={onOpenDreamBotChat}
                              />
                              {health.sent > 0 && (
                                <span className="badge badge-green" title="שלבים שנשלחו בהצלחה (notification_log)">
                                  ✅ {health.sent} נשלחו
                                </span>
                              )}
                              {health.failed > 0 && (
                                <span className="badge badge-red" title="שלבים שנכשלו או בסטטוס לא ודאי">
                                  ❌ {health.failed} כשל
                                </span>
                              )}
                              {health.blocked > 0 && (
                                <span className="badge badge-orange" title="חסום ע״י Meta — תבנית ממתינה לאישור">
                                  🟠 {health.blocked} Meta
                                </span>
                              )}
                              {health.dueNow > 0 && health.failed === 0 && (
                                <span className="badge badge-gold" title="שלבים שמוכנים לשליחה עכשיו">
                                  ⚡ {health.dueNow} מוכן
                                </span>
                              )}
                              {guest.room && (
                                <span style={{ fontSize: 12, padding: "2px 10px", borderRadius: 12, background: "var(--ivory)", border: "1px solid var(--border)" }}>
                                  🏨 {guest.room}
                                </span>
                              )}
                              {guest.roomTypeConflict && <RoomTypeConflictBadge />}
                              {guest.departureDate && (
                                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                  עזיבה: {new Date(`${guest.departureDate}T12:00:00`).toLocaleDateString("he-IL")}
                                </span>
                              )}
                              <span style={{ marginRight: "auto", fontSize: 11, color: "var(--text-muted)" }}>
                                {guest.items.length} שלבים פעילים
                              </span>
                            </div>

                            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                              <table className="table" style={{ minWidth: 640, marginBottom: 0 }}>
                                <thead>
                                  <tr style={{ fontSize: 11 }}>
                                    <th style={{ width: 32 }} />
                                    <th>שלב</th>
                                    <th>מועד משוער</th>
                                    <th>ערוץ</th>
                                    <th>סטטוס</th>
                                    <th style={{ width: 110, textAlign: "center" }}>פעולות</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {guest.items.map((q) => {
                                    const itemKey = `${q.guestId}_${q.stageKey}`;
                                    const canDispatch = isDispatchable(q);
                                    const isGated = isQueueItemGated(q, DAY_PASS_ALLOWED_STAGES);
                                    const isChecked = selectedItems.has(itemKey);
                                    const badge = queueStatusBadge(q);
                                    const proofLine = queueDeliveryProofLine(q);
                                    return (
                                      <tr
                                        key={itemKey}
                                        style={{
                                          background: isChecked
                                            ? "rgba(201,169,110,0.12)"
                                            : q.dueNow
                                            ? "rgba(201,169,110,0.06)"
                                            : undefined,
                                        }}
                                      >
                                        <td style={{ textAlign: "center" }}>
                                          {canDispatch && !isGated ? (
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={() => toggleItem(itemKey)}
                                              style={{ cursor: "pointer", width: 16, height: 16 }}
                                            />
                                          ) : (
                                            <span title={isGated ? "חסום ליום-כיף" : "לא זמין לשליחה"} style={{ color: "var(--text-muted)" }}>
                                              {isGated ? "🔒" : "—"}
                                            </span>
                                          )}
                                        </td>
                                        <td style={{ fontSize: 13, fontWeight: 600 }}>{q.displayName}</td>
                                        <td style={{ fontSize: 12 }}>
                                          {formatQueueScheduleCell(q)}
                                        </td>
                                        <td>
                                          <span style={{
                                            fontSize: 10, padding: "2px 7px", borderRadius: 10,
                                            background: q.predictedChannel === "session_message" ? "#E8F5EF" : "#E0F2FE",
                                            color: q.predictedChannel === "session_message" ? "#1A7A4A" : "#0369A1",
                                          }}>
                                            {q.predictedChannel === "session_message" ? "סשן" : "תבנית"}
                                          </span>
                                        </td>
                                        <td>
                                          <span className={`badge ${badge.cls}`}>{badge.text}</span>
                                          {proofLine && (
                                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }} title="מבוסס notification_log">
                                              {proofLine}
                                            </div>
                                          )}
                                          {q.skipReason && !SKIP_REASON_LABELS[q.skipReason] && (
                                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{q.skipReason}</div>
                                          )}
                                        </td>
                                        <td style={{ textAlign: "center" }}>
                                          <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                                            {canDispatch && (
                                              <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                title={`שלח עכשיו — ${q.displayName}`}
                                                onClick={() => requestQueueSendNow(q)}
                                                disabled={sendNowSending || !q.guestId}
                                                style={{ fontSize: 10, padding: "3px 7px" }}
                                              >
                                                שלח
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              className="btn btn-ghost btn-sm"
                                              title="שגר ידני"
                                              onClick={() => setManualDispatchItem(q)}
                                              disabled={!q.guestId || sendNowSending}
                                              style={{ fontSize: 13, padding: "2px 6px", color: "var(--gold)" }}
                                            >
                                              ⚡
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {/* ── Sticky Bulk Action Bar — visible when items are selected ── */}
            {selectedItems.size > 0 && (
              <div style={{
                position: "sticky", bottom: 0, zIndex: 200,
                background: "#fff",
                borderTop: "2px solid var(--gold)",
                padding: "12px 20px",
                display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
                boxShadow: "0 -4px 20px rgba(0,0,0,0.1)",
                borderRadius: "12px 12px 0 0",
              }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  ✅ {selectedItems.size} נבחרו
                </span>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setScheduleError(null);
                    setShowScheduleModal(true);
                  }}
                  disabled={dispatching || scheduling}
                  style={{ minWidth: 150, background: "var(--gold-dark)", borderColor: "var(--gold-dark)" }}
                  title="שמור שעות שליחה — ה-cron ישלח אוטומטית"
                >
                  📅 תזמן שליחה
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setDispatchViaWhapi(false);
                    setShowDispatchConfirm(true);
                  }}
                  disabled={dispatching || scheduling}
                  style={{ minWidth: 180 }}
                >
                  {dispatching && !dispatchViaWhapi
                    ? (dispatchProgress
                      ? `⏳ שולח ${dispatchProgress.current}/${dispatchProgress.total}…`
                      : "⏳ שולח...")
                    : "🚀 אשר ושגר"}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setDispatchViaWhapi(true);
                    setShowDispatchConfirm(true);
                  }}
                  disabled={dispatching || scheduling}
                  style={{ minWidth: 200, background: "#1A7A4A", borderColor: "#1A7A4A" }}
                  title="שגר את הנבחרים דרך מכשיר הסוויטות (Whapi) במקום Dream Bot — שלבים שאינם נתמכים עדיין ידולגו"
                >
                  {dispatching && dispatchViaWhapi
                    ? (dispatchProgress
                      ? `⏳ שולח ${dispatchProgress.current}/${dispatchProgress.total}…`
                      : "⏳ שולח...")
                    : "📱 שגר דרך מכשיר הסוויטות"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedItems(new Set())}
                  disabled={dispatching || scheduling}
                >
                  ✕ ביטול בחירה
                </button>
                {dispatching && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    פעימה של {BULK_SEND_PULSE_MS / 1000}ש׳ בין הודעות — אל תסגור את הדף
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {subTab === "history" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={fetchHistory} disabled={loadingHistory}>
              {loadingHistory ? "⏳" : "↺"} רענון
            </button>
          </div>

          {historyError && (
            <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#C0392B" }}>
              שגיאה בטעינת ההיסטוריה: {historyError}
            </div>
          )}

          <div className="card">
            <div className="card-header"><div className="card-title">📜 מה נשלח — {historyData?.length ?? 0} שורות אחרונות</div></div>
            {!historyData || historyData.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                {loadingHistory ? "⏳ טוען..." : "אין עדיין היסטוריית שליחה"}
              </div>
            ) : (
              <>
                {/* Filter chips */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 16px 0" }}>
                  {[
                    { key: "all",     label: "הכל" },
                    { key: "ok",      label: "✅ נשלח" },
                    { key: "blocked", label: "🟠 ממתין Meta" },
                    { key: "duplicate", label: "🔁 כפילות נחסמה" },
                    { key: "failed",  label: "❌ כשלים" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setHistoryStatusFilter(key)}
                      className={`badge ${key === "ok" ? "badge-green" : key === "blocked" ? "badge-orange" : key === "failed" ? "badge-red" : "badge-gray"}`}
                      style={{
                        cursor: "pointer",
                        border: historyStatusFilter === key ? "2px solid currentColor" : "2px solid transparent",
                        fontWeight: historyStatusFilter === key ? 700 : 400,
                        fontSize: 12,
                        padding: "4px 12px",
                        borderRadius: 20,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Table */}
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginTop: 10 }}>
                  <table className="table" style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>אורח</th>
                        <th>שלב</th>
                        <th>מועד מתוכנן</th>
                        <th>זמן שליחה בפועל</th>
                        <th>סטטוס</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData
                        .filter((h) => {
                          if (historyStatusFilter === "ok") return h.status === "sent" || h.status === "simulated";
                          if (historyStatusFilter === "blocked") return h.status === "blocked_by_meta";
                          if (historyStatusFilter === "duplicate") return h.status === "duplicate_blocked";
                          if (historyStatusFilter === "failed") {
                            return h.status === "failed" || h.status === "timeout"
                              || h.status === "failed_missing_link";
                          }
                          return true;
                        })
                        .map((h) => (
                          <tr key={h.id}>
                            <td style={{ fontWeight: 700 }}>{h.guestName ?? "—"}</td>
                            <td>{h.stageDisplayName}</td>
                            <td style={{ fontSize: 12 }}>{h.scheduledFor ? new Date(h.scheduledFor).toLocaleString("he-IL") : "מיידי / ידני"}</td>
                            <td style={{ fontSize: 12 }}>{h.actualSentAt ? new Date(h.actualSentAt).toLocaleString("he-IL") : "—"}</td>
                            <td>
                              <span className={`badge ${
                                h.status === "sent" || h.status === "simulated" ? "badge-green"
                                : h.status === "duplicate_blocked" ? "badge-orange"
                                : h.status === "blocked_by_meta" ? "badge-orange"
                                : h.status === "failed_missing_link" ? "badge-red"
                                : "badge-red"
                              }`}>
                                {h.status === "sent" ? "✅ נשלח"
                                  : h.status === "simulated" ? "✅ סימולציה"
                                  : h.status === "duplicate_blocked" ? "🔁 כפילות נחסמה"
                                  : h.status === "blocked_by_meta" ? "🟠 ממתין לאישור Meta"
                                  : h.status === "failed_missing_link" ? "❌ חסר קישור תשלום"
                                  : h.status === "timeout" ? "❌ לא ודאי"
                                  : "❌ נכשל"}
                              </span>
                              {h.error && <div style={{ fontSize: 10, color: "#C0392B", marginTop: 2, maxWidth: 280 }}>{h.error}</div>}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {subTab === "builder" && (
        <CustomAutomationBuilder metaTemplatesByName={metaTemplatesByName} showToast={showToast} />
      )}

      {subTab === "preview" && (
        <TemplateTestPanel
          metaTemplatesByName={metaTemplatesByName}
          showToast={showToast}
          defaultPhone={staffTestPhone}
        />
      )}

      {subTab === "templates" && (
        <TemplateManagerPanel
          showToast={showToast}
          initialCreateDraft={templateDraft}
          onDraftConsumed={() => setTemplateDraft(null)}
        />
      )}

      {subTab === "health" && (
        <div style={{ maxWidth: 900 }}>
          <div style={{
            background: "linear-gradient(135deg, rgba(201,169,110,0.12) 0%, rgba(201,169,110,0.04) 100%)",
            border: "1px solid var(--gold)", borderRadius: 12, padding: "14px 20px", marginBottom: 20,
            fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6,
          }}>
            🩺 תצוגה חיה, קריאה-בלבד (preview) — לא שולחת התראה ולא כותבת מצב. קרון נפרד
            (<code>automation-health-cron</code>, כל 10 דק׳) מריץ את אותן בדיקות ומתריע ל-Whapi
            בפועל רק אחרי הדלקת <code>AUTOMATION_HEALTH_ENABLED=true</code> ב-Supabase Secrets.
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={fetchHealth} disabled={loadingHealth}>
              {loadingHealth ? "⏳ טוען..." : "🔄 רענן"}
            </button>
            {healthRefreshedAt && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                עודכן: {healthRefreshedAt.toLocaleTimeString("he-IL")}
              </span>
            )}
          </div>

          {healthError && (
            <div style={{
              background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 10,
              padding: 16, color: "#C0392B", marginBottom: 16,
            }}>
              ⚠️ שגיאה בטעינת בריאות אוטומציה: {healthError}
            </div>
          )}

          {!healthError && loadingHealth && !healthChecks && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>⏳ טוען בדיקות...</div>
          )}

          {!healthError && !loadingHealth && healthChecks && healthChecks.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>אין בדיקות זמינות.</div>
          )}

          {healthChecks && healthChecks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {healthChecks.map((c) => {
                const bad = !!c.bad;
                return (
                  <div key={c.checkKey} style={{
                    border: `1px solid ${bad ? "#C0392B" : "#1A7A4A"}`,
                    background: bad ? "#FFF0EE" : "#E8F5EF",
                    borderRadius: 10, padding: "12px 16px",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      fontWeight: 700, color: bad ? "#C0392B" : "#1A7A4A",
                    }}>
                      <span>{bad ? "🚨" : "✅"}</span>
                      <span>{healthCheckLabel(c.checkKey)}</span>
                    </div>
                    {c.detail && Object.keys(c.detail).length > 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, fontFamily: "monospace" }}>
                        {Object.entries(c.detail)
                          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                          .join("   ·   ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
