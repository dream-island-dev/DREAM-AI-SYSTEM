// src/components/TemplateManagerPanel.js
// Extracted from BroadcastDashboard.js's inline renderTemplateManager() so
// it can be reused by the Automation Control Center's "📋 תבניות Meta" tab
// without duplicating the Meta-sync / template-list logic. Behavior is
// unchanged from the original — same get-wa-templates/sync-wa-templates calls.
//
// onSelectForSend(template) — optional; BroadcastDashboard passes this to
// jump back to its broadcast-composer tab with the template pre-selected.
// The Automation Control Center omits it (no broadcast tab to jump to).
//
// initialCreateDraft — optional; when set (and changes), opens the create
// form pre-filled (used by the Timeline tab's "🔁 המר לתבנית Meta" action).
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import TemplateCreateForm from "./TemplateCreateForm";

const STATUS_META = {
  APPROVED: { bg: "#E8F5EF", color: "#1A7A4A", border: "#1A7A4A", label: "✅ מאושרת" },
  PENDING:  { bg: "#FFF8E1", color: "#B5600A", border: "#F59E0B", label: "⏳ ממתינה" },
  REJECTED: { bg: "#FFF0EE", color: "#C0392B", border: "#C0392B", label: "❌ נדחתה" },
  PAUSED:   { bg: "#F0F0F0", color: "#555",    border: "#aaa",    label: "⏸ מושהית" },
};

export default function TemplateManagerPanel({ onSelectForSend, initialCreateDraft, onDraftConsumed, showToast }) {
  const [allMetaTemplates, setAllMetaTemplates] = useState([]);
  const [loadingAllTmpls, setLoadingAllTmpls]   = useState(false);
  const [showCreateForm, setShowCreateForm]     = useState(false);
  const [syncingToDb, setSyncingToDb]           = useState(false);
  const [toast, setToast]                       = useState(null);

  const internalShowToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }, []);
  const _showToast = showToast ?? internalShowToast;

  const fetchAllMetaTemplates = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoadingAllTmpls(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-wa-templates", { body: { all: true } });
      if (error) throw new Error(error.message);
      setAllMetaTemplates(data?.templates ?? []);
    } catch (err) {
      _showToast("err", "שגיאה בטעינת תבניות: " + (err?.message ?? err));
    } finally {
      setLoadingAllTmpls(false);
    }
  }, [_showToast]);

  useEffect(() => { fetchAllMetaTemplates(); }, [fetchAllMetaTemplates]);

  useEffect(() => {
    if (initialCreateDraft) setShowCreateForm(true);
  }, [initialCreateDraft]);

  const handleFullSync = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setSyncingToDb(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-wa-templates");
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "sync failed");
      _showToast("ok", `✅ סונכרן ${data.synced} תבניות מ-Meta לבסיס הנתונים`);
      await fetchAllMetaTemplates();
    } catch (err) {
      _showToast("err", "שגיאה בסנכרון: " + (err?.message ?? err));
    } finally {
      setSyncingToDb(false);
    }
  }, [_showToast, fetchAllMetaTemplates]);

  return (
    <div>
      {!showToast && toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>📋 ניהול תבניות WhatsApp</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            סנכרון עם Meta Business Manager — תבניות מאושרות בלבד ניתנות לשליחה
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleFullSync} disabled={loadingAllTmpls || syncingToDb}>
            {syncingToDb ? "⏳ מסנכרן..." : "🔄 סנכרן מ-Meta"}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setShowCreateForm((v) => !v); if (showCreateForm) onDraftConsumed?.(); }}
          >
            {showCreateForm ? "✕ ביטול" : "✨ צור תבנית חדשה"}
          </button>
        </div>
      </div>

      {showCreateForm && (
        <TemplateCreateForm
          key={initialCreateDraft ? JSON.stringify(initialCreateDraft) : "blank"}
          initialValues={initialCreateDraft}
          showToast={_showToast}
          onCancel={() => { setShowCreateForm(false); onDraftConsumed?.(); }}
          onCreated={() => {
            setShowCreateForm(false);
            onDraftConsumed?.();
            setTimeout(() => fetchAllMetaTemplates(), 1500);
          }}
        />
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">תבניות ב-Meta ({allMetaTemplates.length})</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {allMetaTemplates.filter((t) => t.status === "APPROVED").length} מאושרות ·{" "}
            {allMetaTemplates.filter((t) => t.status === "PENDING").length} ממתינות ·{" "}
            {allMetaTemplates.filter((t) => t.status === "REJECTED").length} נדחו
          </div>
        </div>

        {loadingAllTmpls ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>⏳ טוען תבניות מ-Meta...</div>
        ) : allMetaTemplates.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div>לא נמצאו תבניות. לחץ "סנכרן מ-Meta" או צור תבנית חדשה.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {allMetaTemplates.map((tmpl, idx) => {
              const st = STATUS_META[tmpl.status] ?? STATUS_META.PENDING;
              return (
                <div key={tmpl.id ?? tmpl.name} style={{
                  padding: "16px 20px",
                  borderBottom: idx < allMetaTemplates.length - 1 ? "1px solid var(--border)" : "none",
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <code style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: "var(--black)", direction: "ltr" }}>
                        {tmpl.name}
                      </code>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{tmpl.language} · {tmpl.category}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                        background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                      }}>{st.label}</span>
                      {tmpl.status === "APPROVED" && onSelectForSend && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, color: "var(--gold-dark)", border: "1px solid var(--gold)" }}
                          onClick={() => onSelectForSend(tmpl)}
                        >
                          📣 שלח עכשיו ←
                        </button>
                      )}
                    </div>
                  </div>
                  {tmpl.bodyText && (
                    <div style={{
                      fontSize: 12, color: "#444", background: "var(--ivory)",
                      borderRadius: 8, padding: "8px 12px", lineHeight: 1.6, maxHeight: 80, overflowY: "auto",
                      direction: tmpl.language === "he" || tmpl.language === "ar" ? "rtl" : "ltr",
                      textAlign: tmpl.language === "he" || tmpl.language === "ar" ? "right" : "left",
                    }}>
                      {tmpl.bodyText}
                    </div>
                  )}
                  {tmpl.buttons?.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {tmpl.buttons.map((b, i) => (
                        <span key={i} style={{
                          fontSize: 11, padding: "2px 9px", borderRadius: 14,
                          background: "#EFF6FF", color: "#1E40AF", border: "1px solid #93C5FD",
                        }}>
                          {b.type === "URL" ? "🔗" : "↩️"} {b.text}
                        </span>
                      ))}
                    </div>
                  )}
                  {tmpl.rejectedReason && tmpl.rejectedReason !== "NONE" && (
                    <div style={{ fontSize: 11, color: "#C0392B", background: "#FFF0EE", borderRadius: 6, padding: "6px 10px" }}>
                      ❌ סיבת דחייה: {tmpl.rejectedReason}
                    </div>
                  )}
                  {tmpl.varCount > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {tmpl.varCount} משתנ{tmpl.varCount === 1 ? "ה" : "ים"} ({Array.from({ length: tmpl.varCount }, (_, i) => `{{${i + 1}}}`).join(", ")})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
