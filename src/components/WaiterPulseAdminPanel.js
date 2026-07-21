// Management: waiter service pulse — link, editable survey, responses.

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { canPerform } from "../utils/auth";
import WaiterPulseForm from "./WaiterPulseForm";
import {
  BOT_CONFIG_WAITER_PULSE_UI_KEY,
  WAITER_PULSE_MANAGEMENT_STATUSES,
  WAITER_PULSE_MAX_QUESTIONS,
  WAITER_PULSE_MIN_QUESTIONS,
  WAITER_PULSE_QUESTION_TYPES,
  cloneDefaultWaiterPulseUi,
  formatWaiterPulseAnswerForDisplay,
  makeWaiterPulseQuestionKey,
  managementStatusLabel,
  normalizeWaiterPulseUi,
  serializeWaiterPulseUi,
} from "../utils/waiterPulseUi";

const fieldInputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--black)",
  fontSize: 13.5, fontFamily: "inherit", textAlign: "right",
};

function pulsePublicUrl(token) {
  return `${window.location.origin}/pulse/${token}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("העתיקו את הקישור:", text);
    return false;
  }
}

function SurveyEditorModal({ draft, onChange, onSave, onClose, saving, canEdit }) {
  const canAdd = draft.questions.length < WAITER_PULSE_MAX_QUESTIONS;
  const canRemove = draft.questions.length > WAITER_PULSE_MIN_QUESTIONS;

  const addQuestion = (type) => {
    const key = makeWaiterPulseQuestionKey(draft.questions.map((q) => q.key));
    const base = {
      key,
      type,
      label: "שאלה חדשה",
      required: false,
      placeholder: "",
      min_length: type === "text" ? 0 : 0,
      options: type === "text" ? [] : [{ id: "opt_1", label: "אפשרות 1" }],
      allow_other: false,
      other_label: "אחר",
    };
    onChange({ ...draft, questions: [...draft.questions, base] });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 640, maxHeight: "92vh", overflow: "auto",
          borderRadius: 16, background: "var(--card-bg)", border: "1px solid var(--border)",
          padding: 20, direction: "rtl",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>✏️ עריכת סקר מלצרים</div>
          <button type="button" onClick={onClose} style={{ cursor: "pointer", fontFamily: "inherit" }}>סגור</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 14 }}>
          הסקר שואל מה לשפר בשירות — לא הערכה עצמית. אפשר לשנות שאלות, אפשרויות וטקסטים.
        </p>

        {[
          ["panel_title", "כותרת"],
          ["intro_text", "טקסט פתיחה"],
          ["submit_label", "כפתור שליחה"],
          ["thank_you_title", "כותרת תודה"],
          ["thank_you_body", "טקסט אחרי שליחה"],
        ].map(([key, label]) => (
          <label key={key} style={{ display: "block", marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
            {key === "intro_text" || key === "thank_you_body" ? (
              <textarea
                value={draft[key] ?? ""}
                disabled={!canEdit}
                onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
                rows={3}
                style={{ ...fieldInputStyle, resize: "vertical" }}
              />
            ) : (
              <input
                value={draft[key] ?? ""}
                disabled={!canEdit}
                onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
                style={fieldInputStyle}
              />
            )}
          </label>
        ))}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
          {WAITER_PULSE_QUESTION_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={!canEdit || !canAdd}
              onClick={() => addQuestion(t.id)}
              style={{
                padding: "7px 12px", borderRadius: 8, border: "1px solid var(--gold-dark)",
                background: "var(--ivory)", cursor: canEdit && canAdd ? "pointer" : "not-allowed",
                fontFamily: "inherit", fontWeight: 700, fontSize: 12,
              }}
            >
              ＋ {t.label}
            </button>
          ))}
        </div>

        {draft.questions.map((q, idx) => (
          <div
            key={q.key}
            style={{
              border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 12,
              background: "var(--ivory)",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{q.key} · {q.type}</div>
            <input
              value={q.label}
              disabled={!canEdit}
              onChange={(e) => {
                const questions = draft.questions.map((row, i) =>
                  i === idx ? { ...row, label: e.target.value } : row,
                );
                onChange({ ...draft, questions });
              }}
              style={{ ...fieldInputStyle, marginBottom: 8, fontWeight: 700 }}
            />
            <input
              value={q.help_text ?? ""}
              disabled={!canEdit}
              placeholder="טקסט עזר (אופציונלי)"
              onChange={(e) => {
                const questions = draft.questions.map((row, i) =>
                  i === idx ? { ...row, help_text: e.target.value } : row,
                );
                onChange({ ...draft, questions });
              }}
              style={{ ...fieldInputStyle, marginBottom: 8, fontSize: 12 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={q.required === true}
                disabled={!canEdit}
                onChange={(e) => {
                  const questions = draft.questions.map((row, i) =>
                    i === idx ? { ...row, required: e.target.checked } : row,
                  );
                  onChange({ ...draft, questions });
                }}
              />
              שדה חובה
            </label>

            {q.type === "text" && (
              <>
                <input
                  value={q.placeholder ?? ""}
                  disabled={!canEdit}
                  placeholder="placeholder"
                  onChange={(e) => {
                    const questions = draft.questions.map((row, i) =>
                      i === idx ? { ...row, placeholder: e.target.value } : row,
                    );
                    onChange({ ...draft, questions });
                  }}
                  style={{ ...fieldInputStyle, marginBottom: 8 }}
                />
                <label style={{ fontSize: 12 }}>
                  מינימום תווים:{" "}
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={q.min_length ?? 0}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const questions = draft.questions.map((row, i) =>
                        i === idx ? { ...row, min_length: Number(e.target.value) || 0 } : row,
                      );
                      onChange({ ...draft, questions });
                    }}
                    style={{ width: 64, marginRight: 6 }}
                  />
                </label>
              </>
            )}

            {(q.type === "single_choice" || q.type === "multi_choice") && (
              <>
                {(q.options ?? []).map((opt, oi) => (
                  <div key={opt.id} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <input
                      value={opt.label}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const questions = draft.questions.map((row, i) => {
                          if (i !== idx) return row;
                          const options = row.options.map((o, j) =>
                            j === oi ? { ...o, label: e.target.value } : o,
                          );
                          return { ...row, options };
                        });
                        onChange({ ...draft, questions });
                      }}
                      style={{ ...fieldInputStyle, flex: 1 }}
                    />
                  </div>
                ))}
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={q.allow_other === true}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const questions = draft.questions.map((row, i) =>
                        i === idx ? { ...row, allow_other: e.target.checked } : row,
                      );
                      onChange({ ...draft, questions });
                    }}
                  />
                  אפשרות «אחר» עם טקסט חופשי
                </label>
              </>
            )}

            {canEdit && (
              <button
                type="button"
                disabled={!canRemove}
                onClick={() => onChange({
                  ...draft,
                  questions: draft.questions.filter((_, i) => i !== idx),
                })}
                style={{
                  marginTop: 10, padding: "6px 10px", borderRadius: 8,
                  border: "1px solid #C0392B", color: "#C0392B", background: "#fff",
                  cursor: canRemove ? "pointer" : "not-allowed", fontFamily: "inherit",
                }}
              >
                הסר שאלה
              </button>
            )}
          </div>
        ))}

        {canEdit && (
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              style={{
                flex: 1, padding: "12px 16px", borderRadius: 12, border: "none",
                background: "linear-gradient(135deg, var(--gold), #B8960C)", fontWeight: 800,
                cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
              }}
            >
              {saving ? "שומר…" : "💾 שמירת סקר"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onChange(cloneDefaultWaiterPulseUi())}
              style={{
                padding: "12px 16px", borderRadius: 12, border: "1px solid var(--border)",
                background: "#fff", fontFamily: "inherit", fontWeight: 700,
              }}
            >
              איפוס לברירת מחדל
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WaiterPulseAdminPanel({ user }) {
  const canEdit = canPerform("view_admin_panel", user);
  const [links, setLinks] = useState([]);
  const [responses, setResponses] = useState([]);
  const [ui, setUi] = useState(cloneDefaultWaiterPulseUi());
  const [uiDraft, setUiDraft] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingUi, setSavingUi] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [toast, setToast] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [linksRes, respRes, cfgRes] = await Promise.all([
      supabase.from("waiter_pulse_links").select("*").order("is_active", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("waiter_pulse_responses").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("bot_config").select("config_value").eq("config_key", BOT_CONFIG_WAITER_PULSE_UI_KEY).maybeSingle(),
    ]);
    if (linksRes.error) showToast("err", linksRes.error.message);
    else setLinks(linksRes.data ?? []);
    if (respRes.error) showToast("err", respRes.error.message);
    else setResponses(respRes.data ?? []);
    let raw = cfgRes.data?.config_value;
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = null; }
    }
    setUi(normalizeWaiterPulseUi(raw));
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("waiter-pulse-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "waiter_pulse_responses" }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadAll]);

  const activeLink = links.find((l) => l.is_active);

  const rotateLink = async () => {
    if (!supabase || !activeLink) return;
    try {
      await supabase.from("waiter_pulse_links").update({ is_active: false }).eq("id", activeLink.id);
      const { error } = await supabase.from("waiter_pulse_links").insert({ label: activeLink.label || "מסעדה — סבב שירות" });
      if (error) throw error;
      showToast("ok", "קישור חדש נוצר — הישן הושבת");
      await loadAll();
    } catch (e) {
      showToast("err", e?.message ?? "שגיאה");
    }
  };

  const ensureLink = async () => {
    if (!supabase) return;
    if (activeLink) return;
    const { error } = await supabase.from("waiter_pulse_links").insert({ label: "מסעדה — סבב שירות" });
    if (error) showToast("err", error.message);
    else await loadAll();
  };

  const saveUi = async () => {
    if (!supabase || !uiDraft) return;
    setSavingUi(true);
    try {
      const payload = serializeWaiterPulseUi(uiDraft);
      const { error } = await supabase.from("bot_config").upsert({
        config_key: BOT_CONFIG_WAITER_PULSE_UI_KEY,
        config_value: payload,
        category: "general",
        label: "סקר סבב שירות מלצרים (JSON)",
      }, { onConflict: "config_key" });
      if (error) throw error;
      setUi(normalizeWaiterPulseUi(uiDraft));
      setUiDraft(null);
      showToast("ok", "הסקר נשמר");
    } catch (e) {
      showToast("err", e?.message ?? "שגיאה בשמירה");
    } finally {
      setSavingUi(false);
    }
  };

  const updateResponseStatus = async (row, management_status, management_note) => {
    if (!supabase) return;
    const patch = {
      management_status,
      management_note: management_note ?? row.management_note,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    };
    const { error } = await supabase.from("waiter_pulse_responses").update(patch).eq("id", row.id);
    if (error) showToast("err", error.message);
    else {
      setResponses((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
      showToast("ok", "עודכן");
    }
  };

  const filteredResponses = responses.filter((r) =>
    statusFilter === "all" ? true : r.management_status === statusFilter,
  );

  const newCount = responses.filter((r) => r.management_status === "new").length;

  return (
    <div style={{ direction: "rtl" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700,
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
        }}>
          {toast.msg}
        </div>
      )}

      {uiDraft && (
        <SurveyEditorModal
          draft={uiDraft}
          onChange={setUiDraft}
          onSave={saveUi}
          onClose={() => setUiDraft(null)}
          saving={savingUi}
          canEdit={canEdit}
        />
      )}

      {showPreview && (
        <div
          role="dialog"
          onClick={() => setShowPreview(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.72)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 420, maxHeight: "92vh", overflow: "auto",
              borderRadius: 18, background: "linear-gradient(180deg, #0f172a, #09090b)",
              padding: 18, border: "1px solid rgba(212,175,55,0.28)",
            }}
          >
            <button type="button" onClick={() => setShowPreview(false)} style={{ marginBottom: 12, cursor: "pointer" }}>
              סגור
            </button>
            <WaiterPulseForm ui={ui} variant="portal" previewOnly />
          </div>
        </div>
      )}

      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 20,
      }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--card-bg)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>🔗 קישור למלצרים (ללא התחברות)</div>
          {loading ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>טוען…</div>
          ) : activeLink ? (
            <>
              <div style={{
                fontSize: 12, wordBreak: "break-all", background: "var(--ivory)",
                padding: 10, borderRadius: 8, marginBottom: 10, direction: "ltr", textAlign: "left",
              }}>
                {pulsePublicUrl(activeLink.token)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyText(pulsePublicUrl(activeLink.token));
                    if (ok) {
                      setCopiedId(activeLink.id);
                      setTimeout(() => setCopiedId(null), 2000);
                    }
                  }}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--gold)", cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}
                >
                  {copiedId === activeLink.id ? "✓ הועתק" : "העתק קישור"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = pulsePublicUrl(activeLink.token);
                    const text = encodeURIComponent(`סבב שירות — מה לשפר במסעדה?\n${url}`);
                    window.open(`https://wa.me/?text=${text}`, "_blank");
                  }}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit" }}
                >
                  שלח ב-WhatsApp
                </button>
                {canEdit && (
                  <button type="button" onClick={rotateLink} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit" }}>
                    🔄 קישור חדש
                  </button>
                )}
              </div>
            </>
          ) : (
            <button type="button" onClick={ensureLink} style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: "var(--gold)", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
              צור קישור ראשון
            </button>
          )}
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--card-bg)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>✏️ עריכת הסקר</div>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 12 }}>
            שאלות על מה לשפר — לא על ביצועים אישיים של המלצר.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setShowPreview(true)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit" }}>
              👁️ תצוגה מקדימה
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => setUiDraft(JSON.parse(JSON.stringify(ui)))}
                style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "var(--gold)", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
              >
                ערוך שאלות
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>
        תשובות מלצרים
        {newCount > 0 && (
          <span style={{ marginRight: 8, fontSize: 12, color: "#C0392B", fontWeight: 700 }}>
            · {newCount} חדשות
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {[{ id: "all", label: "הכל" }, ...WAITER_PULSE_MANAGEMENT_STATUSES].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStatusFilter(s.id)}
            style={{
              padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: statusFilter === s.id ? "2px solid var(--gold-dark)" : "1px solid var(--border)",
              background: statusFilter === s.id ? "rgba(201,169,110,0.15)" : "#fff",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 24, color: "var(--text-muted)" }}>טוען תשובות…</div>
      ) : filteredResponses.length === 0 ? (
        <div style={{ padding: 24, border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text-muted)", textAlign: "center" }}>
          אין תשובות עדיין — שלחו את הקישור למלצרים.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredResponses.map((row) => {
            const answers = row.answers ?? {};
            const ideaQ =
              ui.questions.find((q) => q.key === "one_improvement") ??
              ui.questions.find((q) => q.key === "one_idea") ??
              ui.questions.find((q) => q.type === "text" && q.required);
            return (
              <div key={row.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--card-bg)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>
                      {row.submitter_name || "אנונימי"}
                      <span style={{ fontWeight: 500, color: "var(--text-muted)", fontSize: 12, marginRight: 8 }}>
                        {new Date(row.created_at).toLocaleString("he-IL")}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      סטטוס: {managementStatusLabel(row.management_status)}
                    </div>
                  </div>
                  <select
                    value={row.management_status}
                    onChange={(e) => updateResponseStatus(row, e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontFamily: "inherit" }}
                  >
                    {WAITER_PULSE_MANAGEMENT_STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>

                {ideaQ && (
                  <div style={{
                    padding: 12, background: "rgba(201,169,110,0.1)", borderRadius: 10, marginBottom: 10,
                    fontSize: 14, lineHeight: 1.55, fontWeight: 600,
                  }}>
                    💡 {formatWaiterPulseAnswerForDisplay(ideaQ, answers)}
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {ui.questions.filter((q) => q.key !== ideaQ?.key).map((q) => (
                    <div key={q.key} style={{ fontSize: 13, lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 700, color: "var(--text-muted)" }}>{q.label}: </span>
                      {formatWaiterPulseAnswerForDisplay(q, answers)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
