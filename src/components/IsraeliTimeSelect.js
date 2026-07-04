// 24-hour time picker — Israeli convention (HH:MM, no AM/PM).
import { useMemo } from "react";
import { buildIsraeliTimeOptions, normalizeHmTime } from "../utils/israeliTime";

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  boxSizing: "border-box",
  border: "1px solid var(--border,#ddd)",
  borderRadius: 8,
  fontSize: 14,
  direction: "ltr",
  fontFamily: "Heebo,sans-serif",
  background: "var(--card-bg,#fff)",
  cursor: "pointer",
};

export default function IsraeliTimeSelect({
  value,
  onChange,
  disabled,
  emptyLabel,
  startHour,
  endHour,
  stepMinutes,
}) {
  const normalized = normalizeHmTime(value);
  const options = useMemo(
    () => buildIsraeliTimeOptions(normalized, { emptyLabel, startHour, endHour, stepMinutes }),
    [normalized, emptyLabel, startHour, endHour, stepMinutes],
  );

  return (
    <select
      value={normalized}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
      style={inputStyle}
      aria-label="שעה בפורמט 24 שעות"
    >
      {options.map((o) => (
        <option key={o.value || "__empty"} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
