// src/components/AutomationControlCenter.js
// Unified "Smart Automation Builder & Live Monitor" — admin-only.
//
// Consolidates what used to be split across three places that never
// referenced each other (hardcoded PIPELINE_TEMPLATE maps in
// whatsapp-send/index.ts, bot_scripts content, and the decorative read-only
// timeline diagram in BroadcastDashboard.js) into one editable space backed
// by the automation_stages table (migration 065).
//
// IMPORTANT — this UI edits data, not behavior (yet). whatsapp-cron and
// whatsapp-send are not wired to read automation_stages until Phase 4 (a
// deliberately separate, carefully-staged change to the live guest pipeline
// — see PROJECT context). Until then, editing a stage here changes what the
// admin SEES, not what guests RECEIVE.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import TemplateManagerPanel from "./TemplateManagerPanel";

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

function timeInputValue(pgTime) {
  return pgTime ? String(pgTime).slice(0, 5) : "";
}

export default function AutomationControlCenter() {
  const [subTab, setSubTab] = useState("timeline"); // timeline | queue | templates
  const [stages, setStages] = useState([]);
  const [scriptsByKey, setScriptsByKey] = useState({});
  const [availableScriptKeys, setAvailableScriptKeys] = useState([]);
  const [loadingStages, setLoadingStages] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast] = useState(null);
  const [templateDraft, setTemplateDraft] = useState(null);

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

  const groupedByPhase = stages.reduce((acc, s) => {
    (acc[s.journey_phase] ??= []).push(s);
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
            ⚙️ עריכת תזמון/תוכן כאן משפיעה על מה שמוצג בלוח. ההפעלה בפועל מול האורחים (whatsapp-cron / whatsapp-send)
            עדיין רצה לפי הקוד הקיים — חיבור השניים הוא שלב נפרד שדורש אישור מפורש לפני שינוי הצנרת החיה.
          </div>

          {loadingStages ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>⏳ טוען שלבים...</div>
          ) : (
            Object.entries(JOURNEY_PHASE_LABELS).map(([phase, phaseLabel]) => (
              (groupedByPhase[phase] ?? []).length > 0 && (
                <div key={phase} style={{ marginBottom: 28 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "var(--gold-dark)", marginBottom: 10 }}>{phaseLabel}</div>
                  {groupedByPhase[phase].map((stage) => {
                    const isOpen = expanded === stage.id;
                    const nt = NODE_TYPE_META[stage.node_type] ?? NODE_TYPE_META.hybrid;
                    return (
                      <div key={stage.id} className="card" style={{ marginBottom: 12, opacity: stage.is_active ? 1 : 0.6, border: isOpen ? "1px solid var(--gold)" : undefined }}>
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", cursor: "pointer", borderBottom: isOpen ? "1px solid var(--border)" : "none" }}
                          onClick={() => setExpanded(isOpen ? null : stage.id)}
                        >
                          <span style={{ fontSize: 14, color: "var(--text-muted)", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▶</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{stage.display_name}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, color: nt.color, background: nt.bg }}>{nt.label}</span>
                            </div>
                            {stage.meta_template_name && (
                              <code style={{ fontSize: 11, color: "var(--text-muted)" }}>{stage.meta_template_name}</code>
                            )}
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
                                  <textarea
                                    rows={4}
                                    defaultValue={scriptsByKey[stage.session_message_script_key] ?? ""}
                                    onBlur={(e) => saveSessionMessage(stage.session_message_script_key, e.target.value)}
                                    style={{ direction: "rtl", fontFamily: "Heebo, sans-serif", lineHeight: 1.7, resize: "vertical" }}
                                  />
                                )}
                              </div>
                            )}

                            {/* ── Meta template (read-only — edited in Meta Business Manager / Templates tab) ── */}
                            {stage.meta_template_name && (
                              <div className="form-field" style={{ marginBottom: 0 }}>
                                <label>🔵 תבנית Meta (Fallback)</label>
                                <code style={{ background: "#F3F4F6", padding: "6px 10px", borderRadius: 6, display: "inline-block", fontSize: 12 }}>
                                  {stage.meta_template_name}
                                </code>
                                <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 8 }}>
                                  — ראה/ערוך בלשונית "📋 תבניות Meta"
                                </span>
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
                  })}
                </div>
              )
            ))
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
                            <td>{r.stageKey}</td>
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
