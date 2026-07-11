// src/components/DataSyncPage.js
// Standalone Admin entry point for the existing import engine (ArrivalImportPanel.js).
// No parsing/upsert logic lives here — this is a thin, dedicated-page wrapper so
// admins can reach "סנכרון נתונים" directly from the Sidebar instead of opening it
// inside Operations board (see CLAUDE.md §10 session — ArrivalImportPanel remains
// the SOLE import engine; this view does not duplicate it).
//
// Second mount point, same rule: <ActivitiesImportZone> + syncEzgoSpaActivities
// are the SAME component/engine SpaBoard.js uses — spa reception's primary
// entry point stays SpaBoard, this is the general admin alternative (one
// engine, two entry points, per the Smart Spa Board planning doc).

import { useState } from "react";
import ArrivalImportPanel from "./ArrivalImportPanel";
import ActivitiesImportZone from "./spa/ActivitiesImportZone";

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function SpaActivitiesSyncSection() {
  const [selectedDate, setSelectedDate] = useState(todayYmd());
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };

  function handleImportDone(summary) {
    const parts = [];
    if (summary.created) parts.push(`${summary.created} תורים נוצרו`);
    if (summary.updated) parts.push(`${summary.updated} עודכנו`);
    if (summary.guests_created) parts.push(`${summary.guests_created} אורחי-יום נוצרו`);
    if (summary.meal_time_set) parts.push(`${summary.meal_time_set} שעת ארוחה נקלטה`);
    if (summary.room_unmapped) parts.push(`${summary.room_unmapped} חדר לא מזוהה`);
    if (summary.conflicts) parts.push(`${summary.conflicts} התנגשויות`);
    if (summary.unmatched) parts.push(`${summary.unmatched} ללא שיוך`);
    if (summary.not_in_file) parts.push(`${summary.not_in_file} לא בקובץ (לא בוטלו)`);
    showToast(`✓ ייבוא הושלם — ${parts.join(" · ") || "אין שינויים"}`);
  }

  return (
    <div style={{ marginTop: 24, direction: "rtl", fontFamily: "Heebo, sans-serif" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--gold-light)", marginBottom: 4 }}>
        💆 סנכרון פעילויות ספא (EZGO)
      </div>
      <div style={{ fontSize: 12, color: "rgba(232,201,138,0.6)", marginBottom: 12 }}>
        ניהול מלא של אג׳נדת הספא (תצוגה, צבעים, הערות) נמצא בלוח הספא — כאן אפשר רק לייבא את הדוח היומי.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: "var(--gold-light)" }}>תאריך:</label>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
      </div>
      {toast && (
        <div style={{
          borderRadius: 10, padding: "10px 16px", marginBottom: 12, fontWeight: 700, fontSize: 13,
          background: toast.type === "err" ? "#FCEBEB" : "#EAF3DE",
          color: toast.type === "err" ? "#A32D2D" : "#3B6D11",
          border: `1px solid ${toast.type === "err" ? "#E24B4A" : "#639922"}`,
        }}>
          {toast.msg}
        </div>
      )}
      <ActivitiesImportZone
        selectedDate={selectedDate}
        onImportDone={handleImportDone}
        onError={(msg) => showToast(msg, "err")}
      />
    </div>
  );
}

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

      <SpaActivitiesSyncSection />
    </div>
  );
}
