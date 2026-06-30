// src/components/BotSettings.js
// "מוח הבוט" — Admin UI for the WhatsApp AI concierge brain.
//
// Reads/writes the single row in public.bot_settings (id = 1):
//   • system_prompt  — overrides the base personality built from bot_config
//   • knowledge_base — injected into every Gemini call as factual context
//
// The whatsapp-webhook Edge Function reads these fields before calling Gemini.

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const DEFAULT_PROMPT_HINT =
  'לדוגמה:\nאתה "DREAM CONCIERGE" — הקונסיירז\' הדיגיטלי הרשמי של Dream Island Resort & Spa.\n' +
  'פרמיום, יוקרתי, אמפתי ומקצועי. עברית תקנית בלבד. תשובות 2–4 משפטים. אל תחשוף שאתה AI.';

const DEFAULT_KB_HINT =
  'לדוגמה:\n• מחיר בילוי יומי: 350–450₪ לאדם\n' +
  '• 3 בריכות זרמים + בריכה פרטית בסוויטות VIP\n' +
  '• חמאם: א–ה 09:00–21:00, שישי 09:00–15:00\n' +
  '• מסעדת ערמונים: הזמנות מראש בלבד\n' +
  '• Adults Only — אין כניסה לילדים מתחת לגיל 18\n' +
  '• אין כניסה לחיות מחמד';

// Mirrors whatsapp-webhook/index.ts's resolveModelRoute()/GEMINI_MODELS —
// deliberately duplicated (frontend can't import a Deno Edge Function), same
// convention used elsewhere in this codebase. Empty value = let the webhook
// default (currently Claude-first, with automatic failover to the other
// engine on error either way — see AiFailoverWidget.js for the live alert).
const MODEL_OPTIONS = [
  { value: "",                     label: "ברירת מחדל (Claude)" },
  { value: "claude",               label: "Claude — claude-sonnet-4-6" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite (מהיר וזול — מומלץ לנפח גבוה)" },
  { value: "gemini-2.0-flash",      label: "Gemini 2.0 Flash" },
  { value: "gemini-2.5-flash",      label: "Gemini 2.5 Flash" },
  { value: "gemini-1.5-flash",      label: "Gemini 1.5 Flash" },
];

const MODULE_LABELS = {
  chat: "צ'אט אורחים (DREAM BOT)",
  routing: "ניתוב בקשות (Requests Board)",
};

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
  const [learnedRules, setLearnedRules] = useState([]);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingRuleText, setEditingRuleText] = useState("");
  const [ruleBusyId, setRuleBusyId] = useState(null);
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
    const { data, error } = await supabase
      .from("bot_settings")
      .select("system_prompt, knowledge_base, preferred_model")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      showToast("err", "שגיאה בטעינה: " + error.message);
    } else if (data) {
      setSystemPrompt(data.system_prompt ?? "");
      setKnowledgeBase(data.knowledge_base ?? "");
      setPreferredModel(data.preferred_model ?? "");
    }
    setLoading(false);
  }, []);

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
              שינויים כאן משפיעים ישירות על תשובות הבוט בוואטסאפ. הפרומפט מגדיר את האופי,
              ובסיס הידע מספק לבוט עובדות ספציפיות על הריזורט. שניהם מוזרקים לפני כל תשובה.
            </div>
          </div>
        </div>

        {/* ── Engine selector ────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">⚙️ מנוע AI לשיחת אורחים</div>
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
