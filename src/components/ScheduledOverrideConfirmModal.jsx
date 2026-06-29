import { formatIsraelDateTime } from "../utils/israelTime";

/**
 * Dark/gold confirmation when staff force-sends before the cron schedule.
 */
export default function ScheduledOverrideConfirmModal({
  guestName,
  stageLabel,
  scheduledFor,
  sending,
  error,
  onConfirm,
  onCancel,
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 10200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "linear-gradient(160deg, #0F0F0F 0%, #1A1A1A 100%)",
        border: "1px solid #C9A96E",
        borderRadius: 16,
        padding: "28px 32px",
        maxWidth: 480,
        width: "100%",
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        direction: "rtl",
        color: "#F5F0E8",
      }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12, color: "#C9A96E" }}>
          ⚠ שליחה מוקדמת — Smart Override
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.75, marginBottom: 20 }}>
          <strong>{guestName ?? "אורח"}</strong>
          {stageLabel && <span style={{ color: "#A8A29E" }}> · {stageLabel}</span>}
          <br />
          האוטומציה מתוזמנת לשעה{" "}
          <strong style={{ color: "#E8C98A" }}>{formatIsraelDateTime(scheduledFor)}</strong>.
          <br />
          שליחה עכשיו תבטל את המשימה המתוזמנת. האם להמשיך?
        </div>
        {error && (
          <div style={{
            background: "rgba(192,57,43,0.15)",
            border: "1px solid #C0392B",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: "#FCA5A5",
            marginBottom: 16,
          }}>
            ❌ {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={sending}
            style={{ color: "#F5F0E8", borderColor: "#444" }}
          >
            ביטול
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={sending}
            style={{ background: "#C9A96E", borderColor: "#A8843A", color: "#0F0F0F", fontWeight: 800 }}
          >
            {sending ? "⏳ שולח..." : "🚀 שלח עכשיו"}
          </button>
        </div>
      </div>
    </div>
  );
}
