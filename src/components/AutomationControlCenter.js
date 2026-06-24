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

// Manager-facing description per Meta template — raw tokens like
// "dream_arrival_confirmation" mean nothing to a non-technical resort
// manager. FAIL VISIBLE fallback: an unmapped template shows "⚠ raw_name"
// rather than disappearing, same convention as STATUS_META in GuestsPage.js.
const META_TEMPLATE_FRIENDLY = {
  dream_arrival_confirmation: "פנייה ראשונה — בקשת אישור הגעה (יומיים לפני ההגעה)",
  dream_checkin_reminder_v2:  "תזכורת ערב לפני ההגעה",
  dream_welcome_morning:      "ברכת בוקר ביום ההגעה",
  dream_handover_agent_v2:    "העברה לסוכן האישי (שעה אחרי צ׳ק-אין)",
  dream_mid_stay_check:       "בדיקת שלום באמצע השהות",
  dream_checkout_feedback:    "בקשת משוב לאחר העזיבה",
  dream_payment_and_workshops: "תשלום יתרה + הרשמה לסדנאות",
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
};
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
    .replace(/\{\{\s*SPA_TIME\s*\}\}/gi, `הטיפול שלכם בספא מתואם לשעה ${sampleSpaTime}`);
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
function MetaTemplatePreviewBox({ stage, metaTemplatesByName }) {
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
          {tmpl.bodyText}
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
                {availableScriptKeys.map((k) => <option key={k} value={k}>{k}</option>)}
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
                </>
              )}
            </div>
          )}

          {/* ── Meta template (read-only — edited in Meta Business Manager / Templates tab) ── */}
          {stage.meta_template_name && (
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>🔵 תבנית Meta (Fallback)</label>
              <div style={{ fontSize: 13 }}>{metaTemplateFriendly(stage.meta_template_name)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                טכני: <code style={{ background: "#F3F4F6", padding: "2px 6px", borderRadius: 4 }}>{stage.meta_template_name}</code>
                {" — ראה/ערוך בלשונית \"📋 תבניות Meta\""}
              </div>
              <MetaTemplatePreviewBox stage={stage} metaTemplatesByName={metaTemplatesByName} />
            </div>
          )}

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

export default function AutomationControlCenter() {
  const [subTab, setSubTab] = useState("timeline"); // timeline | queue | history | builder | templates
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
      console.warn("[AutomationControlCenter] fetchMetaTemplates error:", err?.message ?? err);
    }
  }, []);

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
    } catch (err) {
      setQueueError(err?.message ?? String(err));
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => { if (subTab === "queue") fetchQueue(); }, [subTab, fetchQueue]);

  // ── Execution history ("מה נשלח") ────────────────────────────────────────
  const [historyData, setHistoryData] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);

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

  // stage_key → display_name, reused by the Queue tab so it never shows a
  // raw stage_key/trigger_type token to the manager.
  const stageDisplayNames = stages.reduce((acc, s) => {
    acc[s.stage_key] = s.display_name;
    return acc;
  }, {});

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
              {stages.map((stage) => (
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
          )}
        </div>
      )}

      {subTab === "queue" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={fetchQueue} disabled={loadingQueue}>
              {loadingQueue ? "⏳" : "↺"} רענון
            </button>
          </div>

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
                {(!queueData.systemStatus.cronEnabled || !queueData.systemStatus.automationEnabled) && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                    ⚠ אחד או יותר ממפסקי החיים כבוי — האוטומציה האוטומטית (cron) לא תשלח הודעות בפועל כרגע. זהו המצב המתועד הנוכחי, לא תקלה.
                  </div>
                )}
              </div>

              {/* ── Attention required ── */}
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header"><div className="card-title">⚠ דורש טיפול ({queueData.attentionRequired.length})</div></div>
                {queueData.attentionRequired.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>אין כשלים ב-7 הימים האחרונים 🎉</div>
                ) : (
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <table className="table" style={{ minWidth: 480 }}>
                      <thead><tr><th>אורח</th><th>שלב</th><th>סטטוס</th><th>זמן</th></tr></thead>
                      <tbody>
                        {queueData.attentionRequired.map((r, i) => (
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
                )}
              </div>

              {/* ── Upcoming queue ── */}
              <div className="card">
                <div className="card-header"><div className="card-title">📋 בתור — מי / מה / מתי ({queueData.queue.length})</div></div>
                {queueData.queue.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>אין פריטים בתור כרגע</div>
                ) : (
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <table className="table" style={{ minWidth: 640 }}>
                      <thead><tr><th>אורח</th><th>חדר</th><th>שלב</th><th>מועד משוער</th><th>ערוץ צפוי</th><th>סטטוס</th></tr></thead>
                      <tbody>
                        {queueData.queue.slice(0, 100).map((q, i) => (
                          <tr key={i} style={{ background: q.dueNow ? "rgba(201,169,110,0.08)" : undefined }}>
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
                              <span className={`badge ${q.status === "sent" || q.status === "simulated" ? "badge-green" : q.status === "failed" || q.status === "timeout" ? "badge-red" : q.dueNow ? "badge-gold" : "badge-blue"}`}>
                                {q.dueNow ? "מוכן לשליחה" : q.status}
                              </span>
                              {q.skipReason && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{q.skipReason}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

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
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
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
                    {historyData.map((h) => (
                      <tr key={h.id}>
                        <td style={{ fontWeight: 700 }}>{h.guestName ?? "—"}</td>
                        <td>{h.stageDisplayName}</td>
                        <td style={{ fontSize: 12 }}>{h.scheduledFor ? new Date(h.scheduledFor).toLocaleString("he-IL") : "מיידי / ידני"}</td>
                        <td style={{ fontSize: 12 }}>{h.actualSentAt ? new Date(h.actualSentAt).toLocaleString("he-IL") : "—"}</td>
                        <td>
                          <span className={`badge ${h.status === "sent" || h.status === "simulated" ? "badge-green" : "badge-red"}`}>
                            {h.status === "sent" ? "✅ נשלח" : h.status === "simulated" ? "✅ סימולציה" : h.status === "timeout" ? "❌ לא ודאי" : "❌ נכשל"}
                          </span>
                          {h.error && <div style={{ fontSize: 10, color: "#C0392B", marginTop: 2, maxWidth: 280 }}>{h.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === "builder" && (
        <CustomAutomationBuilder metaTemplatesByName={metaTemplatesByName} showToast={showToast} />
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
