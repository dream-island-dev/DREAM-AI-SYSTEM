// Shared Guest Experience Survey form — used by GuestPortal (live submit) and
// GuestFeedbackTabs staff preview (interactive, no submit / local-only).
import { useState } from "react";
import {
  DEFAULT_GUEST_SURVEY_UI,
  SURVEY_SCORE_MAX,
  SURVEY_SCORE_OPTIONS,
  normalizeGuestSurveyUi,
} from "../utils/guestSurveyUi";

const PORTAL = {
  text: "#F8FAFC",
  muted: "rgba(248,250,252,0.55)",
  border: "rgba(255,255,255,0.14)",
  gold: "#D4AF37",
  inputBg: "rgba(255,255,255,0.03)",
};

const STAFF = {
  text: "var(--black)",
  muted: "var(--text-muted)",
  border: "var(--border)",
  gold: "var(--gold-dark)",
  inputBg: "var(--ivory)",
};

function EmojiRatingRow({ label, value, options, onChange, colors, readOnly }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, color: colors.text, marginBottom: 10, textAlign: "right", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{
        display: "flex", gap: 8, justifyContent: "stretch",
        flexDirection: "row-reverse", flexWrap: "wrap",
      }}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={readOnly}
              onClick={() => !readOnly && onChange(opt.value)}
              style={{
                flex: "1 1 88px",
                minWidth: 88,
                maxWidth: 140,
                padding: "12px 8px",
                borderRadius: 14,
                border: `2px solid ${selected ? colors.gold : colors.border}`,
                background: selected
                  ? (colors === PORTAL ? "rgba(212,175,55,0.18)" : "rgba(212,175,55,0.12)")
                  : "transparent",
                cursor: readOnly ? "default" : "pointer",
                fontFamily: "inherit",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">{opt.emoji}</span>
              <span style={{
                fontSize: 11.5,
                fontWeight: selected ? 700 : 600,
                color: selected ? colors.gold : colors.muted,
                lineHeight: 1.3,
                textAlign: "center",
              }}>
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} [props.ui] — guest survey UI config (normalized or raw)
 * @param {'portal'|'staff'} [props.variant]
 * @param {boolean} [props.previewOnly] — clickable ratings, submit disabled with title
 * @param {function} [props.onSubmit]
 * @param {boolean} [props.submitting]
 * @param {string} [props.panelTitleOverride]
 */
export default function GuestSurveyForm({
  ui,
  variant = "portal",
  previewOnly = false,
  onSubmit,
  submitting = false,
  panelTitleOverride,
}) {
  const colors = variant === "staff" ? STAFF : PORTAL;
  const resolved = normalizeGuestSurveyUi(ui ?? DEFAULT_GUEST_SURVEY_UI);
  const initialScores = Object.fromEntries(resolved.categories.map((c) => [c.key, 0]));
  const [scores, setScores] = useState(initialScores);
  const [overall, setOverall] = useState(0);
  const [freeText, setFreeText] = useState("");

  const allAnswered = resolved.categories.every((c) => scores[c.key] > 0) && overall > 0;
  const canSubmit = !previewOnly && allAnswered && !submitting && typeof onSubmit === "function";

  async function handleSubmit() {
    if (!canSubmit) return;
    await onSubmit({
      ...scores,
      overall_experience: overall,
      free_text: freeText,
    });
  }

  const title = panelTitleOverride === undefined ? resolved.panel_title : panelTitleOverride;
  const scoreOptions = SURVEY_SCORE_OPTIONS;

  return (
    <div>
      {title ? (
        <div style={{
          fontSize: variant === "staff" ? 16 : 15,
          fontWeight: 800,
          color: colors.text,
          marginBottom: 14,
          textAlign: "right",
        }}>
          {title}
        </div>
      ) : null}

      {previewOnly && (
        <div style={{
          marginBottom: 14, padding: "10px 12px", borderRadius: 10,
          background: variant === "staff" ? "var(--ivory)" : "rgba(212,175,55,0.12)",
          border: `1px solid ${colors.border}`,
          fontSize: 12.5, color: colors.muted, lineHeight: 1.6, textAlign: "right",
        }}>
          תצוגה מקדימה בלבד — דירוגים לא נשמרים ולא נשלחים לאורח.
        </div>
      )}

      <div style={{ paddingTop: 4 }}>
        {resolved.categories.map((c) => (
          <EmojiRatingRow
            key={c.key}
            label={c.label}
            value={scores[c.key]}
            options={scoreOptions}
            colors={colors}
            readOnly={false}
            onChange={(n) => setScores((prev) => ({ ...prev, [c.key]: n }))}
          />
        ))}
        <EmojiRatingRow
          label={resolved.overall_label}
          value={overall}
          options={scoreOptions}
          colors={colors}
          readOnly={false}
          onChange={setOverall}
        />
        <div style={{ marginTop: 4, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: colors.text, marginBottom: 8, textAlign: "right", fontWeight: 600 }}>
            {resolved.free_text_label}
          </div>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={3}
            placeholder={resolved.free_text_placeholder}
            style={{
              width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
              border: `1px solid ${colors.border}`, background: colors.inputBg,
              color: colors.text, fontSize: 13, fontFamily: "inherit", resize: "vertical",
              textAlign: "right",
            }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        title={
          previewOnly
            ? "תצוגה מקדימה — אין שליחה"
            : (!allAnswered ? "אנא דרגו את כל הקטגוריות לפני שליחה" : "")
        }
        style={{
          width: "100%", padding: "14px", borderRadius: 12, border: "none",
          cursor: canSubmit ? "pointer" : "not-allowed",
          background: canSubmit
            ? (variant === "portal"
              ? `linear-gradient(135deg, ${PORTAL.gold}, #B8960C)`
              : "linear-gradient(135deg, var(--gold), #B8960C)")
            : (variant === "portal" ? "rgba(255,255,255,0.08)" : "var(--ivory)"),
          color: canSubmit
            ? (variant === "portal" ? "#0f172a" : "var(--black)")
            : colors.muted,
          fontSize: 15, fontWeight: 700, fontFamily: "Heebo, sans-serif",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? "שולחים…" : resolved.submit_label}
      </button>
    </div>
  );
}
