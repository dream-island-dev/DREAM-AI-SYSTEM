import { useMemo, useState } from "react";
import IsraeliTimeSelect from "./IsraeliTimeSelect";
import { formatIsraelDateTime, israelTodayYmd } from "../utils/israelTime";

function previewSpaUpsellText(template, guestName) {
  const name = String(guestName ?? "").trim() || "אורח יקר";
  return String(template ?? "")
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, name)
    .replace(/\{\{\s*portal_url\s*\}\}/gi, "https://dream-ai-system.vercel.app/portal/…");
}

/**
 * Confirm + preview + optional schedule before spa upsell batch dispatch.
 */
export default function SpaUpsellConfirmModal({
  targets,
  scriptText,
  pulseSeconds,
  sending,
  onClose,
  onSendNow,
  onSchedule,
}) {
  const [sendMode, setSendMode] = useState("now");
  const [scheduleDate, setScheduleDate] = useState(israelTodayYmd);
  const [scheduleTime, setScheduleTime] = useState("10:00");
  const [confirmed, setConfirmed] = useState(false);

  const sampleGuest = targets[0];
  const previewBody = useMemo(
    () => previewSpaUpsellText(scriptText, sampleGuest?.name),
    [scriptText, sampleGuest?.name],
  );

  const scheduleIsoPreview = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return null;
    const d = new Date(`${scheduleDate}T${scheduleTime}:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }, [scheduleDate, scheduleTime]);

  const scheduleInPast = scheduleIsoPreview
    ? new Date(scheduleIsoPreview).getTime() <= Date.now()
    : false;

  const canConfirm = confirmed && !sending && (
    sendMode === "now" || (scheduleDate && scheduleTime && !scheduleInPast)
  );

  const handleConfirm = () => {
    if (!canConfirm) return;
    if (sendMode === "now") {
      onSendNow();
      return;
    }
    const payload = targets.map((g) => ({
      guest_id: g.id,
      stage_key: "spa_upsell_daypass",
      schedule_date: scheduleDate,
      schedule_time: scheduleTime,
    }));
    onSchedule(payload);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.68)", zIndex: 10050,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "22px 24px",
        maxWidth: 520, width: "100%", maxHeight: "92vh", overflowY: "auto",
        direction: "rtl", boxShadow: "0 20px 56px rgba(0,0,0,0.28)",
        border: "1px solid #E9D5FF",
      }}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6, color: "#86198F" }}>
          💆 אישור שליחת הצעת ספא
        </div>
        <p style={{ fontSize: 12.5, color: "#701A75", lineHeight: 1.55, margin: "0 0 14px" }}>
          {targets.length} אורחים · מכשיר הסוויטות (Whapi) · {pulseSeconds} שניות בין הודעה להודעה.
          לעריכת הטקסט: <strong>עורך סקריפטים → spa_upsell_daypass</strong>.
        </p>

        <div style={{
          background: "#FAF5FF", border: "1px solid #D8B4FE", borderRadius: 10,
          padding: "12px 14px", marginBottom: 14,
        }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#6B21A8", marginBottom: 8 }}>
            תצוגה מקדימה {sampleGuest?.name ? `(דוגמה: ${sampleGuest.name})` : ""}
          </div>
          <pre style={{
            margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit",
            fontSize: 13, lineHeight: 1.55, color: "#4C1D95",
          }}>
            {previewBody || "— אין טקסט ב-bot_scripts.spa_upsell_daypass — ערכו לפני השליחה"}
          </pre>
        </div>

        <details style={{ marginBottom: 14, fontSize: 12.5 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: "#701A75" }}>
            רשימת נמענים ({targets.length})
          </summary>
          <div style={{
            marginTop: 8, maxHeight: 120, overflowY: "auto",
            border: "1px solid #F3E8FF", borderRadius: 8, background: "#FDF4FF",
          }}>
            {targets.map((g) => (
              <div key={g.id} style={{ padding: "6px 10px", borderBottom: "1px solid #F3E8FF" }}>
                <strong>{g.name || "—"}</strong>
                <span style={{ color: "#A21CAF", marginRight: 8 }}>{g.phone}</span>
              </div>
            ))}
          </div>
        </details>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setSendMode("now")}
            disabled={sending}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              border: sendMode === "now" ? "1px solid #A21CAF" : "1px solid #E9D5FF",
              background: sendMode === "now" ? "#F3E8FF" : "#fff",
              fontWeight: sendMode === "now" ? 700 : 500,
            }}
          >
            🚀 שלח עכשיו
          </button>
          <button
            type="button"
            onClick={() => setSendMode("schedule")}
            disabled={sending}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              border: sendMode === "schedule" ? "1px solid #A21CAF" : "1px solid #E9D5FF",
              background: sendMode === "schedule" ? "#F3E8FF" : "#fff",
              fontWeight: sendMode === "schedule" ? 700 : 500,
            }}
          >
            📅 תזמן לשעה אחרת
          </button>
        </div>

        {sendMode === "schedule" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            marginBottom: 12, padding: "10px 12px", borderRadius: 10,
            border: "1px solid #E9D5FF", background: "#FDF4FF",
          }}>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              disabled={sending}
              style={{ padding: "6px 8px", fontSize: 12, borderRadius: 6, border: "1px solid #D8B4FE" }}
            />
            <div style={{ width: 130 }}>
              <IsraeliTimeSelect
                value={scheduleTime}
                onChange={setScheduleTime}
                disabled={sending}
                startHour={6}
                endHour={23}
              />
            </div>
            {scheduleIsoPreview && (
              <span style={{ fontSize: 12, color: scheduleInPast ? "#C0392B" : "#701A75" }}>
                {scheduleInPast
                  ? "⚠ השעה כבר עברה — בחרו מועד עתידי"
                  : `יישלח בערך ${formatIsraelDateTime(scheduleIsoPreview)}`}
              </span>
            )}
          </div>
        )}

        <label style={{
          display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13,
          lineHeight: 1.5, marginBottom: 16, cursor: "pointer",
        }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={sending}
            style={{ marginTop: 3 }}
          />
          <span>
            קראתי את הטקסט ואת רשימת הנמענים — מאשר/ת {sendMode === "now" ? "שליחה מיידית" : "תזמון"} דרך מכשיר הסוויטות.
          </span>
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #D8B4FE",
              background: "#fff", cursor: sending ? "not-allowed" : "pointer",
            }}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: !canConfirm ? "#E9D5FF" : "#A21CAF",
              color: "#fff", fontWeight: 700, fontSize: 13,
              cursor: !canConfirm ? "not-allowed" : "pointer",
            }}
          >
            {sending
              ? "⏳ מבצע..."
              : sendMode === "now"
                ? `🚀 שלח ל-${targets.length} אורחים`
                : `📅 שמור תזמון ל-${targets.length} אורחים`}
          </button>
        </div>
      </div>
    </div>
  );
}
