// src/components/DataSyncPage.js
// Standalone Admin entry point for the existing import engine (ArrivalImportPanel.js).
// No parsing/upsert logic lives here — this is a thin, dedicated-page wrapper so
// admins can reach "סנכרון נתונים" directly from the Sidebar instead of opening it
// inside Operations board (see CLAUDE.md §10 session — ArrivalImportPanel remains
// the SOLE import engine; this view does not duplicate it).

import ArrivalImportPanel from "./ArrivalImportPanel";

export default function DataSyncPage() {
  return (
    <div
      style={{
        background: "radial-gradient(ellipse at top, #1c1c1c 0%, #0F0F0F 70%)",
        borderRadius: 20,
        padding: "28px 26px 32px",
        boxShadow: "0 16px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
        border: "1px solid rgba(201,169,110,0.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div
          style={{
            width: 52, height: 52, borderRadius: 16,
            background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, boxShadow: "0 6px 20px rgba(201,169,110,0.35)",
            flexShrink: 0,
          }}
        >
          📥
        </div>
        <div>
          <div style={{
            fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700,
            color: "var(--gold-light)", lineHeight: 1.2,
          }}>
            סנכרון נתונים
          </div>
          <div style={{ fontSize: 13, color: "rgba(232,201,138,0.6)", marginTop: 3 }}>
            ייבוא דוחות EZGO (כניסות + ספא) וסידור משמרות — ישירות למאגר האורחים
          </div>
        </div>
      </div>

      <ArrivalImportPanel defaultOpen />
    </div>
  );
}
