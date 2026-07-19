// src/components/BotSettings.js
// "מוח הבוט" — Admin UI for the WhatsApp AI concierge brain.
//
// Reads/writes the single row in public.bot_settings (id = 1):
//   • system_prompt  — overrides the base personality built from bot_config
//   • knowledge_base — injected into every LLM call as factual context
//   • preferred_model — shared engine for Dream Bot (Meta) + Whapi Suites DM
//
// bot_config.bot_active / bot_active_whapi — per-channel on/off toggles below.

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import {
  detectKnowledgeConflicts,
  formatKnowledgeConflictWarning,
  HOUR_CONFIG_KEYS,
} from "../utils/guestKnowledgeValidation";
import {
  INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY,
  DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES,
  parseInboxClaimIdleReleaseMinutes,
} from "../utils/guestStaffClaim";

const DEFAULT_PROMPT_HINT =
  'לדוגמה:\nאתה "DREAM CONCIERGE" — הקונסיירז\' הדיגיטלי הרשמי של Dream Island Resort & Spa.\n' +
  'פרמיום, יוקרתי, אמפתי ומקצועי. עברית תקנית בלבד. תשובות 2–4 משפטים. אל תחשוף שאתה AI.';

const DEFAULT_KB_HINT =
  'לדוגמה:\n• מחיר בילוי יומי: 350–450₪ לאדם\n' +
  '• 3 בריכות זרמים + בריכה פרטית בסוויטות VIP\n' +
  '• חמאם: א–ה 09:00–21:00, שישי 09:00–15:00\n' +
  '• מסעדת ערמונים: הזמנות מראש בלבד\n' +
  '• הזמנת טיפול בספא: מרכז ההזמנות / פורטל אישי / פנייה לצוות (התאם לעובדות אמיתיות)\n' +
  '• Adults Only — אין כניסה לילדים מתחת לגיל 18\n' +
  '• אין כניסה לחיות מחמד';

// Mirrors whatsapp-webhook/index.ts's resolveModelRoute()/GEMINI_MODELS —
// deliberately duplicated (frontend can't import a Deno Edge Function), same
// convention used elsewhere in this codebase. Empty value = let the webhook
// default (currently Claude-first, with automatic failover to the other
// engine on error either way — see AiFailoverWidget.js for the live alert).
const MODEL_OPTIONS = [
  { value: "",                     label: "ברירת מחדל (Claude Sonnet — שני הערוצים)" },
  { value: "claude",               label: "Claude Sonnet — claude-sonnet-4-6" },
  { value: "claude-haiku",         label: "Claude Haiku — claude-haiku-4-5 (מהיר וזול, ניסיוני)" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (מהיר וזול — מומלץ לנפח גבוה)" },
  { value: "gemini-2.0-flash",      label: "Gemini 2.0 Flash" },
  { value: "gemini-2.5-flash",      label: "Gemini 2.5 Flash" },
];

const CHANNEL_TOGGLES = [
  {
    key: "bot_active",
    mirrorKey: "bot_active_meta",
    label: "Dream Bot (Meta)",
    hint: "וואטסאפ רשמי — עונה גם למספרים ללא פרופיל אורח",
  },
  {
    key: "bot_active_whapi",
    label: "מכשיר הסוויטות (Whapi)",
    hint: "הודעות פרטיות בלבד — רק לאורחים עם פרופיל פעיל במערכת",
  },
];

const MODULE_LABELS = {
  chat: "צ'אט אורחים (Dream Bot + Whapi)",
  routing: "ניתוב בקשות (Requests Board)",
};

// Mirrors HALLUCINATION_AUDIT_PROBES ids in _shared/guestHallucinationAudit.ts
// (frontend can't import a Deno Edge module — same convention as MODEL_OPTIONS).
// Unknown ids render as the raw id — FAIL VISIBLE, never hidden.
const AUDIT_PROBE_LABELS = {
  checkin_hours: "שעת צ'ק-אין",
  pool_hours: "שעות בריכה",
  wifi: "סיסמת WiFi",
  rooftop_bar: "בר על הגג (בדיקת מלכודת)",
  helicopter: "הזמנת מסוק (בדיקת מלכודת)",
  spa_booking: "הזמנת טיפול ספא",
  checkout: "שעת צ'ק-אאוט",
  pets: "חיות מחמד (בדיקת מלכודת)",
};

const AUDIT_CONFIG_KEYS = [
  "guest_hallucination_audit_last_run",
  "guest_hallucination_audit_summary",
];

// bot_config stores the summary as JSON text; a malformed value is shown raw
// in the card (FAIL VISIBLE) instead of being swallowed.
function parseAuditSummary(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj;
  } catch { /* fall through to raw */ }
  return { parseError: true, raw };
}

function formatRuleDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function BotSettings() {
  const [systemPrompt,  setSystemPrompt]  = useState("");
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [preferredModel, setPreferredModel] = useState("");
  const [channelActive, setChannelActive] = useState({ bot_active: true, bot_active_whapi: true });
  const [claimIdleMinutes, setClaimIdleMinutes] = useState(DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES);
  const [claimIdleSaving, setClaimIdleSaving] = useState(false);
  const [hourConfig, setHourConfig] = useState({});
  const [channelSaving, setChannelSaving] = useState(null);
  const [learnedRules, setLearnedRules] = useState([]);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingRuleText, setEditingRuleText] = useState("");
  const [ruleBusyId, setRuleBusyId] = useState(null);
  const [auditLastRun, setAuditLastRun] = useState(null);
  const [auditSummary, setAuditSummary] = useState(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState(null);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchSettings = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const configKeys = ["bot_active", "bot_active_whapi", INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY, ...HOUR_CONFIG_KEYS, ...AUDIT_CONFIG_KEYS];
    const [{ data, error }, { data: cfgRows }] = await Promise.all([
      supabase.from("bot_settings").select("system_prompt, knowledge_base, preferred_model").eq("id", 1).maybeSingle(),
      supabase.from("bot_config").select("config_key, config_value").in("config_key", configKeys),
    ]);
    if (error) {
      showToast("err", "שגיאה בטעינה: " + error.message);
    } else if (data) {
      setSystemPrompt(data.system_prompt ?? "");
      setKnowledgeBase(data.knowledge_base ?? "");
      setPreferredModel(data.preferred_model ?? "");
    }
    const cfgMap = Object.fromEntries((cfgRows ?? []).map((r) => [r.config_key, r.config_value]));
    setChannelActive({
      bot_active: cfgMap.bot_active !== "false",
      bot_active_whapi: cfgMap.bot_active_whapi !== "false",
    });
    setClaimIdleMinutes(parseInboxClaimIdleReleaseMinutes(cfgMap));
    const hours = {};
    for (const key of HOUR_CONFIG_KEYS) {
      if (cfgMap[key]) hours[key] = cfgMap[key];
    }
    setHourConfig(hours);
    setAuditLastRun(cfgMap.guest_hallucination_audit_last_run ?? null);
    setAuditSummary(parseAuditSummary(cfgMap.guest_hallucination_audit_summary));
    setLoading(false);
  }, []);

  const runAuditNow = async () => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    setAuditRunning(true);
    // whatsapp-cron treats body {audit:true} as audit-only — deterministic KB
    // probes, zero guest messages, returns before the dispatch pipeline.
    const { data, error } = await supabase.functions.invoke("whatsapp-cron", {
      body: { audit: true },
    });
    setAuditRunning(false);
    if (error || !data?.ok || !data?.report) {
      showToast("err", "בדיקת ההזיות נכשלה: " + (error?.message ?? data?.error ?? "תשובה לא צפויה"));
      return;
    }
    const report = data.report;
    setAuditLastRun(report.run_at);
    setAuditSummary({
      run_at: report.run_at,
      passed: report.passed,
      failed: report.failed,
      total: report.total,
      failed_probes: (report.rows ?? []).filter((r) => !r.passed).map((r) => r.probe_id),
    });
    showToast(
      report.failed > 0 ? "err" : "ok",
      report.failed > 0
        ? `האודיט מצא ${report.failed} שאלות ללא כיסוי בבסיס הידע`
        : `האודיט עבר — ${report.passed}/${report.total} שאלות מכוסות`,
    );
  };

  const knowledgeConflicts = useMemo(
    () => detectKnowledgeConflicts(hourConfig, knowledgeBase),
    [hourConfig, knowledgeBase],
  );

  const fetchLearnedRules = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setRulesLoading(false);
      return;
    }
    setRulesLoading(true);
    const { data, error } = await supabase
      .from("xos_ai_rules")
      .select("id, module, rule_text, created_at")
      .in("module", ["chat", "routing"])
      .order("created_at", { ascending: true });
    if (error) {
      showToast("err", "שגיאה בטעינת כללים שנלמדו: " + error.message);
      setLearnedRules([]);
    } else {
      setLearnedRules(data ?? []);
    }
    setRulesLoading(false);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { fetchLearnedRules(); }, [fetchLearnedRules]);

  const rulesByModule = learnedRules.reduce((acc, row) => {
    const mod = row.module ?? "other";
    if (!acc[mod]) acc[mod] = [];
    acc[mod].push(row);
    return acc;
  }, {});

  const cancelEditRule = () => {
    setEditingRuleId(null);
    setEditingRuleText("");
  };

  const startEditRule = (row) => {
    setEditingRuleId(row.id);
    setEditingRuleText(row.rule_text ?? "");
  };

  const handleSaveRule = async (id) => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    const trimmed = editingRuleText.trim();
    if (!trimmed) return showToast("err", "טקסט הכלל לא יכול להיות ריק");
    setRuleBusyId(id);
    const { error } = await supabase
      .from("xos_ai_rules")
      .update({ rule_text: trimmed })
      .eq("id", id);
    setRuleBusyId(null);
    if (error) showToast("err", "שגיאה בעדכון: " + error.message);
    else {
      showToast("ok", "✓ הכלל עודכן — ייכנס לתוקף תוך ~5 דקות");
      cancelEditRule();
      fetchLearnedRules();
    }
  };

  const handleDeleteRule = async (row) => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    const preview = (row.rule_text ?? "").length > 120
      ? `${row.rule_text.slice(0, 120)}…`
      : row.rule_text;
    if (!window.confirm(`למחוק את הכלל הזה?\n\n«${preview}»`)) return;
    setRuleBusyId(`del-${row.id}`);
    const { error } = await supabase.from("xos_ai_rules").delete().eq("id", row.id);
    setRuleBusyId(null);
    if (error) showToast("err", "שגיאה במחיקה: " + error.message);
    else {
      if (editingRuleId === row.id) cancelEditRule();
      showToast("ok", "✓ הכלל נמחק");
      fetchLearnedRules();
    }
  };

  const handleToggleChannel = async (ch) => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    const nextVal = !channelActive[ch.key];
    setChannelSaving(ch.key);
    const rows = [{ config_key: ch.key, config_value: String(nextVal) }];
    if (ch.mirrorKey) rows.push({ config_key: ch.mirrorKey, config_value: String(nextVal) });
    const { error } = await supabase.from("bot_config").upsert(rows, { onConflict: "config_key" });
    setChannelSaving(null);
    if (error) showToast("err", "שגיאה בעדכון ערוץ: " + error.message);
    else {
      setChannelActive((prev) => ({ ...prev, [ch.key]: nextVal }));
      showToast("ok", `✓ ${ch.label} — ${nextVal ? "פעיל" : "כבוי"}`);
    }
  };

  const handleSaveClaimIdleMinutes = async () => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    const normalized = parseInboxClaimIdleReleaseMinutes({
      [INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY]: String(claimIdleMinutes),
    });
    setClaimIdleSaving(true);
    const { error } = await supabase.from("bot_config").upsert(
      { config_key: INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY, config_value: String(normalized) },
      { onConflict: "config_key" },
    );
    setClaimIdleSaving(false);
    if (error) showToast("err", "שגיאה בשמירה: " + error.message);
    else {
      setClaimIdleMinutes(normalized);
      showToast("ok", `✓ שחרור בוט אוטומטי — ${normalized} דקות שקט`);
    }
  };

  const handleSave = async () => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    setSaving(true);
    const { error } = await supabase
      .from("bot_settings")
      .upsert(
        { id: 1, system_prompt: systemPrompt.trim(), knowledge_base: knowledgeBase.trim(), preferred_model: preferredModel || null },
        { onConflict: "id" }
      );
    if (error) showToast("err", "שגיאה בשמירה: " + error.message);
    else       showToast("ok",  "✅ מוח הבוט עודכן בהצלחה — הגדרות ייכנסו לתוקף תוך 5 דקות");
    setSaving(false);
  };

  const wordCount = (str) =>
    str.trim() ? str.trim().split(/\s+/).length : 0;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ maxWidth: 820 }}>

        {/* Info banner */}
        <div style={{
          background: "linear-gradient(135deg, rgba(201,169,110,0.12) 0%, rgba(201,169,110,0.04) 100%)",
          border: "1px solid var(--gold)", borderRadius: 12,
          padding: "14px 20px", marginBottom: 24,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <span style={{ fontSize: 28 }}>🧠</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "var(--gold-dark)", marginBottom: 4 }}>
              מוח הבוט — Dream Concierge AI
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              מוח אחד משותף לשני ערוצי האורח: <strong>Dream Bot (Meta)</strong> ו<strong>מכשיר הסוויטות (Whapi)</strong>.
              פרומפט, בסיס ידע ומנוע AI זהים — רק הדלקה/כיבוי לכל ערוץ נפרדת.
              Meta עונה גם למספרים ללא פרופיל; Whapi רק לאורחים רשומים ופעילים.
            </div>
          </div>
        </div>

        {/* ── Channel on/off ─────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">📡 ערוצי בוט — הדלקה / כיבוי</div>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              שינוי מיידי — אותם מפתחות כמו ב-Inbox
            </span>
          </div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            {CHANNEL_TOGGLES.map((ch) => {
              const on = channelActive[ch.key];
              const busy = channelSaving === ch.key;
              return (
                <div
                  key={ch.key}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)",
                    background: on ? "rgba(201,169,110,0.08)" : "var(--ivory)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{ch.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{ch.hint}</div>
                  </div>
                  <button
                    type="button"
                    className={`btn btn-sm ${on ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => handleToggleChannel(ch)}
                    disabled={loading || busy}
                    title={on ? "כבה בוט בערוץ זה" : "הדלק בוט בערוץ זה"}
                  >
                    {busy ? "…" : on ? "🤖 פעיל" : "😴 כבוי"}
                  </button>
                </div>
              );
            })}
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--ivory)",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>⏱️ שחרור בוט אחרי שקט (Inbox claim)</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  אחרי שליחה מהאינבוקס הבוט מושתק — חוזר אוטומטית אם אין הודעות בשיחה (5–1440 דק׳)
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={claimIdleMinutes}
                  disabled={loading || claimIdleSaving}
                  onChange={(e) => setClaimIdleMinutes(e.target.value)}
                  style={{ width: 72, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
                />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>דק׳</span>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={handleSaveClaimIdleMinutes}
                  disabled={loading || claimIdleSaving}
                >
                  {claimIdleSaving ? "…" : "שמור"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Engine selector ────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">⚙️ מנוע AI — שני הערוצים</div>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              נכשל אוטומטית למנוע השני אם המנוע הנבחר לא מגיב — ⚠️ התראה תופיע בדאשבורד
            </span>
          </div>
          <div style={{ padding: "16px 20px" }}>
            {loading ? (
              <div style={{ color: "var(--text-muted)", padding: "10px 0", textAlign: "center" }}>⏳ טוען...</div>
            ) : (
              <select
                value={preferredModel}
                onChange={(e) => setPreferredModel(e.target.value)}
                style={{ direction: "rtl" }}
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* ── System Prompt ──────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">🎭 פרומפט המערכת</div>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              מגדיר את האופי, הנימה והמגבלות של הבוט
            </span>
          </div>
          <div style={{ padding: "16px 20px" }}>
            {loading ? (
              <div style={{ color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>
                ⏳ טוען...
              </div>
            ) : (
              <>
                <div className="form-field" style={{ marginBottom: 6 }}>
                  <textarea
                    rows={10}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={DEFAULT_PROMPT_HINT}
                    style={{
                      resize: "vertical",
                      fontFamily: "Heebo, sans-serif",
                      direction: "rtl",
                      lineHeight: 1.8,
                      fontSize: 13,
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 16 }}>
                  <span>{systemPrompt.length} תווים</span>
                  <span>{wordCount(systemPrompt)} מילים</span>
                  <span>{systemPrompt.split("\n").filter(Boolean).length} שורות</span>
                  {systemPrompt.length === 0 && (
                    <span style={{ color: "#F59E0B", fontWeight: 600 }}>
                      ⚠️ ריק — ייעשה שימוש בפרומפט ברירת המחדל
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Knowledge Base ─────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">📚 בסיס ידע</div>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              עובדות, מחירים, שעות פתיחה — מוזרקות לכל שיחה
            </span>
          </div>
          <div style={{ padding: "16px 20px" }}>
            {loading ? (
              <div style={{ color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>
                ⏳ טוען...
              </div>
            ) : (
              <>
                <div className="form-field" style={{ marginBottom: 6 }}>
                  <textarea
                    rows={14}
                    value={knowledgeBase}
                    onChange={(e) => setKnowledgeBase(e.target.value)}
                    placeholder={DEFAULT_KB_HINT}
                    style={{
                      resize: "vertical",
                      fontFamily: "Heebo, sans-serif",
                      direction: "rtl",
                      lineHeight: 1.8,
                      fontSize: 13,
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 16 }}>
                  <span>{knowledgeBase.length} תווים</span>
                  <span>{wordCount(knowledgeBase)} מילים</span>
                  {knowledgeBase.length > 4000 && (
                    <span style={{ color: "#EF4444", fontWeight: 600 }}>
                      ⚠️ ארוך מאוד — שקול לקצר לעיקרי הדברים
                    </span>
                  )}
                </div>
                {knowledgeConflicts.length > 0 && (
                  <div
                    role="alert"
                    style={{
                      marginTop: 12,
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "rgba(245, 158, 11, 0.12)",
                      border: "1px solid rgba(245, 158, 11, 0.45)",
                      fontSize: 12,
                      lineHeight: 1.7,
                      color: "#92400e",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    <strong>⚠️ סתירות ידע בין bot_config לבסיס הידע:</strong>
                    {"\n"}
                    {formatKnowledgeConflictWarning(knowledgeConflicts)}
                    {"\n"}
                    במקרה של סתירה — knowledge_base גובר על שעות ב-bot_config.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Brain health — hallucination audit + knowledge conflicts ──── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div className="card-title">🩺 בריאות המוח</div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                אודיט הזיות דטרמיניסטי (ללא עלות AI) — רץ אוטומטית כל יום ראשון
              </span>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={runAuditNow}
              disabled={auditRunning || loading}
              title={
                auditRunning
                  ? "האודיט רץ כעת — המתן לסיום"
                  : "מריץ את 8 שאלות הבדיקה מול בסיס הידע השמור בשרת (לא שולח שום הודעה לאורחים)"
              }
            >
              {auditRunning ? "⏳ בודק…" : "🧪 הרץ בדיקה עכשיו"}
            </button>
          </div>
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {loading ? (
              <div style={{ color: "var(--text-muted)", padding: "10px 0", textAlign: "center" }}>⏳ טוען...</div>
            ) : (
              <>
                {/* Hallucination audit status */}
                {auditSummary?.parseError ? (
                  <div role="alert" style={{
                    padding: "10px 14px", borderRadius: 8, fontSize: 12, lineHeight: 1.7,
                    background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.45)", color: "#991b1b",
                    whiteSpace: "pre-wrap", direction: "ltr", textAlign: "left",
                  }}>
                    <strong>⚠ סיכום אודיט לא תקין ב-bot_config (מוצג כפי שנשמר):</strong>
                    {"\n"}{auditSummary.raw}
                  </div>
                ) : !auditSummary ? (
                  <div style={{
                    padding: "10px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.7,
                    background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.45)", color: "#92400e",
                  }}>
                    🕐 אודיט הזיות טרם רץ — הרץ עכשיו או המתן לריצה האוטומטית ביום ראשון.
                  </div>
                ) : (
                  <div style={{
                    padding: "10px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.8,
                    background: auditSummary.failed > 0 ? "rgba(239,68,68,0.08)" : "rgba(26,122,74,0.08)",
                    border: `1px solid ${auditSummary.failed > 0 ? "rgba(239,68,68,0.4)" : "rgba(26,122,74,0.4)"}`,
                    color: auditSummary.failed > 0 ? "#991b1b" : "#1A7A4A",
                  }}>
                    <div style={{ fontWeight: 700 }}>
                      {auditSummary.failed > 0
                        ? `❌ ${auditSummary.failed} מתוך ${auditSummary.total} שאלות בדיקה ללא כיסוי בבסיס הידע`
                        : `✅ אודיט הזיות עבר — ${auditSummary.passed}/${auditSummary.total} שאלות מכוסות`}
                      {auditLastRun && (
                        <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)", marginRight: 8 }}>
                          (רץ לאחרונה: {formatRuleDate(auditLastRun)})
                        </span>
                      )}
                    </div>
                    {auditSummary.failed > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {(auditSummary.failed_probes ?? []).map((id) => (
                          <span key={id} style={{
                            fontSize: 12, padding: "3px 10px", borderRadius: 999,
                            background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)",
                          }}>
                            {AUDIT_PROBE_LABELS[id] ?? id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Knowledge conflicts (details in the KB card above) */}
                <div style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                  {knowledgeConflicts.length > 0 ? (
                    <span style={{ color: "#991b1b", fontWeight: 600 }}>
                      ⚠️ {knowledgeConflicts.length} סתירות בין bot_config לבסיס הידע — פירוט בכרטיס בסיס הידע למעלה
                    </span>
                  ) : (
                    <span style={{ color: "#1A7A4A" }}>✅ אין סתירות בין bot_config לבסיס הידע</span>
                  )}
                </div>

                {/* KB presence */}
                <div style={{ fontSize: 13 }}>
                  {knowledgeBase.trim() ? (
                    <span style={{ color: "#1A7A4A" }}>
                      ✅ בסיס ידע פעיל ({knowledgeBase.length} תווים) — שליפת RAG לפי מילות מפתח
                    </span>
                  ) : (
                    <span style={{ color: "#92400e", fontWeight: 600 }}>
                      ⚠️ בסיס ידע ריק — הבוט נשען על שעות bot_config בלבד, ושאלות עובדתיות יופנו לצוות
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  האודיט בודק שליפה מבסיס הידע בלבד (checkin, בריכה, WiFi, ספא, צ'ק-אאוט + 3 שאלות מלכודת) —
                  שינוי בבסיס הידע דורש שמירה לפני הרצה כדי שייבדק הנוסח המעודכן.
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Staff-taught rules (xos_ai_rules — view / edit / delete) ── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div className="card-title">🧠 כללים שנלמדו מהצוות</div>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              נשמרים מכפתור «למד את המערכת» — ניתן לערוך או למחוק כאן; שינויים בבוט תוך ~5 דקות
            </span>
          </div>
          <div style={{ padding: "16px 20px" }}>
            {rulesLoading ? (
              <div style={{ color: "var(--text-muted)", padding: "12px 0", textAlign: "center" }}>⏳ טוען כללים...</div>
            ) : learnedRules.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
                עדיין אין כללים שנשמרו. הצוות יכול להוסיף דרך «למד את המערכת» בתיבת DREAM BOT או בלוח הבקשות.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {["chat", "routing"].map((mod) => {
                  const rows = rulesByModule[mod] ?? [];
                  if (!rows.length) return null;
                  return (
                    <div key={mod}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: "var(--gold-dark)", marginBottom: 10 }}>
                        {MODULE_LABELS[mod] ?? mod}
                        <span style={{ fontWeight: 500, color: "var(--text-muted)", marginRight: 8 }}>
                          ({rows.length} כללים)
                        </span>
                      </div>
                      <ul style={{ margin: 0, padding: "0 20px 0 0", listStyle: "none" }}>
                        {rows.map((row) => {
                          const isEditing = editingRuleId === row.id;
                          const isBusy = ruleBusyId === row.id || ruleBusyId === `del-${row.id}`;
                          return (
                          <li
                            key={row.id}
                            style={{
                              marginBottom: 10,
                              padding: "10px 14px",
                              background: "var(--ivory)",
                              borderRadius: 8,
                              border: isEditing ? "1.5px solid var(--gold)" : "1px solid var(--border)",
                              fontSize: 13,
                              lineHeight: 1.65,
                            }}
                          >
                            {isEditing ? (
                              <>
                                <textarea
                                  value={editingRuleText}
                                  onChange={(e) => setEditingRuleText(e.target.value)}
                                  rows={4}
                                  disabled={isBusy}
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    padding: "10px 12px",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)",
                                    fontFamily: "Heebo, sans-serif",
                                    fontSize: 13,
                                    lineHeight: 1.6,
                                    resize: "vertical",
                                    direction: "rtl",
                                  }}
                                />
                                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleSaveRule(row.id)}
                                    disabled={isBusy || !editingRuleText.trim()}
                                  >
                                    {ruleBusyId === row.id ? "שומר…" : "💾 שמור"}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={cancelEditRule}
                                    disabled={isBusy}
                                  >
                                    ביטול
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div>{row.rule_text}</div>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    marginTop: 8,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                    {formatRuleDate(row.created_at)}
                                  </div>
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => startEditRule(row)}
                                      disabled={ruleBusyId != null}
                                      title="ערוך את נוסח הכלל"
                                    >
                                      ✏️ ערוך
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => handleDeleteRule(row)}
                                      disabled={ruleBusyId != null}
                                      title="מחק כלל לצמיתות"
                                      style={{ color: "#9b1c1c" }}
                                    >
                                      {ruleBusyId === `del-${row.id}` ? "…" : "🗑️ מחק"}
                                    </button>
                                  </div>
                                </div>
                              </>
                            )}
                          </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={fetchLearnedRules}
                disabled={rulesLoading}
              >
                ↺ רענן כללים
              </button>
            </div>
          </div>
        </div>

        {/* ── Action buttons ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            className="btn btn-ghost"
            onClick={fetchSettings}
            disabled={loading || saving}
          >
            ↺ רענן מה-DB
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || loading}
            style={{ minWidth: 180, fontSize: 15 }}
          >
            {saving ? "⏳ שומר..." : "💾 שמור מוח הבוט"}
          </button>
        </div>

      </div>
    </div>
  );
}
