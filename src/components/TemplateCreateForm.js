// src/components/TemplateCreateForm.js
// Extracted from BroadcastDashboard.js's inline "✨ צור תבנית חדשה" form
// (now reused by both BroadcastDashboard.js's Template Manager tab and the
// Automation Control Center's "🔁 המר לתבנית Meta" action) — same exact
// create-wa-template call, plus a new interactive-buttons sub-editor that
// BroadcastDashboard's original form never had (create-wa-template now
// accepts an optional `buttons` array — see that function's header comment).
//
// initialValues lets a caller pre-fill the form (e.g. a session message's
// body + buttons being converted to a Meta template draft). Pass a fresh
// `key` prop from the parent when initialValues changes so this component
// remounts with the new defaults instead of silently keeping stale state.
import { useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const BUTTON_TYPE_LABEL = { QUICK_REPLY: "תגובה מהירה", URL: "קישור", PHONE_NUMBER: "טלפון" };

export default function TemplateCreateForm({ initialValues, onCreated, onCancel, showToast }) {
  const [newTmpl, setNewTmpl] = useState({
    name: initialValues?.name ?? "",
    language: initialValues?.language ?? "he",
    category: initialValues?.category ?? "MARKETING",
    body: initialValues?.body ?? "",
    header: initialValues?.header ?? "",
    footer: initialValues?.footer ?? "",
    buttons: initialValues?.buttons ?? [],
  });
  const [creating, setCreating] = useState(false);

  const _showToast = showToast ?? (() => {});

  const addButton = () => {
    if (newTmpl.buttons.length >= 3) return;
    setNewTmpl((p) => ({ ...p, buttons: [...p.buttons, { type: "QUICK_REPLY", text: "", url: "" }] }));
  };
  const updateButton = (idx, patch) => {
    setNewTmpl((p) => ({
      ...p,
      buttons: p.buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    }));
  };
  const removeButton = (idx) => {
    setNewTmpl((p) => ({ ...p, buttons: p.buttons.filter((_, i) => i !== idx) }));
  };

  const handleCreate = async () => {
    if (!newTmpl.name.trim()) return _showToast("err", "נא להזין שם תבנית");
    if (!newTmpl.body.trim()) return _showToast("err", "נא להזין גוף הודעה");
    if (!isSupabaseConfigured || !supabase) return;

    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-wa-template", {
        body: {
          name:     newTmpl.name.trim().toLowerCase().replace(/\s+/g, "_"),
          language: newTmpl.language,
          category: newTmpl.category,
          body:     newTmpl.body.trim(),
          header:   newTmpl.header.trim() || undefined,
          footer:   newTmpl.footer.trim() || undefined,
          buttons:  newTmpl.buttons.length > 0
            ? newTmpl.buttons.filter((b) => b.text?.trim()).map((b) => ({
                type: b.type, text: b.text.trim(), url: b.url?.trim() || undefined,
              }))
            : undefined,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      _showToast("ok", `✅ תבנית "${newTmpl.name}" נשלחה לאישור Meta! בדרך כלל מאושרת תוך 1-3 שעות.`);
      onCreated?.(data.template);
    } catch (err) {
      _showToast("err", "שגיאה ביצירת תבנית: " + (err?.message ?? err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20, border: "2px solid var(--gold)" }}>
      <div className="card-header">
        <div className="card-title">✨ תבנית חדשה — שליחה לאישור Meta</div>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

        <div style={{ fontSize: 12, padding: "10px 14px", borderRadius: 8, background: "#EFF6FF", border: "1px solid #93C5FD", color: "#1E40AF", lineHeight: 1.6 }}>
          💡 <strong>Meta דורשת:</strong> שם תבנית — אותיות לועזיות קטנות + קו תחתון בלבד (לדוג׳ <code>dream_welcome</code>).
          משתנים בגוף ההודעה — <code style={{ background: "rgba(0,0,0,0.07)", padding: "1px 4px", borderRadius: 3 }}>{"{{1}}"}</code> <code style={{ background: "rgba(0,0,0,0.07)", padding: "1px 4px", borderRadius: 3 }}>{"{{2}}"}</code> וכן הלאה.
          לאחר שליחה, Meta מאשרת תוך כ-1–3 שעות.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>שם תבנית <span style={{ color: "#C0392B" }}>*</span></label>
            <input
              type="text"
              placeholder="dream_welcome_guest"
              value={newTmpl.name}
              onChange={(e) => setNewTmpl((p) => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
              style={{ direction: "ltr" }}
            />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>שפה</label>
            <select value={newTmpl.language} onChange={(e) => setNewTmpl((p) => ({ ...p, language: e.target.value }))}>
              <option value="he">עברית (he)</option>
              <option value="en_US">English (en_US)</option>
              <option value="ar">عربي (ar)</option>
              <option value="ru">Русский (ru)</option>
            </select>
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>קטגוריה</label>
            <select value={newTmpl.category} onChange={(e) => setNewTmpl((p) => ({ ...p, category: e.target.value }))}>
              <option value="MARKETING">📣 MARKETING (שיווק)</option>
              <option value="UTILITY">🔔 UTILITY (שירות)</option>
              <option value="AUTHENTICATION">🔐 AUTHENTICATION (אימות)</option>
            </select>
          </div>
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>כותרת (אופציונלי) — מוצגת מעל גוף ההודעה</label>
          <input
            type="text"
            placeholder="Dream Island 🌴"
            value={newTmpl.header}
            onChange={(e) => setNewTmpl((p) => ({ ...p, header: e.target.value }))}
          />
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>גוף ההודעה <span style={{ color: "#C0392B" }}>*</span></label>
          <textarea
            rows={4}
            placeholder={"היי {{1}}! ברוכים הבאים ל-Dream Island 🌴\nהחדר שלך מוכן ומחכה לך מ-15:00 🏨"}
            value={newTmpl.body}
            onChange={(e) => setNewTmpl((p) => ({ ...p, body: e.target.value }))}
            style={{ fontFamily: "Heebo, sans-serif", fontSize: 14, lineHeight: 1.6, resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            {newTmpl.body.length} תווים · {(newTmpl.body.match(/\{\{\d+\}\}/g) ?? []).length} משתנים
          </div>
        </div>

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>כותרת תחתונה (אופציונלי) — טקסט קטן מתחת להודעה</label>
          <input
            type="text"
            placeholder="Dream Island Resort · לא להשיב להודעה זו"
            value={newTmpl.footer}
            onChange={(e) => setNewTmpl((p) => ({ ...p, footer: e.target.value }))}
          />
        </div>

        {/* ── Interactive buttons (new — req: button builder + convert-to-template) ── */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ margin: 0 }}>כפתורים (אופציונלי, עד 3)</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addButton} disabled={newTmpl.buttons.length >= 3}>
              ➕ הוסף כפתור
            </button>
          </div>
          {newTmpl.buttons.map((b, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <select
                value={b.type}
                onChange={(e) => updateButton(idx, { type: e.target.value })}
                style={{ width: 130, flexShrink: 0 }}
              >
                <option value="QUICK_REPLY">תגובה מהירה</option>
                <option value="URL">קישור</option>
              </select>
              <input
                type="text"
                placeholder="טקסט הכפתור"
                value={b.text}
                onChange={(e) => updateButton(idx, { text: e.target.value })}
                style={{ flex: 1 }}
              />
              {b.type === "URL" && (
                <input
                  type="text"
                  placeholder="https://..."
                  value={b.url ?? ""}
                  onChange={(e) => updateButton(idx, { url: e.target.value })}
                  style={{ flex: 1, direction: "ltr" }}
                />
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeButton(idx)} style={{ color: "#C0392B" }}>
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Live preview */}
        {(newTmpl.body.trim() || newTmpl.buttons.length > 0) && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, letterSpacing: 0.5 }}>
              תצוגה מקדימה:
            </div>
            <div style={{
              background: "#E9FBE5", border: "1px solid #A8E6A3", borderRadius: "0 14px 14px 14px",
              padding: "12px 14px", maxWidth: 340, fontSize: 13, lineHeight: 1.7,
              boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            }}>
              {newTmpl.header && <div style={{ fontWeight: 700, marginBottom: 6 }}>{newTmpl.header}</div>}
              <div style={{ whiteSpace: "pre-wrap" }}>{newTmpl.body}</div>
              {newTmpl.footer && <div style={{ fontSize: 11, color: "#777", marginTop: 6 }}>{newTmpl.footer}</div>}
              {newTmpl.buttons.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid #C8E6C2", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {newTmpl.buttons.map((b, idx) => (
                    <div key={idx} style={{ textAlign: "center", color: "#2563EB", fontWeight: 600, fontSize: 12 }}>
                      {b.type === "URL" ? "🔗 " : "↩️ "}{b.text || `(${BUTTON_TYPE_LABEL[b.type]})`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={creating || !newTmpl.name.trim() || !newTmpl.body.trim()}
          >
            {creating ? "⏳ שולח ל-Meta..." : "📤 שלח לאישור Meta"}
          </button>
        </div>
      </div>
    </div>
  );
}
