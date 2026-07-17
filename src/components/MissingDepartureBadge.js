import { isMissingSuiteDepartureDate } from "../utils/departureDateGuard";

/** FAIL VISIBLE — suite guest missing departure_date. */
export default function MissingDepartureBadge({ guest, style = {} }) {
  if (!isMissingSuiteDepartureDate(guest)) return null;
  return (
    <span
      title="חסר תאריך עזיבה — יש להשלים בדחיפות"
      style={{
        fontSize: 11,
        fontWeight: 800,
        padding: "2px 8px",
        borderRadius: 10,
        background: "#FEF2F2",
        color: "#B91C1C",
        border: "1px solid #FECACA",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      ⚠️ חסר עזיבה
    </span>
  );
}
