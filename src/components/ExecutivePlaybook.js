// Admin view for Staff Voice Assistants — Executive Playbook (Eliad/Mike) + Adir desk profile + staff notify templates.

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import StaffNotifyPanel from "./StaffNotifyPanel";

/** Read-only mirror of executiveIdentity.ts KNOWN_FRONT_DESK — for admin visibility. */
const ADIR_DESK_PROFILE = {
  displayName: "אדיר",
  title: "מנהל המלון — קבלת סוויטות",
  focus:
    "אני עוזרת דלפק הסוויטות של אדיר. הוא בקבלה עד ~16:00 — אני עוזרת לו עם הגעות, שעות הגעה, ולוח בקשות.",
  tools: "get_arrival_desk_brief, list_guest_alerts, resolve_guest_alert, set_guest_status (room_ready), create_executive_task, query_open_tasks, list_guests_by_date, learn_front_desk_rule",
  morningBrief: "07:00 ישראל — ניתן לערוך בלשונית «הודעות ודוחות»",
};

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function ExecutivePlaybook() {
  const [mainTab, setMainTab] = useState("playbook");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [personaLoading, setPersonaLoading] = useState(true);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaDirty, setPersonaDirty] = useState(false);
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [newRuleText, setNewRuleText] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [adirRules, setAdirRules] = useState([]);
  const [adirRulesLoading, setAdirRulesLoading] = useState(true);
  const [log, setLog] = useState([]);
  const [logLoading, setLogLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchPersona = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setPersonaLoading(false); return; }
    setPersonaLoading(true);
    const { data, error } = await supabase
      .from("executive_bot_settings")
      .select("persona_prompt")
      .eq("id", 1)
      .maybeSingle();
    if (error) showToast("err", "שגיאה בטעינת הפרומפט: " + error.message);
    setPersonaPrompt(data?.persona_prompt ?? "");
    setPersonaDirty(false);
    setPersonaLoading(false);
  }, []);

  const handleSavePersona = async () => {
    const trimmed = personaPrompt.trim();
    if (!trimmed) return showToast("err", "הפרומפט לא יכול להיות ריק");
    setPersonaSaving(true);
    const { error } = await supabase
      .from("executive_bot_settings")
      .upsert({ id: 1, persona_prompt: trimmed, updated_at: new Date().toISOString() });
    setPersonaSaving(false);
    if (error) return showToast("err", "שגיאה בשמירה: " + error.message);
    setPersonaDirty(false);
    showToast("ok", "✓ הפרומפט נשמר");
  };

  const fetchRules = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setRulesLoading(false); return; }
    setRulesLoading(true);
    const { data, error } = await supabase
      .from("xos_ai_rules")
      .select("id, rule_text, created_at")
      .eq("module", "executive")
      .order("created_at", { ascending: true });
    if (error) showToast("err", "שגיאה בטעינת כללים: " + error.message);
    setRules(data ?? []);
    setRulesLoading(false);
  }, []);

  const fetchAdirRules = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setAdirRulesLoading(false); return; }
    setAdirRulesLoading(true);
    const { data, error } = await supabase
      .from("xos_ai_rules")
      .select("id, rule_text, created_at")
      .eq("module", "front_desk")
      .order("created_at", { ascending: true });
    if (error) showToast("err", "שגיאה בטעינת כללי אדיר: " + error.message);
    setAdirRules(data ?? []);
    setAdirRulesLoading(false);
  }, []);

  const fetchLog = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLogLoading(false); return; }
    setLogLoading(true);
    const { data, error } = await supabase
      .from("executive_action_log")
      .select("id, tool_name, args_json, result_json, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) showToast("err", "שגיאה בטעינת יומן פעולות: " + error.message);
    setLog(data ?? []);
    setLogLoading(false);
  }, []);

  useEffect(() => { fetchPersona(); }, [fetchPersona]);
  useEffect(() => { fetchRules(); }, [fetchRules]);
  useEffect(() => { fetchAdirRules(); }, [fetchAdirRules]);
  useEffect(() => { fetchLog(); }, [fetchLog]);

  const handleAddRule = async () => {
    const trimmed = newRuleText.trim();
    if (!trimmed) return;
    setAdding(true);
    const { error } = await supabase.from("xos_ai_rules").insert({ module: "executive", rule_text: trimmed });
    setAdding(false);
    if (error) return showToast("err", "שגיאה בהוספה: " + error.message);
    setNewRuleText("");
    showToast("ok", "✓ הכלל נוסף");
    fetchRules();
  };

  const startEdit = (row) => { setEditingId(row.id); setEditingText(row.rule_text ?? ""); };
  const cancelEdit = () => { setEditingId(null); setEditingText(""); };

  const handleSaveEdit = async (id) => {
    const trimmed = editingText.trim();
    if (!trimmed) return showToast("err", "טקסט הכלל לא יכול להיות ריק");
    setBusyId(id);
    const { error } = await supabase.from("xos_ai_rules").update({ rule_text: trimmed }).eq("id", id);
    setBusyId(null);
    if (error) return showToast("err", "שגיאה בעדכון: " + error.message);
    showToast("ok", "✓ עודכן");
    cancelEdit();
    fetchRules();
  };

  const handleDelete = async (row) => {
    const preview = (row.rule_text ?? "").length > 100 ? `${row.rule_text.slice(0, 100)}…` : row.rule_text;
    if (!window.confirm(`למחוק את הכלל הזה?\n\n«${preview}»`)) return;
    setBusyId(`del-${row.id}`);
    const { error } = await supabase.from("xos_ai_rules").delete().eq("id", row.id);
    setBusyId(null);
    if (error) return showToast("err", "שגיאה במחיקה: " + error.message);
    showToast("ok", "✓ נמחק");
    fetchRules();
  };

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      <div style={{ maxWidth: mainTab === "staff_notify" ? 1100 : 820 }}>
        <div style={{
          background: "linear-gradient(135deg, rgba(107,33,168,0.12) 0%, rgba(107,33,168,0.04) 100%)",
          border: "1px solid #6B21A8", borderRadius: 12,
          padding: "14px 20px", marginBottom: 24,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <span style={{ fontSize: 28 }}>👔</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#6B21A8", marginBottom: 4 }}>
              עוזרות קוליות לצוות ניהול
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              <strong>אליעד (מנכ"ל):</strong> העוזרת האישית שלו — הפרומפט הבסיסי למטה + דגש אישי בקוד (executiveIdentity.ts).
              <br />
              <strong>אדיר (דלפק):</strong> פרופיל נפרד — כרטיס למטה; הודעות ודוחות בלשונית «הודעות ודוחות».
              <br />
              כללים שנלמדו בקול: אליעד → module executive | אדיר → module front_desk.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { id: "playbook", label: "🧠 פרומפט וכללים" },
            { id: "staff_notify", label: "📨 הודעות ודוחות" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn btn-sm ${mainTab === t.id ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMainTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mainTab === "staff_notify" ? (
          <StaffNotifyPanel showToast={showToast} />
        ) : (
        <>
        {/* ── Base system prompt (executive_bot_settings, migration 183) ──── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">📝 System Prompt בסיסי (משותף — אליעד + אדיר + מייק)</div>
          </div>
          <div style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.6 }}>
              הטקסט שקובע את האישיות והכללים הבסיסיים של העוזר, לפני הכללים שנלמדו למטה.
              {" "}<code>{"{{name}}"}</code>, <code>{"{{title}}"}</code> ו-<code>{"{{focus}}"}</code> מוחלפים אוטומטית
              בשם, בתפקיד ובדגש-התמקדות של מי שכותב (אליעד / מייק / מנהל עתידי, מוגדר ב-executiveIdentity.ts) —
              אין צורך לכתוב שם קבוע.
            </div>
            {personaLoading ? (
              <div style={{ color: "var(--text-muted)", padding: "12px 0", textAlign: "center" }}>⏳ טוען…</div>
            ) : (
              <>
                <textarea
                  value={personaPrompt}
                  onChange={(e) => { setPersonaPrompt(e.target.value); setPersonaDirty(true); }}
                  rows={14}
                  disabled={personaSaving}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "12px 14px",
                    borderRadius: 8, border: "1px solid var(--border)", fontSize: 13,
                    lineHeight: 1.7, resize: "vertical", direction: "rtl", fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSavePersona}
                    disabled={personaSaving || !personaDirty || !personaPrompt.trim()}
                  >
                    {personaSaving ? "שומר…" : "💾 שמור"}
                  </button>
                  {personaDirty && <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>שינויים לא שמורים</span>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Adir front desk (read-only — executiveIdentity.ts) ───────────── */}
        <div className="card" style={{ marginBottom: 20, borderColor: "#0D9488" }}>
          <div className="card-header">
            <div className="card-title">🏨 עוזרת דלפק — אדיר</div>
          </div>
          <div style={{ padding: "16px 20px", fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ marginBottom: 10 }}>
              <strong>{ADIR_DESK_PROFILE.displayName}</strong> — {ADIR_DESK_PROFILE.title}
            </div>
            <div style={{ marginBottom: 10, color: "var(--text-muted)" }}>{ADIR_DESK_PROFILE.focus}</div>
            <div style={{ marginBottom: 10 }}>
              <strong>כלים:</strong> <code style={{ fontSize: 11 }}>{ADIR_DESK_PROFILE.tools}</code>
            </div>
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--ivory)", borderRadius: 8 }}>
              <strong>בריף בוקר:</strong> {ADIR_DESK_PROFILE.morningBrief}
            </div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>כללים שנלמדו (front_desk)</div>
            {adirRulesLoading ? (
              <div style={{ color: "var(--text-muted)" }}>⏳ טוען…</div>
            ) : adirRules.length === 0 ? (
              <div style={{ color: "var(--text-muted)" }}>אין עדיין — אדיר יכול לומר «תזכרי ש…» בקול.</div>
            ) : (
              <ul style={{ margin: 0, padding: "0 18px" }}>
                {adirRules.map((r) => <li key={r.id}>{r.rule_text}</li>)}
              </ul>
            )}
          </div>
        </div>

        {/* ── Learned rules ──────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">🧠 כללים שנלמדו — אליעד (executive)</div>
          </div>
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={newRuleText}
                onChange={(e) => setNewRuleText(e.target.value)}
                placeholder="הוסף כלל ידנית, למשל: 'תלונת VIP על הספא מקפיצה התראה'"
                style={{
                  flex: 1, padding: "10px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", fontSize: 13, direction: "rtl",
                }}
                disabled={adding}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleAddRule}
                disabled={adding || !newRuleText.trim()}
              >
                {adding ? "מוסיף…" : "➕ הוסף"}
              </button>
            </div>

            {rulesLoading ? (
              <div style={{ color: "var(--text-muted)", padding: "12px 0", textAlign: "center" }}>⏳ טוען…</div>
            ) : rules.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                עדיין אין כללים שנשמרו. מורשים יכולים לומר "תזכרי ש..." בהודעה קולית והמערכת תשמור זאת אוטומטית.
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {rules.map((row) => {
                  const isEditing = editingId === row.id;
                  const isBusy = busyId === row.id || busyId === `del-${row.id}`;
                  return (
                    <li key={row.id} style={{
                      padding: "10px 14px", background: "var(--ivory)", borderRadius: 8,
                      border: isEditing ? "1.5px solid #6B21A8" : "1px solid var(--border)",
                      fontSize: 13, lineHeight: 1.65,
                    }}>
                      {isEditing ? (
                        <>
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            rows={3}
                            disabled={isBusy}
                            style={{
                              width: "100%", boxSizing: "border-box", padding: "10px 12px",
                              borderRadius: 8, border: "1px solid var(--border)", fontSize: 13,
                              lineHeight: 1.6, resize: "vertical", direction: "rtl",
                            }}
                          />
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(row.id)} disabled={isBusy || !editingText.trim()}>
                              {busyId === row.id ? "שומר…" : "💾 שמור"}
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEdit} disabled={isBusy}>ביטול</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>{row.rule_text}</div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDate(row.created_at)}</span>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(row)} disabled={isBusy}>✏️ ערוך</button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleDelete(row)} disabled={isBusy}>
                                {busyId === `del-${row.id}` ? "מוחק…" : "🗑️ מחק"}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ── Recent action log ──────────────────────────────────────────── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">📜 20 הפעולות האחרונות</div>
          </div>
          <div style={{ padding: "16px 20px" }}>
            {logLoading ? (
              <div style={{ color: "var(--text-muted)", padding: "12px 0", textAlign: "center" }}>⏳ טוען…</div>
            ) : log.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>אין עדיין פעולות רשומות.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {log.map((row) => (
                  <div key={row.id} style={{
                    padding: "8px 12px", background: "var(--ivory)", borderRadius: 8,
                    border: "1px solid var(--border)", fontSize: 12, display: "flex",
                    justifyContent: "space-between", gap: 12,
                  }}>
                    <span>
                      <strong>{row.tool_name}</strong>
                      {row.result_json?.ok === false ? (
                        <span style={{ color: "#C0392B" }}> — ⚠️ {String(row.result_json?.error ?? "נכשל")}</span>
                      ) : (
                        <span style={{ color: "#1A7A4A" }}> — ✅ בוצע</span>
                      )}
                    </span>
                    <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
