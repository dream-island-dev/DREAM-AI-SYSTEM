// src/components/spa/ActivitiesImportZone.js
// Ezgo Activities Excel import — shared UI over the Phase 1/2 parser+engine.
// Mounted from BOTH SpaBoard.js and DataSyncPage.js (one engine, two entry
// points — spa reception is the primary user but Data Sync is the general
// admin import screen). Imports the FULL daily report (suites/day-guests/
// groups — no suite-only filter). Anything the sync engine can't resolve
// lands in spa_import_unmatched instead of vanishing (ZERO DATA LOSS).
// Accepts Hebrew UI exports AND Ezgo English machine-CSV (tmStart/sTel/…).
import { useState, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { parseEzgoActivitiesReport, repairEzgoCsvText } from "../../utils/ezgoSpaActivitiesParser";
import { syncEzgoSpaActivities } from "../../utils/spaActivitiesSyncEngine";

/** Prefer the next file-date on/after the picker (month dumps skip empty days like 18.8). */
function pickBoardJumpDate(dates, today) {
  const sorted = [...new Set(dates)].filter(Boolean).sort();
  if (!sorted.length) return today;
  return sorted.find((d) => d >= today) || sorted[sorted.length - 1];
}
function resolveImportDate(parsedRows, selectedDate) {
  const dates = [...new Set(parsedRows.map((r) => r.appointment_date).filter(Boolean))];
  if (dates.length === 1) return { date: dates[0], fromFile: true, mixed: false };
  if (dates.length > 1) return { date: selectedDate, fromFile: false, mixed: true };
  return { date: selectedDate, fromFile: false, mixed: false };
}

/** CSV: repair Ezgo בע"מ quotes then parse as string. XLSX/XLS: SheetJS with raw:false so dates/phones coerce cleanly. */
async function loadActivitiesSheetRows(file, XLSX) {
  const ext = file.name.split(".").pop().toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === "csv") {
    const text = repairEzgoCsvText(new TextDecoder("utf-8").decode(buf));
    const wb = XLSX.read(text, { type: "string", raw: false, codepage: 65001 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  }
  const wb = XLSX.read(buf, { type: "array", raw: false, cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
}

export default function ActivitiesImportZone({ selectedDate, onImportDone, onError }) {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState("");
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) { onError("בחר קובץ .xlsx / .xls / .csv"); return; }
    setParsing(true);
    setProgress("קורא את הקובץ…");
    try {
      const XLSX = await import("xlsx");
      const rows = await loadActivitiesSheetRows(file, XLSX);
      if (!rows.length) { onError("הקובץ ריק"); return; }

      setProgress("מפענח שורות…");

      const { rows: parsedRows, skippedCancelled } = parseEzgoActivitiesReport(rows);
      if (!parsedRows.length && !skippedCancelled) { onError("לא נמצאו שורות בקובץ"); return; }
      if (!parsedRows.length) {
        onError(`כל השורות מבוטלות ב-EZGO (${skippedCancelled}) — אין מה לסנכרן`);
        return;
      }

      const { date: importDate, fromFile, mixed } = resolveImportDate(parsedRows, selectedDate);
      const byDate = new Map();
      for (const row of parsedRows) {
        const d = row.appointment_date || importDate;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(row);
      }
      const summaries = [];
      let dayIndex = 0;
      for (const [date, dateRows] of byDate) {
        dayIndex += 1;
        setProgress(`מסנכרן יום ${dayIndex} מתוך ${byDate.size} (${date}, ${dateRows.length} תורים)…`);
        summaries.push(await syncEzgoSpaActivities(dateRows, date, { supabase, skippedCancelled: 0 }));
      }
      const summary = summaries.reduce((acc, s) => {
        for (const [k, v] of Object.entries(s)) {
          if (typeof v === "number") acc[k] = (acc[k] || 0) + v;
          else if (acc[k] == null) acc[k] = v;
        }
        return acc;
      }, { skippedCancelled });
      summary.days_synced = byDate.size;
      summary.jump_date = pickBoardJumpDate([...byDate.keys()], selectedDate);
      if (fromFile && importDate !== selectedDate) summary.date_from_file = importDate;
      if (mixed) summary.date_mixed = true;
      onImportDone(summary);
    } catch (err) {
      onError("שגיאה בייבוא: " + err.message);
    } finally {
      setParsing(false);
      setProgress("");
    }
  };

  if (parsing) {
    return (
      <div style={{ background: "var(--ivory)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 18, height: 18, border: "3px solid var(--border)", borderTop: "3px solid var(--gold)", borderRadius: "50%", animation: "di-spin 0.8s linear infinite", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{progress || "מייבא ומסנכרן — קובץ חודשי יכול לקחת כמה דקות. אל תרענן."}</span>
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
        מייבא את כל השורות בדוח עבור {selectedDate} — סוויטות, יום-כיף וקבוצות (גם CSV אנגלי מ-EZGO)
      </div>
    </div>
  );
}
