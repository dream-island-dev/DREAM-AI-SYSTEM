import { QUIET_HOURS_HINT, QUIET_HOURS_LABEL } from "../utils/quietHours";

/**
 * Shown when manual outbound sends are blocked during quiet hours.
 * Staff must explicitly check the override before send buttons unlock.
 */
export default function QuietHoursGate({ active, checked, onChange, compact = false }) {
  if (!active) return null;

  return (
    <div
      style={{
        background: "#FFF8E7",
        border: "1px solid var(--gold-dark, #A8843A)",
        borderRadius: compact ? 8 : 10,
        padding: compact ? "8px 12px" : "12px 14px",
        fontSize: compact ? 12 : 13,
        direction: "rtl",
        textAlign: "right",
      }}
    >
      <label style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        cursor: "pointer",
        fontWeight: 600,
        color: "#92400E",
      }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: "var(--gold)", marginTop: 3, flexShrink: 0 }}
        />
        <span>{QUIET_HOURS_LABEL}</span>
      </label>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, marginRight: 26 }}>
        {QUIET_HOURS_HINT}
      </div>
    </div>
  );
}
