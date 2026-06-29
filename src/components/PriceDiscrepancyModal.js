// Price conflict resolver — shown during detailed reservation import when two
// price columns disagree for the same guest row.

export default function PriceDiscrepancyModal({
  conflict,
  current,
  total,
  onChoose,
  onCancel,
}) {
  if (!conflict) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(15,15,15,0.72)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      direction: "ltr",
    }}>
      <div style={{
        direction: "rtl", maxWidth: 480, width: "100%",
        background: "var(--card-bg, #fff)", borderRadius: 16,
        border: "2px solid #dc2626", boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        padding: "24px 22px",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", marginBottom: 6 }}>
          פער מחיר {current} מתוך {total}
        </div>
        <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 800, color: "var(--black, #1a1a1a)" }}>
          נמצא פער במחיר עבור {conflict.guestName}
        </h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--text-muted, #666)", lineHeight: 1.7 }}>
          שתי עמודות המחיר בדוח לא תואמות. בחר איזה מחיר לשמור בפרופיל האורח.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => onChoose("price1")}
            style={{
              padding: "14px 16px", borderRadius: 10, cursor: "pointer",
              border: "2px solid var(--gold, #C9A96E)", background: "rgba(201,169,110,0.1)",
              fontFamily: "Heebo,sans-serif", fontSize: 14, fontWeight: 800,
              textAlign: "right", color: "var(--black, #1a1a1a)",
            }}
          >
            מחיר 1: {conflict.price1Label}
          </button>
          <button
            type="button"
            onClick={() => onChoose("price2")}
            style={{
              padding: "14px 16px", borderRadius: 10, cursor: "pointer",
              border: "2px solid #1d4ed8", background: "rgba(29,78,216,0.08)",
              fontFamily: "Heebo,sans-serif", fontSize: 14, fontWeight: 800,
              textAlign: "right", color: "var(--black, #1a1a1a)",
            }}
          >
            מחיר 2: {conflict.price2Label}
          </button>
        </div>

        <button
          type="button"
          onClick={onCancel}
          style={{
            width: "100%", padding: "10px", borderRadius: 8, cursor: "pointer",
            border: "1px solid var(--border, #E0D5C5)", background: "transparent",
            fontFamily: "Heebo,sans-serif", fontSize: 13, color: "var(--text-muted, #666)",
          }}
        >
          ביטול ייבוא
        </button>
      </div>
    </div>
  );
}
