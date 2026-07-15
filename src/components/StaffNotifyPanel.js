// StaffNotifyPanel — edit & preview Adir/Eliad automated messages (Executive Playbook).

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import {
  STAFF_DIGEST_FIELD_LABELS,
  STAFF_TEMPLATE_PLACEHOLDERS,
  CHANNEL_HINT_LABELS,
  FRONT_DESK_ONBOARDING_CONFIG_KEY,
} from "../utils/staffNotifyUiConfig";

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

const RECIPIENT_TABS = [
  { id: "front_desk", label: "🏨 אדיר — דלפק" },
  { id: "executive", label: "👔 אליעד — מנכ״ל" },
];

export default function StaffNotifyPanel({ showToast }) {
  const [panelTab, setPanelTab] = useState("editor");
  const [recipient, setRecipient] = useState("front_desk");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [draftText, setDraftText] = useState("");
  const [draftDigest, setDraftDigest] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewBody, setPreviewBody] = useState("");
  const [digestPeriod, setDigestPeriod] = useState("daily");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [onboardingSent, setOnboardingSent] = useState(null);
  const [resettingOnboarding, setResettingOnboarding] = useState(false);

  const filtered = useMemo(
    () => templates.filter((t) => t.recipient_role === recipient).sort((a, b) => a.sort_order - b.sort_order),
    [templates, recipient],
  );

  const selected = useMemo(
    () => templates.find((t) => t.template_key === selectedKey) ?? null,
    [templates, selectedKey],
  );

  const fetchTemplates = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("staff_message_templates")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) showToast("err", "שגיאה בטעינת תבניות: " + error.message);
    else setTemplates(data ?? []);
    setLoading(false);
  }, [showToast]);

  const fetchOnboardingFlag = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase
      .from("bot_config")
      .select("config_value")
      .eq("config_key", FRONT_DESK_ONBOARDING_CONFIG_KEY)
      .maybeSingle();
    setOnboardingSent(String(data?.config_value ?? "").trim().toLowerCase() === "true");
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setHistoryLoading(true);
    const [adirRes, eliadRes] = await Promise.all([
      supabase
        .from("front_desk_morning_log")
        .select("id, digest_date, body_sent, sent_at")
        .order("sent_at", { ascending: false })
        .limit(15),
      supabase
        .from("resort_digest_log")
        .select("id, period, period_date, body_sent, sent_at")
        .order("sent_at", { ascending: false })
        .limit(15),
    ]);
    const rows = [
      ...(adirRes.data ?? []).map((r) => ({
        id: `adir-${r.id}`,
        recipient: "אדיר",
        label: `בריף בוקר — ${r.digest_date}`,
        body: r.body_sent,
        sent_at: r.sent_at,
      })),
      ...(eliadRes.data ?? []).map((r) => ({
        id: `eliad-${r.id}`,
        recipient: "אליעד",
        label: `דוח ${r.period} — ${r.period_date}`,
        body: r.body_sent,
        sent_at: r.sent_at,
      })),
    ].sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
    setHistory(rows.slice(0, 30));
    setHistoryLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); fetchOnboardingFlag(); }, [fetchTemplates, fetchOnboardingFlag]);
  useEffect(() => {
    if (panelTab === "history") fetchHistory();
  }, [panelTab, fetchHistory]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedKey(null);
      return;
    }
    if (!filtered.some((t) => t.template_key === selectedKey)) {
      setSelectedKey(filtered[0].template_key);
    }
  }, [filtered, selectedKey]);

  useEffect(() => {
    const row = templates.find((t) => t.template_key === selectedKey);
    if (!row) return;
    setDraftText(row.message_text ?? "");
    setDraftDigest(
      row.digest_config && typeof row.digest_config === "object"
        ? { ...row.digest_config }
        : {},
    );
    setDirty(false);
    setPreviewBody("");
  }, [selectedKey, templates]);

  const selectTemplate = (key) => {
    if (dirty && !window.confirm("יש שינויים לא שמורים. לעבור בכל זאת?")) return;
    setSelectedKey(key);
  };

  const handleDigestField = (field, value) => {
    setDraftDigest((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const insertPlaceholder = (token) => {
    setDraftText((prev) => `${prev}{{${token}}}`);
    setDirty(true);
  };

  const runPreview = async () => {
    if (!selected || !supabase) return;
    setPreviewing(true);
    const payload = {
      template_key: selected.template_key,
      period: digestPeriod,
    };
    if (selected.category === "digest_shell" || selected.template_key === "adir_morning_brief") {
      payload.digest_config = draftDigest;
    } else {
      payload.message_text = draftText;
    }
    const { data, error } = await supabase.functions.invoke("staff-notify-preview", { body: payload });
    setPreviewing(false);
    if (error) return showToast("err", "תצוגה מקדימה נכשלה: " + error.message);
    if (!data?.ok) return showToast("err", data?.error ?? "תצוגה מקדימה נכשלה");
    setPreviewBody(data.preview_body ?? "");
  };

  const handleSave = async () => {
    if (!selected || !supabase) return;
    setSaving(true);
    const patch = { updated_at: new Date().toISOString() };
    if (selected.category === "digest_shell" || selected.template_key === "adir_morning_brief") {
      patch.digest_config = draftDigest;
    } else {
      patch.message_text = draftText;
    }
    const { error } = await supabase
      .from("staff_message_templates")
      .update(patch)
      .eq("template_key", selected.template_key);
    setSaving(false);
    if (error) return showToast("err", "שגיאה בשמירה: " + error.message);
    showToast("ok", "✓ התבנית נשמרה");
    setDirty(false);
    fetchTemplates();
  };

  const handleResetOnboarding = async () => {
    if (!window.confirm("לאפס את דגל המדריך החד-פעמי? אדיר יקבל את המדריך שוב בבריף הבוקר הבא.")) return;
    setResettingOnboarding(true);
    const { error } = await supabase.from("bot_config").upsert(
      { config_key: FRONT_DESK_ONBOARDING_CONFIG_KEY, config_value: "false" },
      { onConflict: "config_key" },
    );
    setResettingOnboarding(false);
    if (error) return showToast("err", error.message);
    showToast("ok", "✓ המדריך יישלח שוב בפעם הבאה");
    fetchOnboardingFlag();
  };

  const digestFields = STAFF_DIGEST_FIELD_LABELS[selected?.template_key] ?? null;
  const placeholders = STAFF_TEMPLATE_PLACEHOLDERS[selected?.template_key] ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { id: "editor", label: "✏️ עורך תבניות" },
          { id: "history", label: "📜 היסטוריית שליחות" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn btn-sm ${panelTab === t.id ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setPanelTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {panelTab === "history" ? (
        <div className="card">
          <div className="card-header">
            <div className="card-title">📜 הודעות שנשלחו בפועל</div>
          </div>
          <div style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              בריף בוקר אדיר + דוחות אליעד. התראות אירוע (שעת הגעה, פורטל…) אינן בלוג זה עדיין.
            </div>
            {historyLoading ? (
              <div style={{ color: "var(--text-muted)" }}>⏳ טוען…</div>
            ) : history.length === 0 ? (
              <div style={{ color: "var(--text-muted)" }}>אין עדיין רשומות.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {history.map((row) => (
                  <details key={row.id} style={{
                    padding: "10px 14px", background: "var(--ivory)", borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}>
                    <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                      {row.recipient} — {row.label}
                      <span style={{ fontWeight: 400, color: "var(--text-muted)", marginRight: 8 }}>
                        {formatDate(row.sent_at)}
                      </span>
                    </summary>
                    <pre style={{
                      marginTop: 10, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6,
                      direction: "rtl", fontFamily: "inherit",
                    }}>
                      {row.body}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {RECIPIENT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn btn-sm ${recipient === t.id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setRecipient(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {recipient === "front_desk" && onboardingSent !== null && (
            <div style={{
              padding: "10px 14px", marginBottom: 16, borderRadius: 8,
              background: onboardingSent ? "var(--ivory)" : "rgba(13,148,136,0.08)",
              border: "1px solid #0D9488", fontSize: 12, lineHeight: 1.6,
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <span>
                מדריך חד-פעמי: {onboardingSent ? "✅ כבר נשלח" : "⏳ יישלח בבריף הבוקר הבא"}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleResetOnboarding}
                disabled={resettingOnboarding}
                title="מאפס את bot_config.front_desk_onboarding_sent"
              >
                {resettingOnboarding ? "מאפס…" : "🔄 שלח מדריך מחדש"}
              </button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) 1fr", gap: 16 }}>
            <div className="card" style={{ alignSelf: "start" }}>
              <div className="card-header">
                <div className="card-title">סוג הודעה</div>
              </div>
              <div style={{ padding: "8px 10px" }}>
                {loading ? (
                  <div style={{ padding: 12, color: "var(--text-muted)" }}>⏳</div>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {filtered.map((t) => (
                      <li key={t.template_key}>
                        <button
                          type="button"
                          onClick={() => selectTemplate(t.template_key)}
                          style={{
                            width: "100%", textAlign: "right", padding: "10px 12px", marginBottom: 4,
                            borderRadius: 8, border: selectedKey === t.template_key ? "1.5px solid #6B21A8" : "1px solid var(--border)",
                            background: selectedKey === t.template_key ? "rgba(107,33,168,0.08)" : "transparent",
                            cursor: "pointer", fontSize: 13,
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>{t.display_name_he}</div>
                          {t.channel_hint && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              {CHANNEL_HINT_LABELS[t.channel_hint] ?? t.channel_hint}
                            </div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="card-title">{selected?.display_name_he ?? "—"}</div>
                {selected?.template_key === "eliad_digest_shell" && (
                  <select
                    value={digestPeriod}
                    onChange={(e) => setDigestPeriod(e.target.value)}
                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6 }}
                  >
                    <option value="daily">תצוגה: דוח יומי</option>
                    <option value="weekly">תצוגה: דוח שבועי</option>
                    <option value="monthly">תצוגה: דוח חודשי</option>
                  </select>
                )}
              </div>
              <div style={{ padding: "16px 20px" }}>
                {!selected ? (
                  <div style={{ color: "var(--text-muted)" }}>בחר סוג הודעה משמאל</div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
                      {digestFields
                        ? "עריכת מעטפת בלבד — נתוני הגעות/משימות/סקרים נשארים דטרמיניסטיים מהמערכת."
                        : "עריכת טקסט מלא עם {{משתנים}} — הנתונים האמיתיים מוזרקים בשליחה."}
                    </div>

                    {digestFields ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {Object.entries(digestFields).map(([field, label]) => (
                          <div key={field}>
                            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>{label}</label>
                            <textarea
                              value={draftDigest[field] ?? ""}
                              onChange={(e) => handleDigestField(field, e.target.value)}
                              rows={field === "power_hints" ? 5 : 2}
                              style={{
                                width: "100%", boxSizing: "border-box", padding: "10px 12px",
                                borderRadius: 8, border: "1px solid var(--border)", fontSize: 13,
                                lineHeight: 1.6, direction: "rtl", fontFamily: "inherit", resize: "vertical",
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        {placeholders.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {placeholders.map((p) => (
                              <button
                                key={p}
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => insertPlaceholder(p)}
                                style={{ fontSize: 11 }}
                              >
                                {`{{${p}}}`}
                              </button>
                            ))}
                          </div>
                        )}
                        <textarea
                          value={draftText}
                          onChange={(e) => { setDraftText(e.target.value); setDirty(true); }}
                          rows={18}
                          style={{
                            width: "100%", boxSizing: "border-box", padding: "12px 14px",
                            borderRadius: 8, border: "1px solid var(--border)", fontSize: 13,
                            lineHeight: 1.7, direction: "rtl", fontFamily: "inherit", resize: "vertical",
                          }}
                        />
                      </>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleSave}
                        disabled={saving || !dirty}
                      >
                        {saving ? "שומר…" : "💾 שמור"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={runPreview}
                        disabled={previewing}
                      >
                        {previewing ? "טוען…" : "👁 תצוגה מקדימה (דאטה אמיתי)"}
                      </button>
                      {dirty && <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>שינויים לא שמורים</span>}
                    </div>

                    {previewBody && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>תצוגה מקדימה</div>
                        <pre style={{
                          padding: "12px 14px", background: "var(--ivory)", borderRadius: 8,
                          border: "1px solid var(--border)", whiteSpace: "pre-wrap", fontSize: 12,
                          lineHeight: 1.65, direction: "rtl", fontFamily: "inherit", maxHeight: 420, overflow: "auto",
                        }}>
                          {previewBody}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
