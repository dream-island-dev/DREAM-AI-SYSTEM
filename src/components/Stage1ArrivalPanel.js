/**
 * Stage 1 — אישור הגעה: single-source editor + true outbound preview (Option 2).
 * Used in AutomationControlCenter (ניהול חכם) and BotScriptEditor.
 */

import {
  ARRIVAL_CONFIRM_CTA_HE,
  STAGE1_SAMPLE_GUEST_NAME,
  metaTemplateBodyToBotScript,
  resolveStage1OutboundBody,
  stage1WillAutoAppendCta,
} from "../utils/stage1ArrivalCopy";
import { isArrivalConfirmationMessage } from "../utils/arrivalConfirmation";

function PreviewBubble({ title, channelLabel, channelColor, children, footer }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
          {title}
        </div>
        {channelLabel && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
            background: `${channelColor}18`, color: channelColor, border: `1px solid ${channelColor}55`,
          }}>
            {channelLabel}
          </span>
        )}
      </div>
      <div style={{
        background: "#DCF8C6", borderRadius: "10px 10px 10px 2px", padding: "10px 14px",
        fontSize: 13, lineHeight: 1.7, direction: "rtl", whiteSpace: "pre-wrap", maxWidth: 480,
        boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
      }}>
        {children}
      </div>
      {footer}
    </div>
  );
}

const GUEST_REPLY_SAMPLES = [
  "כן, מגיעים!",
  "כן מגיעים",
  "מגיעים",
  "כן,מגיעים!",
];

export function Stage1GuestReplyMatcherPanel() {
  return (
    <div style={{
      marginTop: 12, padding: "10px 12px", borderRadius: 10,
      background: "rgba(3,105,161,0.06)", border: "1px solid #93C5FD",
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#0369A1", marginBottom: 6 }}>
        🤖 זיהוי תשובת אורח (אינטליגנטי) → מעבר לשלב 2
      </div>
      <div style={{ fontSize: 11, color: "#444", lineHeight: 1.65, marginBottom: 8 }}>
        הבוט מזהה אישור הגעה בטקסט חופשי ובלחיצת כפתור Meta — כולל וריאציות עם אימוג׳ים וסימני פיסוק.
        «לא, שינוי בתאריך» לעולם לא מאשר.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {GUEST_REPLY_SAMPLES.map((sample) => (
          <span
            key={sample}
            style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 14,
              background: isArrivalConfirmationMessage(sample) ? "#E8F5EF" : "#FFF0EE",
              color: isArrivalConfirmationMessage(sample) ? "#1A7A4A" : "#C0392B",
              border: `1px solid ${isArrivalConfirmationMessage(sample) ? "#1A7A4A" : "#C0392B"}44`,
            }}
          >
            {isArrivalConfirmationMessage(sample) ? "✓" : "✗"} {sample}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Stage1TrueOutboundPreview({
  draftText,
  autoAppendCta,
  channel = "whapi",
  guestName = STAGE1_SAMPLE_GUEST_NAME,
  metaTemplateBody,
}) {
  const isWhapi = channel === "whapi" || channel === "whapi_session" || channel === "session_message";
  const outbound = isWhapi
    ? resolveStage1OutboundBody(draftText, { guestName, autoAppendCta })
    : null;
  const willAppend = isWhapi && stage1WillAutoAppendCta(draftText, autoAppendCta);

  const metaPreview = metaTemplateBody
    ? metaTemplateBody.replace(/\{\{\s*1\s*\}\}/g, guestName)
    : null;

  return (
    <div>
      {isWhapi ? (
        <PreviewBubble
          title="📱 מה האורח באמת מקבל — מכשיר הסוויטות / Bot Script"
          channelLabel="מכשיר הסוויטות"
          channelColor="#1A7A4A"
          footer={willAppend ? (
            <div style={{ fontSize: 11, color: "#92400E", marginTop: 8, lineHeight: 1.55 }}>
              ⚡ נוספה אוטומטית שורת CTA (רשת ביטחון): «{ARRIVAL_CONFIRM_CTA_HE}»
            </div>
          ) : null}
        >
          {outbound || "—"}
        </PreviewBubble>
      ) : (
        <PreviewBubble
          title="🔵 מה האורח מקבל — Dream Bot (תבנית Meta)"
          channelLabel="Dream Bot · Meta"
          channelColor="#0369A1"
          footer={(
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "#0369A1" }}>↩️ כן, מגיעים! ✨</span>
              <span style={{ fontSize: 11, color: "#0369A1" }}>↩️ לא, שינוי בתאריך 🗓️</span>
            </div>
          )}
        >
          {metaPreview || "—"}
        </PreviewBubble>
      )}
      <Stage1GuestReplyMatcherPanel />
    </div>
  );
}

export function Stage1ArrivalControlPanel({
  draftText,
  onDraftChange,
  onSave,
  autoAppendCta,
  onAutoAppendChange,
  metaTemplateBody,
  onCopyFromMeta,
  compact = false,
}) {
  return (
    <div style={{
      padding: compact ? "12px 14px" : "14px 16px",
      borderRadius: 12,
      border: "2px solid var(--gold)",
      background: "rgba(201,169,110,0.06)",
      marginBottom: compact ? 0 : 4,
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
        🌴 שלב 1 — בקשת אישור הגעה (מקור האמת)
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 12 }}>
        לסוויטות ויום-כיף דרך <strong>מכשיר הסוויטות</strong> — הטקסט כאן הוא מה שנשלח.
        תבנית Meta למטה היא <em>רק</em> ל-Dream Bot כשאין Whapi.
      </div>

      <div className="form-field" style={{ marginBottom: 10 }}>
        <label style={{ fontWeight: 700 }}>✏️ תוכן ההודעה (bot_scripts.pre_arrival_2d)</label>
        <textarea
          rows={compact ? 5 : 6}
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={(e) => onSave?.(e.target.value)}
          style={{ direction: "rtl", fontFamily: "Heebo, sans-serif", lineHeight: 1.7, resize: "vertical", width: "100%" }}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        {onCopyFromMeta && metaTemplateBody && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const converted = metaTemplateBodyToBotScript(metaTemplateBody);
              onDraftChange(converted);
              onSave?.(converted);
            }}
          >
            📋 העתק מתבנית Meta לסשן
          </button>
        )}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 220,
          padding: "8px 12px", borderRadius: 10, background: "#fff", border: "1px solid var(--border)",
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>רשת ביטחון — הצמד «כן, מגיעים» אם חסר</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              מומלץ להשאיר דלוק. כבוי = שליחת הטקסט בדיוק כמו שכתבת.
            </div>
          </div>
          <div
            role="switch"
            aria-checked={autoAppendCta}
            onClick={() => onAutoAppendChange?.(!autoAppendCta)}
            style={{
              width: 44, height: 24, borderRadius: 12, cursor: "pointer", flexShrink: 0,
              background: autoAppendCta ? "var(--gold)" : "#D1D5DB", position: "relative",
            }}
          >
            <div style={{
              position: "absolute", top: 3, borderRadius: "50%", width: 18, height: 18,
              background: "#fff", right: autoAppendCta ? 3 : "auto", left: autoAppendCta ? "auto" : 3,
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }} />
          </div>
        </div>
      </div>

      <Stage1TrueOutboundPreview
        draftText={draftText}
        autoAppendCta={autoAppendCta}
        channel="whapi"
        metaTemplateBody={metaTemplateBody}
      />
    </div>
  );
}

export function Stage1DispatchPreview({ scriptText, autoAppendCta, channel, guestName, metaTemplateBody }) {
  const ch = channel === "meta_template" ? "meta" : "whapi";
  return (
    <Stage1TrueOutboundPreview
      draftText={scriptText}
      autoAppendCta={autoAppendCta}
      channel={ch}
      guestName={guestName || STAGE1_SAMPLE_GUEST_NAME}
      metaTemplateBody={metaTemplateBody}
    />
  );
}
