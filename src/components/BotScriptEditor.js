// src/components/BotScriptEditor.js
// Admin UI for editing the bot_scripts table.
//
// Each row in bot_scripts is a self-contained message: the text the bot sends,
// the AI system prompt (for ongoing conversations), and metadata flags.
// Edge Functions (whatsapp-webhook, whatsapp-send) read this table at runtime.
//
// Placeholders resolved by Edge Functions (see resolvePlaceholders() in
// whatsapp-webhook/index.ts — all read from guests.spa_time, not bookings):
//   {{GUEST_NAME}}        — guest.name from guests table
//   {{SPA_TIME}}          — guests.spa_time, raw value; strips the whole
//                           containing sentence if the guest has none booked
//   {{SPA_LINE}}          — guests.spa_time as an inline optional clause
//                           ("מתואם לכם טיפול בספא בשעה 14:00. בנוסף, " or "")
//   {{OPTIONAL_SPA_TEXT}} — legacy alias of SPA_LINE, same optional-clause rule
//   {{WORKSHOP_URL}}      — WORKSHOP_SIGNUP_URL Supabase secret

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const TRIGGER_LABELS = {
  arrival_confirmed: { label: "אחרי אישור הגעה", color: "#1A7A4A", bg: "#E8F5EF" },
  morning_of:        { label: "בוקר הגעה",       color: "#7C3AED", bg: "#F3F0FF" },
  ongoing:           { label: "שיחה שוטפת AI",   color: "#0369A1", bg: "#E0F2FE" },
  complaint:         { label: "תלונה",            color: "#C0392B", bg: "#FFF0EE" },
  upsell:            { label: "שדרוג / Upsell",  color: "#92400E", bg: "#FEF3C7" },
  fallback:          { label: "תגובת נפילה",      color: "#6B7280", bg: "#F3F4F6" },
  greeting:          { label: "ברכת פתיחה",       color: "#059669", bg: "#ECFDF5" },
  button_reply:      { label: "תגובת כפתור",      color: "#0E7490", bg: "#ECFEFF" },
};

function TriggerBadge({ event }) {
  const meta = TRIGGER_LABELS[event] ?? { label: event, color: "#555", bg: "#F3F4F6" };
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
      color: meta.color, background: meta.bg,
      border: `1px solid ${meta.color}40`,
    }}>
      {meta.label}
    </span>
  );
}

export default function BotScriptEditor() {
  const [scripts,    setScripts]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(null); // script id being saved
  const [expanded,   setExpanded]   = useState(null); // expanded script id
  const [drafts,     setDrafts]     = useState({});   // { [id]: { message_text, ai_system_prompt } }
  const [toast,      setToast]      = useState(null);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchScripts = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("bot_scripts")
      .select("id, script_key, display_name, trigger_event, is_meta_template, meta_template_name, message_text, ai_system_prompt, is_active, sort_order")
      .order("sort_order");
    if (error) {
      showToast("err", "שגיאה בטעינה: " + error.message);
    } else {
      setScripts(data ?? []);
      // Initialise drafts from DB values
      const initial = {};
      (data ?? []).forEach((s) => {
        initial[s.id] = { message_text: s.message_text ?? "", ai_system_prompt: s.ai_system_prompt ?? "" };
      });
      setDrafts(initial);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchScripts(); }, [fetchScripts]);

  const handleToggleActive = async (script) => {
    if (!supabase) return;
    const newVal = !script.is_active;
    setScripts((prev) => prev.map((s) => s.id === script.id ? { ...s, is_active: newVal } : s));
    const { error } = await supabase
      .from("bot_scripts")
      .update({ is_active: newVal })
      .eq("id", script.id);
    if (error) {
      setScripts((prev) => prev.map((s) => s.id === script.id ? { ...s, is_active: !newVal } : s));
      showToast("err", "שגיאה: " + error.message);
    } else {
      showToast("ok", newVal ? "✅ הסקריפט הופעל" : "⏸ הסקריפט הושהה");
    }
  };

  const handleSave = async (script) => {
    if (!supabase) return;
    setSaving(script.id);
    const draft = drafts[script.id] ?? {};
    const { error } = await supabase
      .from("bot_scripts")
      .update({
        message_text:    draft.message_text?.trim()    ?? null,
        ai_system_prompt: draft.ai_system_prompt?.trim() ?? null,
      })
      .eq("id", script.id);
    if (error) {
      showToast("err", "שגיאה בשמירה: " + error.message);
    } else {
      setScripts((prev) => prev.map((s) => s.id === script.id
        ? { ...s, message_text: draft.message_text, ai_system_prompt: draft.ai_system_prompt }
        : s
      ));
      showToast("ok", `✅ "${script.display_name}" עודכן`);
    }
    setSaving(null);
  };

  const setDraft = (id, field, value) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const isDirty = (script) => {
    const d = drafts[script.id];
    if (!d) return false;
    return (d.message_text ?? "") !== (script.message_text ?? "") ||
           (d.ai_system_prompt ?? "") !== (script.ai_system_prompt ?? "");
  };

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

      <div style={{ maxWidth: 860 }}>

        {/* Info banner */}
        <div style={{
          background: "linear-gradient(135deg, rgba(201,169,110,0.12) 0%, rgba(201,169,110,0.04) 100%)",
          border: "1px solid var(--gold)", borderRadius: 12,
          padding: "14px 20px", marginBottom: 24,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <span style={{ fontSize: 28 }}>📝</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "var(--gold-dark)", marginBottom: 4 }}>
              עורך סקריפטי הבוט
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              כאן ניתן לערוך את ההודעות שהבוט שולח לאורחים. שינויים נכנסים לתוקף בתוך עד 5 דקות (cache בצד השרת).{" "}
              <br />
              Placeholders: <code style={{ background: "#F3F4F6", padding: "1px 4px", borderRadius: 3 }}>{"{{GUEST_NAME}}"}</code>{" "}
              <code style={{ background: "#F3F4F6", padding: "1px 4px", borderRadius: 3 }}>{"{{WORKSHOP_URL}}"}</code>{" "}
              <code style={{ background: "#F3F4F6", padding: "1px 4px", borderRadius: 3 }}>{"{{SPA_TIME}}"}</code>{" "}
              (שעה גולמית — אם אין לאורח ספא, כל המשפט המכיל אותה יימחק){" "}
              <code style={{ background: "#F3F4F6", padding: "1px 4px", borderRadius: 3 }}>{"{{SPA_LINE}}"}</code>{" "}
              (משפט-משנה אופציונלי שמשתלב בטקסט — ריק אם אין ספא, כדי לערוך חופשי בלי לדאוג מה-ניסוח כשאין תור)
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)", fontSize: 15 }}>
            ⏳ טוען סקריפטים...
          </div>
        ) : scripts.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)", fontSize: 15 }}>
            אין סקריפטים. הרץ את migration 032 ואז לחץ רענן.
          </div>
        ) : (
          scripts.map((script) => {
            const isOpen    = expanded === script.id;
            const isSavingThis = saving === script.id;
            const hasChanges   = isDirty(script);
            const d            = drafts[script.id] ?? {};

            return (
              <div
                key={script.id}
                className="card"
                style={{
                  marginBottom: 12,
                  opacity: script.is_active ? 1 : 0.6,
                  border: isOpen ? "1px solid var(--gold)" : undefined,
                  transition: "all 0.2s",
                }}
              >
                {/* ── Header row ── */}
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 20px", cursor: "pointer",
                    borderBottom: isOpen ? "1px solid var(--border)" : "none",
                  }}
                  onClick={() => setExpanded(isOpen ? null : script.id)}
                >
                  {/* Expand chevron */}
                  <span style={{ fontSize: 14, color: "var(--text-muted)", transition: "transform 0.2s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
                    ▶
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{script.display_name}</span>
                      <TriggerBadge event={script.trigger_event} />
                      {script.is_meta_template && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                          color: "#0369A1", background: "#E0F2FE", border: "1px solid #0369A180",
                        }}>
                          Meta Template
                        </span>
                      )}
                      {hasChanges && (
                        <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 700 }}>● שינויים לא שמורים</span>
                      )}
                    </div>
                    {script.meta_template_name && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {script.meta_template_name}
                      </div>
                    )}
                  </div>

                  {/* Active toggle */}
                  <div
                    onClick={(e) => { e.stopPropagation(); handleToggleActive(script); }}
                    style={{
                      width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                      background: script.is_active ? "var(--gold)" : "#D1D5DB",
                      position: "relative", flexShrink: 0, transition: "background 0.2s",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 3, borderRadius: "50%",
                      width: 18, height: 18, background: "#fff",
                      right: script.is_active ? 3 : "auto",
                      left: script.is_active ? "auto" : 3,
                      transition: "all 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    }} />
                  </div>
                </div>

                {/* ── Expanded edit area ── */}
                {isOpen && (
                  <div style={{ padding: "16px 20px" }}>

                    {/* Message text */}
                    <div className="form-field" style={{ marginBottom: 16 }}>
                      <label style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: "block" }}>
                        💬 טקסט ההודעה
                      </label>
                      <textarea
                        rows={script.trigger_event === "ongoing" ? 4 : 7}
                        value={d.message_text ?? ""}
                        onChange={(e) => setDraft(script.id, "message_text", e.target.value)}
                        placeholder={script.trigger_event === "ongoing" ? "לא רלוונטי — הודעה זו לא שולחת טקסט ישיר" : "טקסט ההודעה..."}
                        disabled={script.trigger_event === "ongoing"}
                        style={{
                          resize: "vertical", fontFamily: "Heebo, sans-serif",
                          direction: "rtl", lineHeight: 1.8, fontSize: 13,
                          opacity: script.trigger_event === "ongoing" ? 0.4 : 1,
                        }}
                      />
                      {d.message_text && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                          {d.message_text.length} תווים
                        </div>
                      )}
                    </div>

                    {/* AI system prompt — only for ongoing */}
                    {script.trigger_event === "ongoing" && (
                      <div className="form-field" style={{ marginBottom: 16 }}>
                        <label style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: "block" }}>
                          🤖 System Prompt לבינה מלאכותית
                        </label>
                        <textarea
                          rows={10}
                          value={d.ai_system_prompt ?? ""}
                          onChange={(e) => setDraft(script.id, "ai_system_prompt", e.target.value)}
                          placeholder="פרומפט המערכת לגמיני / קלוד..."
                          style={{
                            resize: "vertical", fontFamily: "Heebo, sans-serif",
                            direction: "rtl", lineHeight: 1.8, fontSize: 13,
                          }}
                        />
                        {d.ai_system_prompt && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                            {d.ai_system_prompt.length} תווים
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setDrafts((prev) => ({
                          ...prev,
                          [script.id]: { message_text: script.message_text ?? "", ai_system_prompt: script.ai_system_prompt ?? "" },
                        }))}
                        disabled={!hasChanges || isSavingThis}
                      >
                        ↺ בטל שינויים
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleSave(script)}
                        disabled={isSavingThis || !hasChanges}
                        style={{ minWidth: 140 }}
                      >
                        {isSavingThis ? "⏳ שומר..." : "💾 שמור"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Refresh button */}
        {!loading && scripts.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={fetchScripts}>
              ↺ רענן מה-DB
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
