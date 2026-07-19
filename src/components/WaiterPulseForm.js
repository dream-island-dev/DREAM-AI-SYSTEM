// Shared waiter service pulse form — public portal + staff preview.

import { useState } from "react";
import {
  DEFAULT_WAITER_PULSE_UI,
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
} from "../utils/waiterPulseUi";

const PORTAL = {
  text: "#F8FAFC",
  muted: "rgba(248,250,252,0.55)",
  border: "rgba(255,255,255,0.14)",
  gold: "#D4AF37",
  inputBg: "rgba(255,255,255,0.04)",
};

const STAFF = {
  text: "var(--black)",
  muted: "var(--text-muted)",
  border: "var(--border)",
  gold: "var(--gold-dark)",
  inputBg: "var(--ivory)",
};

function ChoiceChip({ label, selected, onClick, colors, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: `2px solid ${selected ? colors.gold : colors.border}`,
        background: selected
          ? (colors === PORTAL ? "rgba(212,175,55,0.16)" : "rgba(212,175,55,0.1)")
          : "transparent",
        color: selected ? colors.gold : colors.text,
        fontWeight: selected ? 700 : 600,
        fontSize: 13,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        textAlign: "right",
        lineHeight: 1.4,
      }}
    >
      {label}
    </button>
  );
}

function QuestionBlock({ question, answers, setAnswers, colors, readOnly }) {
  const val = answers[question.key];
  const otherKey = `${question.key}_other`;
  const otherVal = answers[otherKey] ?? "";

  if (question.type === "text") {
    return (
      <label style={{ display: "block", marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 8, textAlign: "right" }}>
          {question.label}
          {question.required && <span style={{ color: "#E74C3C" }}> *</span>}
        </div>
        <textarea
          value={val ?? ""}
          disabled={readOnly}
          onChange={(e) => setAnswers((prev) => ({ ...prev, [question.key]: e.target.value }))}
          placeholder={question.placeholder || ""}
          rows={question.min_length >= 30 ? 4 : 3}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 14px",
            borderRadius: 12,
            border: `1px solid ${colors.border}`,
            background: colors.inputBg,
            color: colors.text,
            fontFamily: "inherit",
            fontSize: 14,
            lineHeight: 1.5,
            resize: "vertical",
            textAlign: "right",
          }}
        />
      </label>
    );
  }

  if (question.type === "single_choice") {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 10, textAlign: "right" }}>
          {question.label}
          {question.required && <span style={{ color: "#E74C3C" }}> *</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(question.options ?? []).map((opt) => (
            <ChoiceChip
              key={opt.id}
              label={opt.label}
              selected={val === opt.id}
              disabled={readOnly}
              colors={colors}
              onClick={() => setAnswers((prev) => ({ ...prev, [question.key]: opt.id }))}
            />
          ))}
          {question.allow_other && (
            <>
              <ChoiceChip
                label={question.other_label || "אחר"}
                selected={val === "__other__"}
                disabled={readOnly}
                colors={colors}
                onClick={() => setAnswers((prev) => ({ ...prev, [question.key]: "__other__" }))}
              />
              {val === "__other__" && (
                <input
                  type="text"
                  value={otherVal}
                  disabled={readOnly}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [otherKey]: e.target.value }))}
                  placeholder="פרטו…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    background: colors.inputBg,
                    color: colors.text,
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (question.type === "multi_choice") {
    const picks = Array.isArray(val) ? val : [];
    const toggle = (id) => {
      setAnswers((prev) => {
        const cur = Array.isArray(prev[question.key]) ? prev[question.key] : [];
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        return { ...prev, [question.key]: next };
      });
    };
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 10, textAlign: "right" }}>
          {question.label}
          {question.required && <span style={{ color: "#E74C3C" }}> *</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(question.options ?? []).map((opt) => (
            <ChoiceChip
              key={opt.id}
              label={opt.label}
              selected={picks.includes(opt.id)}
              disabled={readOnly}
              colors={colors}
              onClick={() => toggle(opt.id)}
            />
          ))}
          {question.allow_other && (
            <>
              <ChoiceChip
                label={question.other_label || "אחר"}
                selected={picks.includes("__other__")}
                disabled={readOnly}
                colors={colors}
                onClick={() => toggle("__other__")}
              />
              {picks.includes("__other__") && (
                <input
                  type="text"
                  value={otherVal}
                  disabled={readOnly}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [otherKey]: e.target.value }))}
                  placeholder="פרטו…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    background: colors.inputBg,
                    color: colors.text,
                    fontFamily: "inherit",
                    textAlign: "right",
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export default function WaiterPulseForm({
  ui,
  variant = "portal",
  previewOnly = false,
  onSubmit,
  submitting = false,
}) {
  const colors = variant === "staff" ? STAFF : PORTAL;
  const resolved = normalizeWaiterPulseUi(ui ?? DEFAULT_WAITER_PULSE_UI);
  const [answers, setAnswers] = useState({});
  const [localErr, setLocalErr] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (previewOnly) return;
    const err = validateWaiterPulseAnswers(resolved, answers);
    if (err) {
      setLocalErr(err);
      return;
    }
    setLocalErr(null);
    onSubmit?.(answers);
  };

  return (
    <form onSubmit={handleSubmit} style={{ direction: "rtl", fontFamily: "Heebo, sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: colors.gold, margin: "0 0 10px", textAlign: "right" }}>
        {resolved.panel_title}
      </h1>
      {resolved.intro_text && (
        <p style={{ fontSize: 14, color: colors.muted, lineHeight: 1.65, margin: "0 0 22px", textAlign: "right" }}>
          {resolved.intro_text}
        </p>
      )}

      {resolved.questions.map((q) => (
        <QuestionBlock
          key={q.key}
          question={q}
          answers={answers}
          setAnswers={setAnswers}
          colors={colors}
          readOnly={previewOnly}
        />
      ))}

      {localErr && (
        <div style={{
          marginBottom: 14, padding: "10px 12px", borderRadius: 10,
          background: "rgba(231,76,60,0.12)", border: "1px solid rgba(231,76,60,0.35)",
          color: "#E74C3C", fontSize: 13, fontWeight: 600,
        }}>
          {localErr}
        </div>
      )}

      <button
        type="submit"
        disabled={previewOnly || submitting}
        title={previewOnly ? "תצוגה מקדימה בלבד" : undefined}
        style={{
          width: "100%",
          padding: "14px 16px",
          borderRadius: 14,
          border: "none",
          background: previewOnly ? colors.border : `linear-gradient(135deg, ${colors.gold}, #B8960C)`,
          color: previewOnly ? colors.muted : "#0F0F0F",
          fontWeight: 800,
          fontSize: 15,
          cursor: previewOnly || submitting ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          opacity: submitting ? 0.75 : 1,
        }}
      >
        {submitting ? "שולח…" : resolved.submit_label}
      </button>
    </form>
  );
}
