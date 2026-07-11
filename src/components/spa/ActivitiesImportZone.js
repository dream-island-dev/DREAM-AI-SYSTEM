// src/components/spa/ActivitiesImportZone.js
// Ezgo Activities Excel import — shared UI over the Phase 1/2 parser+engine.
// Mounted from BOTH SpaBoard.js and DataSyncPage.js (one engine, two entry
// points — spa reception is the primary user but Data Sync is the general
// admin import screen). Imports the FULL daily report (suites/day-guests/
// groups — no suite-only filter). Anything the sync engine can't resolve
// lands in spa_import_unmatched instead of vanishing (ZERO DATA LOSS).
import { useState, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { parseEzgoActivitiesReport } from "../../utils/ezgoSpaActivitiesParser";
import { syncEzgoSpaActivities } from "../../utils/spaActivitiesSyncEngine";

export default function ActivitiesImportZone({ selectedDate, onImportDone, onError }) {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) { onError("בחר קובץ .xlsx / .xls / .csv"); return; }
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (!rows.length) { onError("הקובץ ריק"); return; }

      const parsedRows = parseEzgoActivitiesReport(rows);
      if (!parsedRows.length) { onError("לא נמצאו שורות בקובץ"); return; }

      const summary = await syncEzgoSpaActivities(parsedRows, selectedDate, { supabase });
      onImportDone(summary);
    } catch (err) {
      onError("שגיאה בייבוא: " + err.message);
    } finally {
      setParsing(false);
    }
  };

  if (parsing) {
    return (
      <div style={{ background: "var(--ivory)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 18, height: 18, border: "3px solid var(--border)", borderTop: "3px solid var(--gold)", borderRadius: "50%", animation: "di-spin 0.8s linear infinite", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>מייבא ומסנכרן — עשוי לקחת רגע לקובץ גדול...</span>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
      onClick={() => fileRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--gold)" : "var(--border)"}`,
        borderRadius: 12, background: dragging ? "var(--ivory)" : "var(--card-bg)",
        padding: "16px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <div style={{ fontSize: 13, fontWeight: 700 }}>📊 גרור לכאן את דוח הפעילויות מ-EZGO — או לחץ לבחירת קובץ</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
        מייבא את כל השורות בדוח עבור {selectedDate} — סוויטות, יום-כיף וקבוצות
      </div>
    </div>
  );
}
