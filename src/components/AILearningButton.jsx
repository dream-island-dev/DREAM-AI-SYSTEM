// src/components/AILearningButton.jsx
// Unified AI Learning Mechanism — Phase 1 capture UI.
// Usage (future integration):
//   <AILearningButton module="chat" />
//   <AILearningButton module="routing" />

import { useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const MODULE_LABELS = {
  chat: "צ'אט",
  routing: "ניתוב",
};

function moduleLabel(module) {
  return MODULE_LABELS[module] ?? module;
}

export default function AILearningButton({ module, iconOnly = false, toolbarStyle = null, className = "" }) {
  const [open, setOpen] = useState(false);
  const [ruleText, setRuleText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const canOpen = Boolean(module?.trim()) && isSupabaseConfigured && supabase;

  const handleOpen = () => {
    if (!canOpen) return;
    setRuleText("");
    setError(null);
    setOpen(true);
  };

  const handleClose = () => {
    if (saving) return;
    setOpen(false);
    setError(null);
  };

  const handleSave = async () => {
    const trimmed = ruleText.trim();
    if (!trimmed) {
      setError("נא להזין טקסט כלל לפחות");
      return;
    }
    if (!supabase) {
      setError("Supabase לא מוגדר — לא ניתן לשמור");
      return;
    }

    setSaving(true);
    setError(null);

    const { error: dbError } = await supabase.from("xos_ai_rules").insert({
      module: module.trim(),
      rule_text: trimmed,
    });

    setSaving(false);

    if (dbError) {
      setError(dbError.message || "שמירה נכשלה");
      return;
    }

    setOpen(false);
    setRuleText("");
    showToast("ok", "✓ הכלל נשמר — המערכת תלמד ממנו");
  };

  const disabledReason = !module?.trim()
    ? "חסר מזהה מודול"
    : !isSupabaseConfigured
      ? "Supabase לא מוגדר"
      : null;

  return (
    <>
      <button
        type="button"
        className={`btn btn-secondary btn-sm${className ? ` ${className}` : ""}`}
        onClick={handleOpen}
        disabled={!canOpen}
        title={disabledReason ?? `למד כלל חדש למודול ${moduleLabel(module)}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: iconOnly ? 0 : 6,
          fontSize: iconOnly ? 18 : 13,
          fontWeight: 600,
          opacity: canOpen ? 1 : 0.55,
          cursor: canOpen ? "pointer" : "not-allowed",
          ...(iconOnly ? {
            width: "var(--hit-target-staff, 44px)",
            height: "var(--hit-target-staff, 44px)",
            padding: 0,
            borderRadius: "50%",
            flexShrink: 0,
          } : {}),
          ...toolbarStyle,
        }}
      >
        <span aria-hidden="true">🧠</span>
        {!iconOnly && " למד את המערכת"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-learning-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            direction: "rtl",
          }}
          onClick={handleClose}
        >
          <div
            style={{
              background: "var(--card-bg)",
              borderRadius: 16,
              padding: "28px 32px",
              maxWidth: 520,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              id="ai-learning-title"
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "var(--black)",
                marginBottom: 6,
                fontFamily: "Playfair Display, serif",
              }}
            >
              🧠 למד את המערכת
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>
              מודול: <strong style={{ color: "var(--gold-dark)" }}>{moduleLabel(module)}</strong>
              {" "}({module})
            </div>

            <label
              htmlFor="ai-learning-rule"
              style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--black)" }}
            >
              מה המערכת צריכה לזכור?
            </label>
            <textarea
              id="ai-learning-rule"
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              placeholder='לדוגמה: "כשאורח מבקש שינוי תאריך — תמיד העבר לצוות הסוויטות"'
              rows={5}
              disabled={saving}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1.5px solid var(--border)",
                fontSize: 14,
                fontFamily: "Heebo, sans-serif",
                resize: "vertical",
                lineHeight: 1.6,
                background: "var(--ivory)",
                color: "var(--black)",
              }}
            />

            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#fde8e8",
                  color: "#9b1c1c",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                ⚠ {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClose}
                disabled={saving}
                style={{ flex: 1 }}
              >
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !ruleText.trim()}
                style={{ flex: 2 }}
              >
                {saving ? "שומר…" : "שמור כלל"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10001,
            padding: "12px 22px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "Heebo, sans-serif",
            background: toast.type === "ok" ? "#e8f5e9" : "#fde8e8",
            color: toast.type === "ok" ? "#2e7d32" : "#9b1c1c",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            direction: "rtl",
          }}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}
