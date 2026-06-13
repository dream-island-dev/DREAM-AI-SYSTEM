import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Constants ────────────────────────────────────────────────────────────────
const LS_RECIPIENTS  = "broadcast_recipients";

const CATEGORY_LABELS = {
  MARKETING: { label: "שיווק",        icon: "📣" },
  UTILITY:   { label: "שירות ותפעול", icon: "🛎️" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function ls(key, fb) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; }
  catch { return fb; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function normalizePhone(raw) {
  let p = raw.replace(/[\s\-()‏]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0"))  p = "972" + p.slice(1);
  return p;
}

function getBodyText(tpl)   { return tpl.components?.find((c) => c.type === "BODY")?.text   ?? ""; }
function getHeaderText(tpl) { return tpl.components?.find((c) => c.type === "HEADER")?.text ?? ""; }
function getFooterText(tpl) { return tpl.components?.find((c) => c.type === "FOOTER")?.text ?? ""; }

function getBodyVars(tpl) {
  const nums = new Set();
  for (const m of getBodyText(tpl).matchAll(/\{\{(\d+)\}\}/g)) nums.add(Number(m[1]));
  return [...nums].sort((a, b) => a - b);
}
// vars > 1 — need manual input ({{1}} is always guest name)
function getExtraVars(tpl) { return getBodyVars(tpl).filter((n) => n > 1); }

function fillBody(text, values) {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n)] ?? `{{${n}}}`);
}

function maxVarInText(text) {
  const nums = new Set();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) nums.add(Number(m[1]));
  return nums.size === 0 ? 0 : Math.max(...nums);
}

function toSnakeCase(str) {
  return str.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}


// ── Main component ────────────────────────────────────────────────────────────
export default function WhatsAppBroadcast() {
  const [mode, setMode]           = useState("template"); // "template" | "free"

  // Meta templates
  const [metaTemplates, setMetaTemplates] = useState([]);
  const [metaLoading, setMetaLoading]     = useState(true);
  const [metaError, setMetaError]         = useState("");
  const [selectedName, setSelectedName]   = useState(null);
  const [varValues, setVarValues]         = useState({}); // { 2: "...", 3: "..." }

  // Template modal
  const [showTplModal, setShowTplModal]   = useState(false);
  const [showNewTpl, setShowNewTpl]       = useState(false);
  const [newTpl, setNewTpl]               = useState({ name: "", body: "", category: "MARKETING" });
  const [registering, setRegistering]     = useState(false);
  const [editTpl, setEditTpl]             = useState(null); // { originalName, name, body, category }
  const [deleting, setDeleting]           = useState(false);

  // Free text
  const [message, setMessage]             = useState("");

  // Recipients
  const [recipients, setRecipients]       = useState(() => ls(LS_RECIPIENTS, []));
  const [recForm, setRecForm]             = useState({ name: "", phone: "" });
  const [showRecForm, setShowRecForm]     = useState(false);

  // Send
  const [sending, setSending]             = useState(false);
  const [sendLog, setSendLog]             = useState([]);

  // Toast
  const [toast, setToast]                 = useState("");

  useEffect(() => { lsSet(LS_RECIPIENTS, recipients); }, [recipients]);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 3500); };

  // ── Fetch templates from Supabase message_templates table (no Meta API cost) ───
  const fetchMetaTemplates = useCallback(async () => {
    setMetaLoading(true); setMetaError("");
    try {
      let all;
      if (isSupabaseConfigured) {
        const { data, error } = await supabase
          .from("message_templates")
          .select("id,name,category,body,header,footer,meta_status")
          .eq("is_active", true);
        if (error) throw new Error(error.message);
        all = (data ?? []).map((t) => ({
          id: t.id, name: t.name, category: t.category,
          status: t.meta_status === "approved" ? "APPROVED" :
                  t.meta_status === "pending_approval" ? "PENDING" : t.meta_status.toUpperCase(),
          components: [
            ...(t.header ? [{ type: "HEADER", text: t.header }] : []),
            { type: "BODY", text: t.body },
            ...(t.footer ? [{ type: "FOOTER", text: t.footer }] : []),
          ],
        }));
      } else {
        setMetaTemplates([]); setMetaLoading(false); return;
      }
      setMetaTemplates(all);
    } catch (e) { setMetaError(e.message); }
    setMetaLoading(false);
  }, []);

  useEffect(() => { fetchMetaTemplates(); }, [fetchMetaTemplates]);

  const approvedTemplates = useMemo(
    () => metaTemplates.filter((t) => t.status === "APPROVED"),
    [metaTemplates],
  );
  const pendingCount = useMemo(
    () => metaTemplates.filter((t) => t.status === "PENDING" || t.status === "IN_APPEAL").length,
    [metaTemplates],
  );
  const selectedTpl = useMemo(
    () => approvedTemplates.find((t) => t.name === selectedName) ?? null,
    [approvedTemplates, selectedName],
  );
  const extraVars = useMemo(
    () => (selectedTpl ? getExtraVars(selectedTpl) : []),
    [selectedTpl],
  );
  const missingExtraVars = extraVars.filter((n) => !(varValues[n] ?? "").trim());

  const previewValues = useMemo(() => {
    if (!selectedTpl) return {};
    const v = {};
    for (const n of getBodyVars(selectedTpl)) {
      v[n] = n === 1
        ? (recipients[0]?.name ?? "אורח יקר")
        : ((varValues[n] ?? "").trim() || `{{${n}}}`);
    }
    return v;
  }, [selectedTpl, recipients, varValues]);

  // ── Recipients ────────────────────────────────────────────────────────────
  const addRecipient = () => {
    const name  = recForm.name.trim();
    const phone = normalizePhone(recForm.phone.trim());
    if (!phone || phone.length < 10) { showToast("❌ מספר טלפון לא תקין"); return; }
    if (recipients.find((r) => r.phone === phone)) { showToast("הנמען כבר קיים"); return; }
    setRecipients((p) => [...p, { id: Date.now(), name: name || phone, phone }]);
    setRecForm({ name: "", phone: "" }); setShowRecForm(false);
  };
  const removeRecipient = (id) => setRecipients((p) => p.filter((r) => r.id !== id));

  // ── Register new template via submit-wa-template edge function ──────────────
  const handleRegisterTemplate = async () => {
    const tplName = toSnakeCase(newTpl.name);
    if (!tplName || !newTpl.body.trim()) { showToast("❌ שם ותוכן נדרשים"); return; }
    setRegistering(true);
    try {
      let result;
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.functions.invoke("submit-wa-template", {
          body: { name: tplName, body: newTpl.body.trim(), category: newTpl.category },
        });
        result = error ? { ok: false, error: error.message } : (data?.ok ? data : { ok: false, error: data?.error });
      } else {
        showToast("❌ נדרש חיבור Supabase לרישום תבניות");
        setRegistering(false); return;
      }
      if (result.ok) {
        showToast(`✅ "${tplName}" נשלחה לאישור מטא`);
        setNewTpl({ name: "", body: "", category: "MARKETING" }); setShowNewTpl(false);
        setTimeout(() => fetchMetaTemplates(), 1000);
      } else {
        showToast(`❌ ${result.error}`);
      }
    } catch (e) { showToast(`❌ ${e.message}`); }
    setRegistering(false);
  };

  // ── Delete template ────────────────────────────────────────────────────────
  const handleDeleteTemplate = async (name) => {
    if (!window.confirm(`למחוק את "${name}"?\nלא ניתן לשחזר את התבנית לאחר המחיקה.`)) return;
    setDeleting(true);
    try {
      let result;
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { action: "delete_template", name },
        });
        result = error ? { ok: false, error: error.message } : data;
      } else {
        result = { ok: false, error: "נדרש חיבור Supabase לפעולה זו" };
      }
      if (result.ok) {
        showToast(`✅ "${name}" נמחקה`);
        await fetchMetaTemplates();
      } else {
        showToast(`❌ ${result.error}`);
      }
    } catch (e) { showToast(`❌ ${e.message}`); }
    setDeleting(false);
  };

  // ── Edit template (delete + recreate) ─────────────────────────────────────
  const handleEditTemplate = async () => {
    if (!editTpl) return;
    const tplName = toSnakeCase(editTpl.name);
    if (!tplName || !editTpl.body.trim()) { showToast("❌ שם ותוכן נדרשים"); return; }
    setDeleting(true);
    try {
      let delResult;
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { action: "delete_template", name: editTpl.originalName },
        });
        delResult = error ? { ok: false, error: error.message } : data;
      } else {
        delResult = { ok: false, error: "נדרש חיבור Supabase לפעולה זו" };
      }
      if (!delResult.ok) {
        showToast(`❌ מחיקה נכשלה: ${delResult.error}`);
        setDeleting(false); return;
      }
      let regResult;
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { action: "register_template", name: tplName, bodyText: editTpl.body.trim(), category: editTpl.category },
        });
        regResult = error ? { ok: false, error: error.message } : data;
      } else {
        regResult = { ok: false, error: "נדרש חיבור Supabase לפעולה זו" };
      }
      if (regResult.ok) {
        showToast(`✅ "${tplName}" נשלחה לאישור Meta מחדש`);
        setEditTpl(null);
        await fetchMetaTemplates();
      } else {
        showToast(`❌ ${regResult.error}`);
      }
    } catch (e) { showToast(`❌ ${e.message}`); }
    setDeleting(false);
  };

  // ── Send broadcast ─────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (recipients.length === 0 || sending) return;
    if (mode === "template" && (!selectedTpl || missingExtraVars.length > 0)) return;
    if (mode === "free" && message.trim().length < 3) return;

    setSending(true);
    const ts = new Date().toLocaleTimeString("he-IL");
    const results = [];

    for (const rec of recipients) {
      let result;
      try {
        if (mode === "template") {
          const allVars = getBodyVars(selectedTpl);
          // {{1}} = rec.name always, {{2}}+ = manual values
          const params = allVars.map((n) => n === 1 ? rec.name : (varValues[n] ?? "").trim());
          const tplPayload = { name: selectedTpl.name, language: selectedTpl.language ?? "he", params };
          if (isSupabaseConfigured) {
            const { data, error } = await supabase.functions.invoke("whatsapp-send", {
              body: { to: rec.phone, template: tplPayload },
            });
            result = error ? { ok: false, error: error.message }
              : data?.ok ? { ok: true, id: data.messages?.[0]?.id }
              : { ok: false, error: data?.error ?? "שגיאה" };
          } else {
            result = { ok: false, error: "נדרש חיבור Supabase לשליחת הודעות" };
          }
        } else {
          const msgBody = message.replace(/\{guest_name\}/g, rec.name);
          if (isSupabaseConfigured) {
            const { data, error } = await supabase.functions.invoke("whatsapp-send", {
              body: { to: rec.phone, message: msgBody },
            });
            result = error ? { ok: false, error: error.message }
              : data?.ok ? { ok: true, id: data.messages?.[0]?.id }
              : { ok: false, error: data?.error ?? "שגיאה" };
          } else {
            result = { ok: false, error: "נדרש חיבור Supabase לשליחת הודעות" };
          }
        }
      } catch (e) { result = { ok: false, error: e.message }; }
      results.push({ ...rec, ...result, ts });
    }

    setSendLog((p) => [{
      id: Date.now(), sentAt: ts,
      msgPreview: mode === "template" ? `📋 ${selectedTpl.name}` : message.slice(0, 60),
      total: results.length, ok: results.filter((r) => r.ok).length, rows: results,
    }, ...p]);

    const ok = results.filter((r) => r.ok).length;
    showToast(`📤 נשלח ${ok}/${results.length}`);
    setSending(false);
    if (ok === results.length && mode === "free") setMessage("");
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const todaySent = sendLog.reduce((s, b) => s + b.ok, 0);
  const canSend = recipients.length > 0 && !sending && (
    mode === "template"
      ? Boolean(selectedTpl) && missingExtraVars.length === 0
      : message.trim().length >= 3
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl">

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A1A", color: "#fff", padding: "10px 28px", borderRadius: 30,
          fontWeight: 700, fontSize: 14, zIndex: 9999, boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
          whiteSpace: "nowrap", border: "1px solid rgba(201,169,110,0.3)" }}>
          {toast}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div className="stat-value">{approvedTemplates.length}</div>
          <div className="stat-label">תבניות מאושרות</div>
          {pendingCount > 0 && <div className="stat-sub" style={{ color: "#B8860B" }}>עוד {pendingCount} בבדיקה</div>}
        </div>
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-value">{recipients.length}</div>
          <div className="stat-label">נמענים פעילים</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📤</div>
          <div className="stat-value">{todaySent}</div>
          <div className="stat-label">נשלח בסשן</div>
          <div className="stat-sub" style={{ color: isSupabaseConfigured ? "#1A7A4A" : "#8A7A6A" }}>
            {isSupabaseConfigured ? "Edge Function" : "מצב דמו"}
          </div>
        </div>
      </div>

      {/* ── Mode toggle ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`btn ${mode === "template" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("template")}>
          📋 תבנית מאושרת — לכל לקוח
        </button>
        <button className={`btn ${mode === "free" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("free")}>
          ✏️ טקסט חופשי — רק חלון 24 שעות
        </button>
      </div>

      {/* ════ TEMPLATE MODE ════ */}
      {mode === "template" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, marginBottom: 20 }}>

          {/* Left — template selector + preview */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">📋 בחר תבנית</div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowTplModal(true)}>
                ✏️ ערוך תבניות
              </button>
            </div>
            <div style={{ padding: "20px 24px" }}>

              {metaLoading ? (
                <div style={{ textAlign: "center", color: "#8A7A6A", padding: 32 }}>טוען תבניות ממטא...</div>
              ) : (
                <>
                  {/* Dropdown row */}
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
                    <div style={{ flex: 1 }}>
                      <select value={selectedName ?? ""}
                        onChange={(e) => { setSelectedName(e.target.value || null); setVarValues({}); }}
                        style={{ width: "100%", padding: "10px 14px", borderRadius: 10,
                          border: "1.5px solid #E0D5C5", fontSize: 14, background: "#fff",
                          color: selectedName ? "#1A1A1A" : "#8A7A6A", direction: "rtl",
                          appearance: "none", cursor: "pointer",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                        <option value="">— בחר תבנית —</option>
                        {Object.entries(CATEGORY_LABELS).map(([cat, meta]) => {
                          const tpls = approvedTemplates.filter((t) => t.category === cat);
                          if (!tpls.length) return null;
                          return (
                            <optgroup key={cat} label={`${meta.icon} ${meta.label}`}>
                              {tpls.map((t) => (
                                <option key={t.name} value={t.name}>{t.name}</option>
                              ))}
                            </optgroup>
                          );
                        })}
                        {approvedTemplates.filter((t) => !CATEGORY_LABELS[t.category]).map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={fetchMetaTemplates}
                      disabled={metaLoading} title="רענן מהמטא" style={{ flexShrink: 0 }}>
                      🔄
                    </button>
                  </div>

                  {approvedTemplates.length === 0 && (
                    <div style={{ textAlign: "center", color: "#8A7A6A", fontSize: 13, padding: "8px 0 16px" }}>
                      אין תבניות מאושרות.
                      {pendingCount > 0 && ` ${pendingCount} ממתינות לאישור מטא.`}
                    </div>
                  )}

                  {/* Selected template details */}
                  {selectedTpl && (
                    <>
                      {/* {{1}} auto tag */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 14px", background: "rgba(26,122,74,0.07)",
                        border: "1px solid rgba(26,122,74,0.2)", borderRadius: 10, marginBottom: 14 }}>
                        <span style={{ fontSize: 16 }}>✅</span>
                        <span style={{ fontSize: 13, color: "#1A7A4A", fontWeight: 600 }}>
                          {"{{"} 1 {"}}"} = שם האורח — אוטומטי מרשימת הנמענים
                        </span>
                      </div>

                      {/* Extra vars ({{2}}+) */}
                      {extraVars.map((n) => (
                        <div key={n} className="form-field" style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 12 }}>
                            {"{{"}{n}{"}}"} — ערך ידני (תאריך / קישור / מבצע) *
                          </label>
                          <input value={varValues[n] ?? ""} dir="auto"
                            onChange={(e) => setVarValues((v) => ({ ...v, [n]: e.target.value }))}
                            placeholder={`הכנס ערך עבור {{${n}}}`}
                            style={{ padding: "9px 12px", fontSize: 13 }} />
                        </div>
                      ))}

                      {/* WhatsApp preview bubble */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, color: "#8A7A6A", marginBottom: 6, fontWeight: 600 }}>
                          תצוגה מקדימה עבור {recipients[0]?.name ?? "אורח יקר"}:
                        </div>
                        <div style={{ maxWidth: 340,
                          background: "#E8F5E9", borderRadius: "2px 12px 12px 12px",
                          padding: "10px 14px", fontSize: 13, lineHeight: 1.65,
                          border: "1px solid rgba(37,211,102,0.25)",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                          {getHeaderText(selectedTpl) && (
                            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13.5 }}>
                              {getHeaderText(selectedTpl)}
                            </div>
                          )}
                          <div style={{ whiteSpace: "pre-wrap" }}>
                            {fillBody(getBodyText(selectedTpl), previewValues)}
                          </div>
                          {getFooterText(selectedTpl) && (
                            <div style={{ fontSize: 11, color: "#666", marginTop: 6,
                              borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 6 }}>
                              {getFooterText(selectedTpl)}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#1A7A4A", marginTop: 6 }}>
                          כל אורח יקבל את שמו האישי
                        </div>
                      </div>
                    </>
                  )}

                  {/* Send button */}
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {!selectedTpl && (
                        <span style={{ fontSize: 12, color: "#8A7A6A" }}>בחר תבנית כדי לשלוח</span>
                      )}
                      {missingExtraVars.length > 0 && (
                        <span className="badge badge-orange" style={{ fontSize: 11 }}>
                          חסר ערך {missingExtraVars.map((n) => `{{${n}}}`).join(", ")}
                        </span>
                      )}
                      {recipients.length === 0 && (
                        <span className="badge badge-orange" style={{ fontSize: 11 }}>אין נמענים</span>
                      )}
                    </div>
                    <button className="btn btn-primary" onClick={handleSend}
                      disabled={!canSend} style={{ opacity: canSend ? 1 : 0.45 }}>
                      {sending ? "שולח..." : `📤 שלח ל-${recipients.length} אורחים`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right — recipients */}
          <RecipientsPanel
            recipients={recipients} recForm={recForm} setRecForm={setRecForm}
            showRecForm={showRecForm} setShowRecForm={setShowRecForm}
            addRecipient={addRecipient} removeRecipient={removeRecipient} />
        </div>
      )}

      {/* ════ FREE TEXT MODE ════ */}
      {mode === "free" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, marginBottom: 20 }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title">✏️ הודעה חופשית</div>
              <span className="badge badge-orange" style={{ fontSize: 11 }}>
                ⚠️ רק למי שכתב ב-24 השעות האחרונות
              </span>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <div className="form-field">
                <label>תוכן ההודעה</label>
                <textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder={"היי {guest_name}! ...\n\nניתן להשתמש ב-{guest_name} לשם אישי."}
                  style={{ resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#8A7A6A" }}>{message.length} תווים</span>
                  {message.includes("{guest_name}") && (
                    <span className="badge badge-gold" style={{ fontSize: 11 }}>✓ שם אישי</span>
                  )}
                </div>
                <button className="btn btn-primary" onClick={handleSend}
                  disabled={!canSend} style={{ opacity: canSend ? 1 : 0.45 }}>
                  {sending ? "שולח..." : `📤 שלח ל-${recipients.length} אורחים`}
                </button>
              </div>
            </div>
          </div>
          <RecipientsPanel
            recipients={recipients} recForm={recForm} setRecForm={setRecForm}
            showRecForm={showRecForm} setShowRecForm={setShowRecForm}
            addRecipient={addRecipient} removeRecipient={removeRecipient} />
        </div>
      )}

      {/* ── Send log ── */}
      {sendLog.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">📊 יומן שליחות</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setSendLog([])}>נקה</button>
          </div>
          <div style={{ padding: "0 0 8px" }}>
            {sendLog.map((batch) => (
              <div key={batch.id} style={{ padding: "14px 20px", borderBottom: "1px solid #F5F0E8" }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>
                    {batch.msgPreview}{batch.msgPreview.length >= 60 ? "..." : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`badge ${batch.ok === batch.total ? "badge-green" : "badge-orange"}`}>
                      ✓ {batch.ok}/{batch.total}
                    </span>
                    <span style={{ fontSize: 11, color: "#8A7A6A" }}>{batch.sentAt}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {batch.rows.map((r, i) => (
                    <span key={i} className={`badge ${r.ok ? "badge-green" : "badge-red"}`}
                      style={{ fontSize: 11 }} title={r.ok ? `id: ${r.id}` : r.error}>
                      {r.ok ? "✓" : "✗"} {r.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Template management modal ── */}
      {showTplModal && (
        <TemplateModal
          metaTemplates={metaTemplates}
          showNewTpl={showNewTpl} setShowNewTpl={setShowNewTpl}
          newTpl={newTpl} setNewTpl={setNewTpl}
          registering={registering}
          onRegister={handleRegisterTemplate}
          onClose={() => { setShowTplModal(false); setShowNewTpl(false); setEditTpl(null); }}
          onRefresh={fetchMetaTemplates}
          metaLoading={metaLoading}
          editTpl={editTpl} setEditTpl={setEditTpl}
          deleting={deleting}
          onEdit={handleEditTemplate}
          onDelete={handleDeleteTemplate} />
      )}
    </div>
  );
}

// ── Recipients panel ──────────────────────────────────────────────────────────
function RecipientsPanel({ recipients, recForm, setRecForm, showRecForm, setShowRecForm,
  addRecipient, removeRecipient }) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">👥 נמענים</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowRecForm((v) => !v)}>
          ＋ הוסף
        </button>
      </div>
      <div style={{ padding: "0 0 8px" }}>
        {showRecForm && (
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #F5F0E8",
            background: "rgba(201,169,110,0.04)" }}>
            <div className="form-field" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11 }}>שם האורח</label>
              <input value={recForm.name}
                onChange={(e) => setRecForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="לדוגמה: אליעד" style={{ padding: "8px 10px", fontSize: 13 }} />
            </div>
            <div className="form-field" style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11 }}>טלפון *</label>
              <input value={recForm.phone} dir="ltr"
                onChange={(e) => setRecForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="050-1234567" style={{ padding: "8px 10px", fontSize: 13 }} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setShowRecForm(false); setRecForm({ name: "", phone: "" }); }}>
                ביטול
              </button>
              <button className="btn btn-primary btn-sm" onClick={addRecipient}>＋ הוסף</button>
            </div>
          </div>
        )}
        {recipients.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#8A7A6A", fontSize: 13 }}>
            אין נמענים עדיין
          </div>
        ) : (
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {recipients.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10,
                padding: "10px 16px", borderBottom: "1px solid #F5F0E8" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%",
                  background: "linear-gradient(135deg, #C9A96E, #A8843A)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                  {(r.name[0] ?? "?").toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: "#8A7A6A", direction: "ltr", textAlign: "right" }}>
                    +{r.phone}
                  </div>
                </div>
                <button onClick={() => removeRecipient(r.id)}
                  style={{ background: "none", border: "none", cursor: "pointer",
                    color: "#C0392B", fontSize: 18, padding: "2px 4px", opacity: 0.55 }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Template management modal ─────────────────────────────────────────────────
function TemplateModal({ metaTemplates, showNewTpl, setShowNewTpl, newTpl, setNewTpl,
  registering, onRegister, onClose, onRefresh, metaLoading,
  editTpl, setEditTpl, deleting, onEdit, onDelete }) {

  const STATUS_STYLE = {
    APPROVED:  { bg: "rgba(26,122,74,0.1)",  color: "#1A7A4A", label: "✅ מאושרת" },
    PENDING:   { bg: "rgba(184,134,11,0.1)", color: "#B8860B", label: "⏳ בבדיקה" },
    IN_APPEAL: { bg: "rgba(184,134,11,0.1)", color: "#B8860B", label: "⏳ בבדיקה" },
    REJECTED:  { bg: "rgba(192,57,43,0.1)",  color: "#C0392B", label: "❌ נדחתה"  },
  };

  const grouped = {};
  for (const t of metaTemplates) {
    const s = t.status ?? "UNKNOWN";
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(t);
  }
  const ORDER = ["APPROVED", "PENDING", "IN_APPEAL", "REJECTED"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 640,
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #F0EBE0",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#1A1A1A" }}>
            ניהול תבניות WhatsApp
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={metaLoading}>
              🔄 רענן
            </button>
            <button className="btn btn-primary btn-sm"
              onClick={() => { setShowNewTpl((v) => !v); setEditTpl(null); }}>
              ＋ תבנית חדשה
            </button>
            <button onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer",
                fontSize: 22, color: "#8A7A6A", padding: "0 4px", lineHeight: 1 }}>
              ✕
            </button>
          </div>
        </div>

        {/* New template form */}
        {showNewTpl && (
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #F0EBE0",
            background: "rgba(201,169,110,0.05)", flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#A8843A", marginBottom: 14 }}>
              יצירת תבנית חדשה
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10, marginBottom: 10 }}>
              <div className="form-field" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>שם תבנית (באנגלית, ללא רווחים)</label>
                <input value={newTpl.name} dir="ltr"
                  onChange={(e) => setNewTpl((f) => ({ ...f, name: e.target.value }))}
                  placeholder="dream_my_template"
                  style={{ padding: "8px 10px", fontSize: 13, direction: "ltr" }} />
                {newTpl.name && (
                  <div style={{ fontSize: 10, color: "#8A7A6A", marginTop: 3 }}>
                    → יישמר כ: {toSnakeCase(newTpl.name)}
                  </div>
                )}
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>קטגוריה</label>
                <select value={newTpl.category}
                  onChange={(e) => setNewTpl((f) => ({ ...f, category: e.target.value }))}
                  style={{ padding: "8px 10px", fontSize: 13, borderRadius: 8,
                    border: "1.5px solid #E0D5C5", width: "100%", direction: "rtl" }}>
                  <option value="MARKETING">📣 שיווק</option>
                  <option value="UTILITY">🛎️ שירות</option>
                </select>
              </div>
            </div>
            <div className="form-field" style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11 }}>תוכן ההודעה</label>
              <textarea rows={4} value={newTpl.body} dir="rtl"
                onChange={(e) => setNewTpl((f) => ({ ...f, body: e.target.value }))}
                placeholder={"היי {{1}}! ...\n\nטיפ: {{1}} = שם האורח (אוטומטי)\n     {{2}} = ערך נוסף כמו תאריך / קישור"}
                style={{ resize: "vertical", fontSize: 13 }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setShowNewTpl(false); setNewTpl({ name: "", body: "", category: "MARKETING" }); }}>
                ביטול
              </button>
              <button className="btn btn-primary btn-sm" onClick={onRegister}
                disabled={registering || !newTpl.name.trim() || !newTpl.body.trim()}>
                {registering ? "שולח..." : "📤 שלח לאישור Meta"}
              </button>
            </div>
          </div>
        )}

        {/* Edit template form */}
        {editTpl && !showNewTpl && (
          <div style={{ padding: "18px 24px", borderBottom: "1px solid #F0EBE0",
            background: "rgba(192,57,43,0.03)", flexShrink: 0 }}>
            <div style={{ background: "rgba(184,134,11,0.1)", border: "1px solid rgba(184,134,11,0.3)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#8B6914",
              display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span>⚠️</span>
              <span>עריכה תמחק את <strong>{editTpl.originalName}</strong> ותשלח גרסה חדשה לאישור מטא — עד 48 שעות בבדיקה</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#C0392B", marginBottom: 14 }}>
              עריכת תבנית: {editTpl.originalName}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10, marginBottom: 10 }}>
              <div className="form-field" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>שם תבנית</label>
                <input value={editTpl.name} dir="ltr"
                  onChange={(e) => setEditTpl((p) => ({ ...p, name: e.target.value }))}
                  style={{ padding: "8px 10px", fontSize: 13, direction: "ltr" }} />
                {toSnakeCase(editTpl.name) !== editTpl.originalName && (
                  <div style={{ fontSize: 10, color: "#C0392B", marginTop: 3 }}>
                    שם חדש: {toSnakeCase(editTpl.name)}
                  </div>
                )}
              </div>
              <div className="form-field" style={{ margin: 0 }}>
                <label style={{ fontSize: 11 }}>קטגוריה</label>
                <select value={editTpl.category}
                  onChange={(e) => setEditTpl((p) => ({ ...p, category: e.target.value }))}
                  style={{ padding: "8px 10px", fontSize: 13, borderRadius: 8,
                    border: "1.5px solid #E0D5C5", width: "100%", direction: "rtl" }}>
                  <option value="MARKETING">📣 שיווק</option>
                  <option value="UTILITY">🛎️ שירות</option>
                </select>
              </div>
            </div>
            <div className="form-field" style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11 }}>תוכן ההודעה</label>
              <textarea rows={4} value={editTpl.body} dir="rtl"
                onChange={(e) => setEditTpl((p) => ({ ...p, body: e.target.value }))}
                style={{ resize: "vertical", fontSize: 13 }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditTpl(null)}>
                ביטול
              </button>
              <button className="btn btn-primary btn-sm" onClick={onEdit}
                disabled={deleting || !editTpl.name.trim() || !editTpl.body.trim()}
                style={{ background: "#C0392B", borderColor: "#C0392B" }}>
                {deleting ? "מעבד..." : "🔄 מחק ושלח לאישור Meta"}
              </button>
            </div>
          </div>
        )}

        {/* Template list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 0 12px" }}>
          {metaLoading ? (
            <div style={{ textAlign: "center", color: "#8A7A6A", padding: 32 }}>טוען...</div>
          ) : metaTemplates.length === 0 ? (
            <div style={{ textAlign: "center", color: "#8A7A6A", padding: 32 }}>אין תבניות</div>
          ) : (
            ORDER.map((status) => {
              const list = grouped[status];
              if (!list?.length) return null;
              const st = STATUS_STYLE[status] ?? { bg: "#f5f5f5", color: "#666", label: status };
              return (
                <div key={status}>
                  <div style={{ padding: "10px 24px 6px", fontSize: 11, fontWeight: 700,
                    color: st.color, letterSpacing: 0.4, textTransform: "uppercase" }}>
                    {st.label} ({list.length})
                  </div>
                  {list.map((tpl) => {
                    const body = getBodyText(tpl);
                    const cat  = CATEGORY_LABELS[tpl.category] ?? { icon: "📄", label: tpl.category };
                    return (
                      <div key={tpl.name} style={{ padding: "12px 24px",
                        borderBottom: "1px solid #F5F0E8" }}>
                        <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: "#1A1A1A",
                            direction: "ltr" }}>
                            {tpl.name}
                          </span>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20,
                              background: st.bg, color: st.color, fontWeight: 700 }}>
                              {st.label}
                            </span>
                            <span className="badge" style={{ fontSize: 10 }}>
                              {cat.icon} {cat.label}
                            </span>
                            <button className="btn btn-ghost btn-sm"
                              style={{ fontSize: 10, padding: "2px 8px" }}
                              onClick={() => {
                                setEditTpl({ originalName: tpl.name, name: tpl.name,
                                  body: getBodyText(tpl), category: tpl.category ?? "MARKETING" });
                                setShowNewTpl(false);
                              }}>
                              ✏️
                            </button>
                            <button className="btn btn-ghost btn-sm"
                              style={{ fontSize: 10, padding: "2px 8px", color: "#C0392B" }}
                              onClick={() => onDelete(tpl.name)}>
                              🗑️
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: "#8A7A6A", lineHeight: 1.5,
                          display: "-webkit-box", WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {body}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
