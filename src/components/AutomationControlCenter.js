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
// The one exception: stage_2_arrival is dispatched directly by
// whatsapp-webhook/index.ts via its own hardcoded bot_scripts lookup and
// never checks automation_stages.is_active — for that row only, the
// toggle is still cosmetic today. (stage_2_pay, despite also being
// event_immediate, DOES check automation_stages.is_active in the webhook
// — its toggle is live.)
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import TemplateManagerPanel, { STATUS_META } from "./TemplateManagerPanel";
import TemplateTestPanel from "./TemplateTestPanel";
import ScheduledOverrideConfirmModal from "./ScheduledOverrideConfirmModal";
import QuietHoursGate from "./QuietHoursGate";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";
import { isFutureScheduledQueueItem } from "../utils/israelTime";

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
  "night_before", "night_before_daypass",
  "morning_suite", "morning_welcome",
  "mid_stay", "mid_stay_daypass",
  "checkout_fb", "checkout_fb_daypass",
];

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
  "pre_arrival_2d", "night_before_daypass", "morning_welcome",
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
  "https://dream-ai-system.vercel.app/images/image_3cde8f.jpg";

async function invokeForcedDispatch({ guestId, stageKey, forceChannel, scheduledFor, imageUrl }) {
  return supabase.functions.invoke("whatsapp-send", {
    body: {
      trigger: stageKey,
      guestId,
      force: true,
      // night_before: omit force_channel — server picks session vs template from live wa_window_expires_at
      ...(stageKey !== "night_before" && forceChannel ? { force_channel: forceChannel } : {}),
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

  const isDayType = item.room_type === "day_guest" || item.room_type === "premium_day_guest";

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

  // When stage changes, revert to meta_template if session is not available.
  useEffect(() => {
    if (channel === "session_message" && !hasScriptKey) setChannel("meta_template");
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

export default function AutomationControlCenter() {
  const [subTab, setSubTab] = useState("timeline"); // timeline | queue | history | builder | preview | templates
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
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [dismissedAttentionKeys, setDismissedAttentionKeys] = useState(new Set());

  // ── Segment tabs + bulk dispatch ─────────────────────────────────────────
  const [queueSegment, setQueueSegment] = useState("suite");   // "suite" | "daypass"
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [dispatching, setDispatching] = useState(false);
  const [dispatchSummary, setDispatchSummary] = useState(null);
  const [showDispatchConfirm, setShowDispatchConfirm] = useState(false);

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
      const { data, error } = await supabase.functions.invoke("automation-queue");
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "unknown error");
      setQueueData(data);

      const futureTasks = (data.queue ?? []).filter(
        (q) => q.scheduledFor
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
  }, []);

  useEffect(() => { if (subTab === "queue") fetchQueue(); }, [subTab, fetchQueue]);

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
        showToast("ok", `✅ ${item.guestName} — ${item.displayName ?? item.stageKey} — נשלח עכשיו`);
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

  // ── Bulk dispatch — same call as whatsapp-cron uses ──────────────────────
  const handleBulkDispatch = async (displayQueue) => {
    if (!isSupabaseConfigured || !supabase) return;
    setDispatching(true);
    const results = [];

    for (const itemKey of selectedItems) {
      const item = displayQueue.find((q) => `${q.guestId}_${q.stageKey}` === itemKey);
      if (!item) continue;

      // Client-side Safety Gate — matches server guard in whatsapp-send BRANCH D.
      if ((item.room_type === "day_guest" || item.room_type === "premium_day_guest") && !DAY_PASS_ALLOWED_STAGES.has(item.stageKey)) {
        results.push({ item, result: "blocked", reason: "day_pass_stage_gate" });
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: item.stageKey, guestId: item.guestId },
        });
        if (error) {
          results.push({ item, result: "error", error: error.message });
        } else if (data?.skipped) {
          results.push({ item, result: "skipped", reason: data.reason });
        } else if (data?.ok) {
          results.push({ item, result: "sent", simulation: data.simulation });
        } else {
          results.push({ item, result: "failed", error: data?.error ?? "unknown" });
        }
      } catch (e) {
        results.push({ item, result: "error", error: e?.message ?? String(e) });
      }

      // 300ms throttle between sends — Meta rate-limit safety.
      await new Promise((r) => setTimeout(r, 300));
    }

    setDispatching(false);
    setSelectedItems(new Set());
    setDispatchSummary({
      total:   results.length,
      sent:    results.filter((r) => r.result === "sent").length,
      skipped: results.filter((r) => r.result === "skipped").length,
      blocked: results.filter((r) => r.result === "blocked").length,
      failed:  results.filter((r) => r.result === "failed" || r.result === "error").length,
      details: results,
    });
    fetchQueue();
  };

  // stage_key → display_name, reused by the Queue tab so it never shows a
  // raw stage_key/trigger_type token to the manager.
  const stageDisplayNames = stages.reduce((acc, s) => {
    acc[s.stage_key] = s.display_name;
    return acc;
  }, {});

  const activeStageKeys = stages.filter((s) => s.is_active).map((s) => s.stage_key);
  const missingCoreStages = CORE_PIPELINE_STAGE_KEYS.filter((k) => !activeStageKeys.includes(k));

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
            החריג היחיד: שלב "אישור הגעה" (Stage 2 Arrival) — whatsapp-webhook שולח אותו ישירות מ-bot_scripts ולא בודק את המתג כאן,
            כך שעבור השלב הזה בלבד ההפעלה/כיבוי עדיין קוסמטית.
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
        const allQueue    = queueData?.queue ?? [];
        const suiteQueue  = allQueue.filter((q) => q.room_type !== "day_guest" && q.room_type !== "premium_day_guest");
        const dayPassQueue = allQueue.filter((q) => q.room_type === "day_guest" || q.room_type === "premium_day_guest");
        const displayQueue = (queueSegment === "daypass" ? dayPassQueue : suiteQueue).slice(0, 100);

        // An item is dispatchable if it hasn't been successfully sent yet
        // and has a valid guestId to call whatsapp-send with.
        const isDispatchable = (q) =>
          q.guestId && !["sent", "simulated", "skipped"].includes(q.status);

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
                  <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 10 }}>🚀 אשר שגר הודעות</div>
                  <div style={{ fontSize: 14, color: "#444", lineHeight: 1.7, marginBottom: 20 }}>
                    עומד לשלוח <strong>{selectedItems.size} הודעות</strong> לאורחים שנבחרו.
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
                  </div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-start" }}>
                    <button
                      className="btn btn-primary"
                      style={{ minWidth: 140 }}
                      onClick={() => {
                        setShowDispatchConfirm(false);
                        // displayQueue is captured from the outer IIFE scope via closure.
                        // We re-derive it here to avoid stale-closure issues.
                        const allQueue    = queueData?.queue ?? [];
                        const displayQ    = (queueSegment === "daypass"
                          ? allQueue.filter((q) => q.room_type === "day_guest" || q.room_type === "premium_day_guest")
                          : allQueue.filter((q) => q.room_type !== "day_guest" && q.room_type !== "premium_day_guest")
                        ).slice(0, 100);
                        handleBulkDispatch(displayQ);
                      }}
                    >
                      🚀 אשר ושגר
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowDispatchConfirm(false)}
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
                    {dispatchSummary.blocked > 0 && (
                      <div style={{ color: "#7C3AED" }}>🔒 חסומות (שער Day Pass): <strong>{dispatchSummary.blocked}</strong></div>
                    )}
                    {dispatchSummary.failed > 0 && (
                      <div style={{ color: "#C0392B" }}>❌ נכשלו: <strong>{dispatchSummary.failed}</strong></div>
                    )}
                  </div>
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
              <button className="btn btn-ghost btn-sm" onClick={fetchQueue} disabled={loadingQueue}>
                {loadingQueue ? "⏳" : "↺"} רענון
              </button>
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
                    <strong>שלבים פעילים ({activeStageKeys.length}):</strong>{" "}
                    {activeStageKeys.length > 0 ? activeStageKeys.join(", ") : "—"}
                  </div>
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
                  const visibleAttention = queueData.attentionRequired
                    .filter((r) => !dismissedAttentionKeys.has(`${r.phone}_${r.stageKey}_${r.sentAt}`))
                    .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0))
                    .slice(0, 5);
                  const totalActive = queueData.attentionRequired.filter(
                    (r) => !dismissedAttentionKeys.has(`${r.phone}_${r.stageKey}_${r.sentAt}`)
                  ).length;
                  const hasCritical = visibleAttention.length > 0;
                  const dismissAll = (e) => {
                    e.stopPropagation();
                    const keys = new Set(dismissedAttentionKeys);
                    queueData.attentionRequired.forEach((r) => keys.add(`${r.phone}_${r.stageKey}_${r.sentAt}`));
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
                                      <td>{r.guestName ?? r.phone ?? "—"}</td>
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
                    (r) => r.status === "blocked_by_meta",
                  );
                  if (blockedItems.length === 0) return null;
                  return (
                    <div className="card" style={{ marginBottom: 16, border: "1px solid #E67E22" }}>
                      <div className="card-header">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                          <div className="card-title" style={{ color: "#B5600A", display: "flex", alignItems: "center", gap: 8 }}>
                            🟠 ממתין לאישור Meta
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
                              ({blockedItems.length})
                            </span>
                          </div>
                          <span className="badge badge-orange">⏳ Pending</span>
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
                            </tr>
                          </thead>
                          <tbody>
                            {blockedItems.map((r, i) => (
                              <tr key={i}>
                                <td style={{ fontWeight: 700 }}>{r.guestName ?? r.phone ?? "—"}</td>
                                <td>{stageDisplayNames[r.stageKey] ?? `⚠ ${r.stageKey}`}</td>
                                <td style={{ fontSize: 11, fontFamily: "monospace", color: "#B5600A" }}>
                                  {r.payload?.template ?? "—"}
                                </td>
                                <td><span className="badge badge-orange">⏳ ממתין לאישור</span></td>
                                <td style={{ fontSize: 11 }}>
                                  {r.sentAt ? new Date(r.sentAt).toLocaleString("he-IL") : "—"}
                                </td>
                              </tr>
                            ))}
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
                                <td style={{ fontWeight: 700 }}>{r.guestName ?? r.phone ?? "—"}</td>
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

                {/* ── Upcoming queue with checkboxes ── */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">
                      📋 בתור — {queueSegment === "daypass" ? "יום-כיף" : "סוויטות"} ({displayQueue.length})
                    </div>
                  </div>
                  {displayQueue.length === 0 ? (
                    <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                      אין פריטים בתור עבור קטגוריה זו כרגע
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                      <table className="table" style={{ minWidth: 680 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 38, textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={toggleAll}
                                title="בחר הכל / בטל הכל"
                                style={{ cursor: "pointer", width: 16, height: 16 }}
                              />
                            </th>
                            <th>אורח</th>
                            <th>חדר</th>
                            <th>שלב</th>
                            <th>מועד משוער</th>
                            <th>ערוץ צפוי</th>
                            <th>סטטוס</th>
                            <th style={{ minWidth: 100, textAlign: "center" }}>פעולות</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayQueue.map((q, i) => {
                            const itemKey = `${q.guestId}_${q.stageKey}`;
                            const canDispatch = isDispatchable(q);
                            const isGated = (q.room_type === "day_guest" || q.room_type === "premium_day_guest") && !DAY_PASS_ALLOWED_STAGES.has(q.stageKey);
                            const isChecked = selectedItems.has(itemKey);
                            return (
                              <tr
                                key={i}
                                style={{
                                  background: isChecked
                                    ? "rgba(201,169,110,0.12)"
                                    : q.dueNow
                                    ? "rgba(201,169,110,0.05)"
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
                                    <span
                                      title={isGated ? "חסום — שלב זה אינו מורשה לאורחי יום-כיף" : "כבר נשלח / לא זמין לשליחה"}
                                      style={{ fontSize: 14, color: "var(--text-muted)", cursor: "not-allowed" }}
                                    >
                                      {isGated ? "🔒" : "—"}
                                    </span>
                                  )}
                                </td>
                                <td style={{ fontWeight: 700 }}>{q.guestName ?? "—"}</td>
                                <td>{q.room ?? "—"}</td>
                                <td>{q.displayName}</td>
                                <td style={{ fontSize: 12 }}>{q.scheduledFor ? new Date(q.scheduledFor).toLocaleString("he-IL") : "—"}</td>
                                <td>
                                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: q.predictedChannel === "session_message" ? "#E8F5EF" : "#E0F2FE", color: q.predictedChannel === "session_message" ? "#1A7A4A" : "#0369A1" }}>
                                    {q.predictedChannel === "session_message" ? "סשן" : "תבנית"}
                                  </span>
                                </td>
                                <td>
                                  <span className={`badge ${q.status === "sent" || q.status === "simulated" ? "badge-green" : q.status === "failed" || q.status === "timeout" || q.status === "failed_missing_link" ? "badge-red" : q.status === "blocked_by_meta" ? "badge-orange" : q.dueNow ? "badge-gold" : "badge-blue"}`}>
                                    {q.status === "blocked_by_meta" ? "🟠 ממתין לאישור"
                                      : q.status === "failed_missing_link" ? "❌ חסר קישור תשלום"
                                      : q.dueNow && q.status === "pending" ? "⚡ מוכן לשליחה" : q.status}
                                  </span>
                                  {q.skipReason && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{q.skipReason}</div>}
                                </td>
                                <td style={{ textAlign: "center" }}>
                                  <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                                    {canDispatch && (
                                      <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        title={
                                          isGated
                                            ? `שלח עכשיו (עקיפת שער room_type) — ${q.displayName}`
                                            : `שלח עכשיו — ${q.displayName}`
                                        }
                                        onClick={() => requestQueueSendNow(q)}
                                        disabled={sendNowSending || !q.guestId}
                                        style={{ fontSize: 11, padding: "4px 8px" }}
                                      >
                                        שלח עכשיו
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      title={`שגר ידני עבור ${q.guestName ?? "אורח"} — עוקף לוח-זמנים`}
                                      onClick={() => setManualDispatchItem(q)}
                                      disabled={!q.guestId || sendNowSending}
                                      style={{ fontSize: 14, padding: "2px 7px", color: "var(--gold)", borderColor: "var(--gold)" }}
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
                  )}
                </div>
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
                  onClick={() => setShowDispatchConfirm(true)}
                  disabled={dispatching}
                  style={{ minWidth: 180 }}
                >
                  {dispatching ? "⏳ שולח..." : "🚀 אשר ושגר"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedItems(new Set())}
                  disabled={dispatching}
                >
                  ✕ ביטול בחירה
                </button>
                {dispatching && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    שולח הודעות בהפרש 300ms — אל תסגור את הדף
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
                                : h.status === "blocked_by_meta" ? "badge-orange"
                                : h.status === "failed_missing_link" ? "badge-red"
                                : "badge-red"
                              }`}>
                                {h.status === "sent" ? "✅ נשלח"
                                  : h.status === "simulated" ? "✅ סימולציה"
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
    </div>
  );
}
