import {
  CHECKIN_TIMELINE_ARCHIVE,
  CHECKIN_TIMELINE_LABELS,
  CHECKIN_TIMELINE_SCOPES,
} from "../utils/guestCheckinMatrix";

/**
 * Shared PMS date filter — timeline chips + optional exact arrival_date picker.
 * Used by GuestsPage (צ'ק-אין) and GuestDashboard (ניהול אורחים).
 */
export default function CheckinTimelineFilterBar({
  timelineScope,
  customArrivalDate,
  onScopeChange,
  onCustomDateChange,
  scopeCounts = {},
  showLegend = true,
  onSelectAllForDate,
  selectAllDisabled = false,
}) {
  const dateModeActive = !!customArrivalDate;

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        role="tablist"
        aria-label="מסנן תאריכי הגעה"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "10px 12px",
          background: "var(--ivory, #F5F0E8)",
          borderRadius: 12,
          border: "1px solid var(--border, #E0D5C5)",
          alignItems: "center",
        }}
      >
        {CHECKIN_TIMELINE_SCOPES.map((scope) => {
          const active = !dateModeActive && timelineScope === scope;
          const count = scopeCounts[scope] ?? 0;
          return (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onScopeChange(scope)}
              style={{
                minHeight: 44,
                padding: "8px 14px",
                borderRadius: 10,
                border: active
                  ? "2px solid var(--gold, #C9A96E)"
                  : "1.5px solid var(--border, #E0D5C5)",
                background: active
                  ? "linear-gradient(135deg, rgba(201,169,110,0.28), rgba(232,201,138,0.35))"
                  : "var(--card-bg, #fff)",
                color: active ? "var(--gold-dark, #A8843A)" : "var(--text-muted, #666)",
                fontFamily: "Heebo, sans-serif",
                fontSize: 13,
                fontWeight: active ? 800 : 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                transition: "background 0.15s, border-color 0.15s",
              }}
            >
              <span>{CHECKIN_TIMELINE_LABELS[scope]}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "2px 8px",
                  borderRadius: 20,
                  background: active ? "rgba(15,15,15,0.08)" : "var(--ivory, #F5F0E8)",
                  color: active ? "#0F0F0F" : "var(--text-muted)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            marginInlineStart: "auto",
          }}
        >
          <label
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: dateModeActive ? "var(--gold-dark)" : "var(--text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>📅</span>
            <input
              type="date"
              value={customArrivalDate || ""}
              onChange={(e) => onCustomDateChange(e.target.value || null)}
              title="סינון לפי תאריך הגעה מדויק"
              style={{
                minHeight: 44,
                padding: "8px 10px",
                borderRadius: 10,
                border: dateModeActive
                  ? "2px solid var(--gold, #C9A96E)"
                  : "1.5px solid var(--border, #E0D5C5)",
                fontFamily: "Heebo, sans-serif",
                fontSize: 13,
                cursor: "pointer",
                background: dateModeActive
                  ? "linear-gradient(135deg, rgba(201,169,110,0.15), rgba(232,201,138,0.2))"
                  : "var(--card-bg, #fff)",
              }}
            />
          </label>
          {onSelectAllForDate && (
            <button
              type="button"
              onClick={onSelectAllForDate}
              disabled={selectAllDisabled || !customArrivalDate}
              title={
                !customArrivalDate
                  ? "בחר תאריך הגעה במסנן למעלה"
                  : "בחר את כל האורחים המסוננים לתאריך זה"
              }
              style={{
                minHeight: 44,
                padding: "8px 12px",
                borderRadius: 10,
                border: "2px solid var(--gold)",
                background: "rgba(201,169,110,0.1)",
                color: "var(--gold-dark)",
                fontFamily: "Heebo, sans-serif",
                fontSize: 12,
                fontWeight: 700,
                cursor: selectAllDisabled || !customArrivalDate ? "not-allowed" : "pointer",
                opacity: selectAllDisabled || !customArrivalDate ? 0.45 : 1,
              }}
            >
              בחר הכל לתאריך
            </button>
          )}
          {dateModeActive && (
            <button
              type="button"
              onClick={() => onCustomDateChange(null)}
              title="חזרה למסנן צ'יפים"
              style={{
                minHeight: 44,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1.5px solid var(--border)",
                background: "var(--card-bg)",
                color: "var(--text-muted)",
                fontFamily: "Heebo, sans-serif",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ✕ נקה תאריך
            </button>
          )}
        </div>
      </div>

      {showLegend && !dateModeActive && timelineScope !== CHECKIN_TIMELINE_ARCHIVE && (
        <div
          style={{
            display: "flex",
            gap: 14,
            marginTop: 8,
            fontSize: 11,
            color: "var(--text-muted)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#1A7A4A",
                display: "inline-block",
              }}
            />
            בחדר (checked_in)
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#C9A96E",
                display: "inline-block",
              }}
            />
            הגעה מתוכננת
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#2952A3",
                display: "inline-block",
              }}
            />
            חדר מוכן
          </span>
        </div>
      )}
    </div>
  );
}
