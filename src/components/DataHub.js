// src/components/DataHub.js
// Unified Data Hub — single upload center replacing fragmented tabs.
//
// PROFILES:
//   daily_arrivals  — EZGO combined report or standard arrivals Excel
//                     → editable grid with suite assignment → sync to bookings + guests
//   shift_schedule  — any Excel → editable grid → export back to .xlsx
//
// UX FLOW:
//   1. Select profile card
//   2. Drop file → parsed into rows[]
//   3. Editable grid: inline-edit cells, bulk search/replace, assign suite names
//   4. "Approve & Sync" (arrivals) or "Export Excel" (shifts)

import { useState, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ══════════════════════════════════════════════════════════════════════════════
// §1  PROFILE DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════

const ARRIVALS_COLS = [
  { id: "name",           label: "שם אורח",          editable: true,  w: 160 },
  { id: "phone",          label: "טלפון",             editable: false, w: 125 },
  { id: "arrival_date",   label: "תאריך הגעה",        editable: false, w: 105 },
  { id: "room_count",     label: "חד׳",               editable: false, w: 52  },
  { id: "room_type",      label: "סוג",               editable: true,  w: 100,
    options: ["suite", "day_guest", "group"] },
  { id: "treatment_time", label: "שעת ספא",           editable: true,  w: 82  },
  { id: "treatment_type", label: "סוג טיפול",         editable: true,  w: 210 },
  { id: "suite_name",     label: "🏨 שם חדר / סוויטה", editable: true,  w: 155, gold: true },
];

const PROFILES = {
  daily_arrivals: {
    label:      "📅 הגעות יומיות + ספא",
    hint:       "קובץ EZGO יומי — אורחים, שעות ספא, שיוך חדר",
    columns:    ARRIVALS_COLS,
    parser:     "arrivals",
    syncable:   true,
    exportable: false,
  },
  shift_schedule: {
    label:      "📋 סידור משמרות",
    hint:       "כל קובץ Excel — ערוך בגריד וייצא חזרה",
    columns:    null,     // dynamic — derived from file headers
    parser:     "shifts",
    syncable:   false,
    exportable: true,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// §2  PARSE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function ezgoDateToISO(val) {
  if (!val && val !== 0) return null;
  if (typeof val === "number" && val > 40000 && val < 60000) {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function sanitizePhone(raw) {
  const p = String(raw ?? "").replace(/[\s\-().+]/g, "");
  if (!p) return null;
  if (p.startsWith("972") && p.length >= 11) return p;
  if (p.startsWith("0") && p.length === 10) return "972" + p.slice(1);
  if (/^5\d{8}$/.test(p)) return "972" + p;
  return null;
}

const SOURCE_PREFIX_RE = /^(בוקינג\.?קום|booking\.?com|airbnb|אירבנב|ישיר|ישירות|מלון|agoda|expedia)\s*:?\s*/i;
const PHONE_TAIL_RE    = /\s*[-–]\s*([\d\s\-+]{9,15})\s*$/;
const PHONE_INLINE_RE  = /(0[5-9]\d[-\s]?\d{3}[-\s]?\d{4}|0[5-9]\d{8}|\+?972[5-9]\d{8})/;
const TIME_RE          = /\b(\d{1,2}:\d{2})\b/;

function extractBookingInfo(raw) {
  let s = String(raw ?? "").replace(/[\r\n\t\xa0]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^\d+:\s*/, ""); // strip "123456: " booking-ID prefix

  const tailMatch   = s.match(PHONE_TAIL_RE);
  const inlineMatch = s.match(PHONE_INLINE_RE);
  const rawPhone    = tailMatch?.[1] ?? inlineMatch?.[0] ?? null;
  const phone       = rawPhone ? sanitizePhone(rawPhone) : null;

  let name = phone
    ? s.slice(0, s.lastIndexOf(rawPhone)).replace(/\s*[-–]\s*$/, "").trim()
    : s;
  name = name.replace(SOURCE_PREFIX_RE, "").replace(/^\d+:\s*/, "").trim() || null;

  const roomMatch = s.match(/(\d+)\s*חד/);
  const roomCount = roomMatch ? parseInt(roomMatch[1]) : 1;

  return { name, phone, roomCount };
}

function extractSpaFromExtra(raw) {
  const s = String(raw ?? "").replace(/[\r\n\t\xa0]+/g, " ").replace(/\s+/g, " ").trim();
  const timeMatch = s.match(TIME_RE);
  if (!timeMatch) return null;

  const rawTime = timeMatch[1];
  const time    = rawTime.length === 4 ? "0" + rawTime : rawTime; // ensure HH:MM

  let category = null;
  if (s.includes("לאורחי הסוויטות") || s.includes("סוויט") || s.includes("לשובר")) {
    category = "suite";
  } else if (s.includes("בחבילה") || s.includes("מוזל") || s.includes("לאורחי היום")) {
    category = "day_guest";
  } else {
    return null;
  }

  const afterTime = s.replace(/^\d+\s*[-–]\s*\d{1,2}:\d{2}\s*[-–]\s*/, "").trim();
  return { time, category, treatmentType: afterTime || s };
}

// Parse EZGO combined daily report (columns: הזמנה, תוספות)
function parseCombinedRows(rawRows, headers) {
  const bookingIdx = headers.findIndex(h => h.includes("הזמנה"));
  const tosaIdx    = headers.findIndex(h => h.includes("תוספות"));

  // Try to extract date from first header cell (e.g., "יום: ג׳ 16.6.2026")
  const firstHeader  = String(headers[0] ?? "");
  const headerDateM  = firstHeader.match(/(\d{1,2}[./]\d{1,2}[./]\d{2,4})/);
  let   currentDate  = headerDateM ? ezgoDateToISO(headerDateM[1]) : null;
  let   currentPhone = null;
  let   currentName  = null;
  let   currentRooms = 1;
  const byPhone = {};

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row) continue;

    // Update date if col[0] is a date serial or date string
    const cellDate = ezgoDateToISO(row[0]);
    if (cellDate) currentDate = cellDate;

    const bookingCell = String(row[bookingIdx] ?? "");
    const tosaCell    = String(row[tosaIdx]    ?? "");
    const info        = extractBookingInfo(bookingCell);

    if (info.phone) {
      currentPhone = info.phone;
      currentName  = info.name;
      currentRooms = info.roomCount;
      // Catch-all: create entry immediately, even guests with no spa treatment
      if (!byPhone[currentPhone]) {
        byPhone[currentPhone] = {
          _id:            crypto.randomUUID(),
          name:           currentName,
          phone:          currentPhone,
          arrival_date:   currentDate,
          room_count:     currentRooms,
          room_type:      "day_guest",
          treatment_time: null,
          treatment_type: null,
          suite_name:     "",
        };
      }
    }

    const spa = extractSpaFromExtra(tosaCell);
    if (spa && currentPhone && byPhone[currentPhone]) {
      const e = byPhone[currentPhone];
      if (!e.treatment_time || spa.time < e.treatment_time) {
        e.treatment_time = spa.time;
        e.treatment_type = spa.treatmentType;
      }
      if (spa.category === "suite") e.room_type = "suite";
      else if (spa.category === "day_guest" && e.room_type !== "suite") e.room_type = "day_guest";
    }
  }

  return Object.values(byPhone);
}

// Parse standard EZGO arrivals (no named headers — col 0=date, col 1=booking, col 2=extras)
function parseStandardRows(rawRows) {
  let currentDate = null;
  const byPhone   = {};

  for (const row of rawRows) {
    if (!row || row.every(c => !c)) continue;

    const cellDate = ezgoDateToISO(row[0]);
    if (cellDate) currentDate = cellDate;

    const info = extractBookingInfo(String(row[1] ?? ""));
    if (!info.phone) continue;

    const spa = extractSpaFromExtra(String(row[2] ?? ""));

    if (!byPhone[info.phone]) {
      byPhone[info.phone] = {
        _id:            crypto.randomUUID(),
        name:           info.name,
        phone:          info.phone,
        arrival_date:   currentDate,
        room_count:     info.roomCount,
        room_type:      spa?.category ?? (info.roomCount <= 2 ? "day_guest" : "group"),
        treatment_time: spa?.time ?? null,
        treatment_type: spa?.treatmentType ?? null,
        suite_name:     "",
      };
    } else {
      if (spa?.time && (!byPhone[info.phone].treatment_time || spa.time < byPhone[info.phone].treatment_time)) {
        byPhone[info.phone].treatment_time = spa.time;
        byPhone[info.phone].treatment_type = spa.treatmentType;
      }
      if (spa?.category === "suite") byPhone[info.phone].room_type = "suite";
      byPhone[info.phone].room_count = Math.max(byPhone[info.phone].room_count, info.roomCount);
    }
  }

  return Object.values(byPhone);
}

async function parseArrivalsFile(arrayBuf) {
  const XLSX = await import("xlsx");
  const wb   = XLSX.read(arrayBuf, { type: "array", cellDates: false });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (!raw.length) return [];

  const headers = (raw[0] ?? []).map(h => String(h ?? "").trim());
  if (headers.some(h => h.includes("הזמנה") || h.includes("תוספות"))) {
    return parseCombinedRows(raw, headers);
  }
  return parseStandardRows(raw.slice(1));
}

async function parseShiftFile(arrayBuf) {
  const XLSX = await import("xlsx");
  const wb   = XLSX.read(arrayBuf, { type: "array", cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return raw.map(row => ({ _id: crypto.randomUUID(), ...row }));
}

// ══════════════════════════════════════════════════════════════════════════════
// §3  EXPORT TO EXCEL
// ══════════════════════════════════════════════════════════════════════════════

async function exportToExcel(columns, rows, filename = "export.xlsx") {
  const XLSX    = await import("xlsx");
  const headers = columns.map(c => c.label);
  const data    = rows.map(r => columns.map(c => r[c.id] ?? ""));
  const ws      = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Auto column widths
  const colWidths = columns.map(c => ({ wch: Math.max(c.label.length + 2, 14) }));
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename);
}

// ══════════════════════════════════════════════════════════════════════════════
// §4  SYNC TO DB
// ══════════════════════════════════════════════════════════════════════════════

async function syncArrivals(rows) {
  const today = new Date().toISOString().slice(0, 10);

  // All rows → bookings
  const bookings = rows
    .filter(r => r.phone)
    .map(r => ({
      phone:          r.phone,
      arrival_date:   r.arrival_date ?? today,
      guest_name:     r.name ?? null,
      treatment_time: r.treatment_time ?? null,
      treatment_type: r.treatment_type ?? null,
      room_count:     r.room_count ?? 1,
      status:         "pending",
    }));

  if (bookings.length) {
    const { error } = await supabase
      .from("bookings")
      .upsert(bookings, { onConflict: "phone,arrival_date", ignoreDuplicates: false });
    if (error) throw new Error("bookings: " + error.message);
  }

  // Individual guests (room_count ≤ 2) → guests table
  const guests = rows
    .filter(r => r.phone && (r.room_count ?? 1) <= 2)
    .map(r => ({
      phone:        r.phone,
      arrival_date: r.arrival_date ?? today,
      name:         r.name ?? null,
      room_type:    r.room_type ?? "day_guest",
      suite_name:   r.suite_name || null,
      status:       "pending",
    }));

  if (guests.length) {
    const { error } = await supabase
      .from("guests")
      .upsert(guests, { onConflict: "phone,arrival_date", ignoreDuplicates: false });
    if (error) throw new Error("guests: " + error.message);
  }

  return { bookings: bookings.length, guests: guests.length };
}

// ══════════════════════════════════════════════════════════════════════════════
// §5  EDITABLE GRID
// ══════════════════════════════════════════════════════════════════════════════

function EditableGrid({ columns, rows, onRowsChange, selectedIds, onSelectionChange }) {
  const [editingCell, setEditingCell] = useState(null); // { ri, colId }

  const startEdit = (ri, colId) => {
    if (!columns.find(c => c.id === colId)?.editable) return;
    setEditingCell({ ri, colId });
  };

  const commitEdit = (ri, colId, val) => {
    onRowsChange(rows.map((r, i) => i === ri ? { ...r, [colId]: val } : r));
    setEditingCell(null);
  };

  const handleKeyDown = (e, ri, colId) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const val     = e.target.value;
      const colIdx  = columns.findIndex(c => c.id === colId);
      const nextCol = columns.slice(colIdx + 1).find(c => c.editable);
      commitEdit(ri, colId, val);
      if (nextCol) setTimeout(() => setEditingCell({ ri, colId: nextCol.id }), 30);
    } else if (e.key === "Enter") {
      commitEdit(ri, colId, e.target.value);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const toggleRow = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    onSelectionChange(next);
  };

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const partSelected = selectedIds.size > 0 && selectedIds.size < rows.length;

  return (
    <div style={{
      overflowX: "auto", overflowY: "auto", maxHeight: "58vh",
      border: "1px solid var(--border)", borderRadius: 10,
    }}>
      <table style={{ borderCollapse: "collapse", minWidth: "100%", fontSize: 13, fontFamily: "Heebo,sans-serif" }}>
        <thead>
          <tr style={{ background: "var(--ivory)", position: "sticky", top: 0, zIndex: 10 }}>
            {/* Checkbox column */}
            <th style={{ padding: "10px 10px", borderBottom: "2px solid var(--border)", width: 38, textAlign: "center" }}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = partSelected; }}
                onChange={() => onSelectionChange(allSelected ? new Set() : new Set(rows.map(r => r._id)))}
                style={{ cursor: "pointer" }}
              />
            </th>
            {/* Row number */}
            <th style={{ padding: "10px 8px", borderBottom: "2px solid var(--border)", width: 36, color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textAlign: "center" }}>#</th>
            {/* Data columns */}
            {columns.map(col => (
              <th key={col.id} style={{
                padding: "10px 12px", borderBottom: "2px solid var(--border)",
                textAlign: "right", whiteSpace: "nowrap", minWidth: col.w ?? 100,
                fontFamily: "Heebo,sans-serif", fontSize: 11, fontWeight: 700,
                letterSpacing: "0.4px", textTransform: "uppercase",
                color:      col.gold ? "var(--gold-dark)" : "var(--text-muted)",
                background: col.gold ? "rgba(201,169,110,0.08)" : undefined,
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isSelected = selectedIds.has(row._id);
            return (
              <tr key={row._id} style={{
                background: isSelected
                  ? "rgba(201,169,110,0.1)"
                  : ri % 2 === 0 ? "#fff" : "var(--ivory)",
                transition: "background 0.1s",
              }}>
                <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row._id)} style={{ cursor: "pointer" }} />
                </td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid var(--border)", textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>
                  {ri + 1}
                </td>
                {columns.map(col => {
                  const isEditing = editingCell?.ri === ri && editingCell?.colId === col.id;
                  const val       = row[col.id] ?? "";

                  return (
                    <td key={col.id}
                      onClick={() => !isEditing && startEdit(ri, col.id)}
                      style={{
                        padding:     isEditing ? 0 : "7px 12px",
                        borderBottom: "1px solid var(--border)",
                        minWidth:    col.w ?? 100,
                        background:  col.gold ? "rgba(201,169,110,0.06)" : undefined,
                        borderLeft:  col.gold ? "2px solid rgba(201,169,110,0.4)" : undefined,
                        cursor:      col.editable ? "text" : "default",
                        position:    "relative",
                      }}>
                      {isEditing ? (
                        col.options ? (
                          <select
                            autoFocus
                            defaultValue={val}
                            onChange={e  => commitEdit(ri, col.id, e.target.value)}
                            onBlur={e    => commitEdit(ri, col.id, e.target.value)}
                            style={{
                              width: "100%", height: 34, padding: "4px 8px",
                              border: "2px solid var(--gold)", borderRadius: 4,
                              fontFamily: "Heebo,sans-serif", fontSize: 13, outline: "none",
                            }}
                          >
                            {col.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            autoFocus
                            defaultValue={val}
                            onBlur={e    => commitEdit(ri, col.id, e.target.value)}
                            onKeyDown={e => handleKeyDown(e, ri, col.id)}
                            style={{
                              width: "100%", height: 34, padding: "4px 12px",
                              border: `2px solid ${col.gold ? "var(--gold)" : "#6366f1"}`,
                              borderRadius: 4, boxSizing: "border-box",
                              fontFamily: "Heebo,sans-serif", fontSize: 13, outline: "none",
                              background: col.gold ? "rgba(201,169,110,0.1)" : "#fff",
                            }}
                          />
                        )
                      ) : col.gold && !val ? (
                        <span style={{ color: "var(--gold)", fontStyle: "italic", fontSize: 12, opacity: 0.7 }}>
                          הוסף שם חדר...
                        </span>
                      ) : (
                        <span style={{
                          display: "block",
                          fontWeight: col.gold && val ? 700 : undefined,
                          color:     col.gold && val ? "var(--gold-dark)" : undefined,
                          direction: col.id === "phone" ? "ltr" : undefined,
                          textAlign: col.id === "phone" ? "right" : undefined,
                        }}>
                          {col.id === "phone" && val
                            ? String(val).replace(/^972/, "0")
                            : (val || "—")}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §6  BULK EDIT BAR
// ══════════════════════════════════════════════════════════════════════════════

function BulkEditBar({ count, columns, onReplace, onClear }) {
  const editableCols    = columns.filter(c => c.editable);
  const [col,    setCol]    = useState(editableCols[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [repl,   setRepl]   = useState("");

  const apply = () => {
    if (!col) return;
    onReplace(col, search, repl);
    setSearch(""); setRepl("");
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      background: "linear-gradient(135deg,rgba(201,169,110,0.15),rgba(201,169,110,0.04))",
      border: "1px solid var(--gold)", borderRadius: 10, padding: "10px 14px", marginBottom: 10,
    }}>
      <span style={{ fontWeight: 800, fontSize: 13, color: "var(--gold-dark)", whiteSpace: "nowrap" }}>
        ✏️ {count} שורות
      </span>
      <select value={col} onChange={e => setCol(e.target.value)}
        style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid var(--border)", fontFamily: "Heebo,sans-serif", fontSize: 13, background: "#fff" }}>
        {editableCols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <input placeholder="חפש טקסט..." value={search} onChange={e => setSearch(e.target.value)}
        onKeyDown={e => e.key === "Enter" && apply()}
        style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid var(--border)", fontFamily: "Heebo,sans-serif", fontSize: 13, width: 140, background: "#fff" }} />
      <span style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1 }}>→</span>
      <input placeholder="החלף ב..." value={repl} onChange={e => setRepl(e.target.value)}
        onKeyDown={e => e.key === "Enter" && apply()}
        style={{ padding: "7px 10px", borderRadius: 7, border: "1.5px solid var(--border)", fontFamily: "Heebo,sans-serif", fontSize: 13, width: 140, background: "#fff" }} />
      <button onClick={apply}
        style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--gold)", color: "#0F0F0F", fontWeight: 800, fontFamily: "Heebo,sans-serif", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
        החל
      </button>
      <button onClick={onClear}
        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontFamily: "Heebo,sans-serif", fontSize: 13, cursor: "pointer", color: "var(--text-muted)" }}>
        ✕ בטל
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §7  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function DataHub() {
  const [profileKey,  setProfileKey]  = useState(null);
  const [step,        setStep]        = useState("select"); // select | upload | edit | done
  const [rows,        setRows]        = useState([]);
  const [dynCols,     setDynCols]     = useState([]); // shifts: derived from file headers
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [syncing,     setSyncing]     = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [dragging,    setDragging]    = useState(false);
  const [toast,       setToast]       = useState(null);
  const [syncResult,  setSyncResult]  = useState(null);
  const fileRef = useRef();

  const showToast = (text, type = "ok", ms = 4500) => {
    setToast({ text, type });
    setTimeout(() => setToast(null), ms);
  };

  const profileDef = profileKey ? PROFILES[profileKey] : null;
  const columns    = profileKey === "shift_schedule" ? dynCols : (profileDef?.columns ?? []);

  // ── File handler ────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      showToast("קובץ לא נתמך — בחר .xlsx / .xls / .csv", "error"); return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();

      if (profileKey === "daily_arrivals") {
        const parsed = await parseArrivalsFile(buf);
        if (!parsed.length) {
          showToast("לא נמצאו שורות — בדוק שהקובץ הוא דוח EZGO יומי", "error"); return;
        }
        setRows(parsed);

      } else if (profileKey === "shift_schedule") {
        const parsed = await parseShiftFile(buf);
        if (!parsed.length) { showToast("הקובץ ריק", "error"); return; }
        const keys = Object.keys(parsed[0]).filter(k => k !== "_id");
        setDynCols(keys.map(k => ({ id: k, label: String(k), editable: true, w: 120 })));
        setRows(parsed);
      }

      setStep("edit");
    } catch (err) {
      showToast("שגיאה בניתוח: " + err.message, "error");
    } finally {
      setUploading(false);
    }
  }, [profileKey]);

  // ── Bulk replace ────────────────────────────────────────────────────────────
  const handleReplace = (colId, search, replacement) => {
    setRows(prev => prev.map(r => {
      if (!selectedIds.has(r._id)) return r;
      const current = String(r[colId] ?? "");
      const updated = search
        ? current.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement)
        : replacement;
      return { ...r, [colId]: updated };
    }));
  };

  // ── Sync to DB ──────────────────────────────────────────────────────────────
  const handleSync = async () => {
    if (!isSupabaseConfigured || !supabase) { showToast("Supabase לא מוגדר", "error"); return; }
    setSyncing(true);
    try {
      const result = await syncArrivals(rows);
      setSyncResult(result);
      setStep("done");
    } catch (err) {
      showToast("שגיאת סנכרון: " + err.message, "error");
    } finally {
      setSyncing(false);
    }
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = () => {
    exportToExcel(columns, rows, "dream_schedule.xlsx")
      .catch(e => showToast(e.message, "error"));
  };

  // ── Reset ───────────────────────────────────────────────────────────────────
  const reset = () => {
    setProfileKey(null); setStep("select"); setRows([]);
    setDynCols([]); setSelectedIds(new Set()); setSyncResult(null);
  };

  // ── Stats for arrivals ──────────────────────────────────────────────────────
  const stats = profileKey === "daily_arrivals" ? [
    { label: "סוויטות",    val: rows.filter(r => r.room_type === "suite").length,     c: "#7c3aed", bg: "#f3f0ff" },
    { label: "בילוי יומי", val: rows.filter(r => r.room_type === "day_guest").length, c: "#16a34a", bg: "#f0fdf4" },
    { label: "עם ספא",     val: rows.filter(r => r.treatment_time).length,            c: "#0e7490", bg: "#ecfeff" },
    { label: "שויכו חדר",  val: rows.filter(r => r.suite_name).length,               c: "#92400e", bg: "#fef3c7" },
  ] : [];

  return (
    <div style={{ fontFamily: "Heebo,sans-serif" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          padding: "11px 18px", borderRadius: 10, marginBottom: 14, fontSize: 14, fontWeight: 600,
          background: toast.type === "ok" ? "#d1fae5" : "#fee2e2",
          color:      toast.type === "ok" ? "#065f46" : "#991b1b",
          border:     `1px solid ${toast.type === "ok" ? "#6ee7b7" : "#fca5a5"}`,
        }}>
          {toast.text}
        </div>
      )}

      {/* ══ Step 1: Profile Select ═══════════════════════════════════════════ */}
      {step === "select" && (
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            Data Hub
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 28 }}>
            בחר סוג קובץ — ייבוא, עריכה, ואישור לסנכרון
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16, maxWidth: 700 }}>
            {Object.entries(PROFILES).map(([key, p]) => (
              <div key={key}
                onClick={() => { setProfileKey(key); setStep("upload"); }}
                style={{
                  background: "var(--card-bg)", border: "2px solid var(--border)", borderRadius: 18,
                  padding: "26px 22px", cursor: "pointer", transition: "all 0.2s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = "var(--gold)";
                  e.currentTarget.style.boxShadow   = "0 6px 24px rgba(201,169,110,0.18)";
                  e.currentTarget.style.transform    = "translateY(-2px)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow   = "none";
                  e.currentTarget.style.transform    = "none";
                }}
              >
                <div style={{ fontSize: 30, marginBottom: 10 }}>{p.label.slice(0, 2)}</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{p.label.slice(3)}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>{p.hint}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {p.syncable   && <span style={{ padding: "3px 9px", borderRadius: 20, background: "#d1fae5", color: "#065f46", fontSize: 11, fontWeight: 700 }}>✓ סנכרון ל-DB</span>}
                  {p.exportable && <span style={{ padding: "3px 9px", borderRadius: 20, background: "#eff6ff", color: "#1e40af", fontSize: 11, fontWeight: 700 }}>↓ ייצוא Excel</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ Step 2: Upload ═══════════════════════════════════════════════════ */}
      {step === "upload" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <button onClick={reset}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-muted)", lineHeight: 1, padding: 0 }}>
              ←
            </button>
            <span style={{ fontWeight: 800, fontSize: 18 }}>{profileDef?.label}</span>
          </div>

          {uploading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "24px", background: "#f0fdf4", borderRadius: 14, border: "1px solid #86efac" }}>
              <div style={{ width: 22, height: 22, border: "3px solid #86efac", borderTop: "3px solid #16a34a", borderRadius: "50%", animation: "di-spin 0.8s linear infinite", flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: "#15803d", fontSize: 14 }}>מנתח קובץ...</span>
            </div>
          ) : (
            <div
              onDragOver={e  => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e  => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? "var(--gold-dark)" : "var(--gold)"}`,
                borderRadius: 18, padding: "56px 24px",
                textAlign: "center", cursor: "pointer",
                background: dragging ? "rgba(201,169,110,0.1)" : "rgba(201,169,110,0.03)",
                transition: "all 0.2s",
              }}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <div style={{ fontSize: 44, marginBottom: 14 }}>{dragging ? "📂" : "📊"}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>גרור קובץ לכאן</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
                או לחץ לבחירת .xlsx / .xls / .csv
              </div>
              <div style={{ fontSize: 12, color: "var(--gold)", fontStyle: "italic" }}>{profileDef?.hint}</div>
            </div>
          )}
        </div>
      )}

      {/* ══ Step 3: Edit Grid ════════════════════════════════════════════════ */}
      {step === "edit" && rows.length > 0 && (
        <div>
          {/* Header bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <button onClick={() => setStep("upload")}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-muted)", lineHeight: 1, padding: 0 }}>
              ←
            </button>
            <span style={{ fontWeight: 800, fontSize: 18 }}>{profileDef?.label}</span>
            <span style={{
              padding: "4px 12px", background: "var(--ivory)", borderRadius: 20,
              fontSize: 12, color: "var(--text-muted)", border: "1px solid var(--border)",
            }}>
              {rows.length} שורות
            </span>
            {selectedIds.size > 0 && (
              <span style={{ padding: "4px 12px", background: "rgba(201,169,110,0.15)", borderRadius: 20, fontSize: 12, color: "var(--gold-dark)", fontWeight: 700 }}>
                {selectedIds.size} נבחרו
              </span>
            )}

            {/* Action buttons */}
            <div style={{ marginRight: "auto", display: "flex", gap: 8 }}>
              {profileDef?.exportable && (
                <button onClick={handleExport}
                  style={{
                    padding: "9px 18px", borderRadius: 9,
                    border: "1.5px solid #1e40af", background: "#eff6ff", color: "#1e40af",
                    fontFamily: "Heebo,sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}>
                  📥 ייצוא Excel
                </button>
              )}
              {profileDef?.syncable && (
                <button onClick={handleSync} disabled={syncing}
                  style={{
                    padding: "9px 22px", borderRadius: 9, border: "none",
                    background: syncing ? "var(--border)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                    color: syncing ? "var(--text-muted)" : "#0F0F0F",
                    fontFamily: "Heebo,sans-serif", fontSize: 13, fontWeight: 800,
                    cursor: syncing ? "not-allowed" : "pointer",
                    transition: "all 0.2s",
                  }}>
                  {syncing ? "⏳ מסנכרן..." : "✅ אשר וסנכרן ל-DB"}
                </button>
              )}
            </div>
          </div>

          {/* Stats bar (arrivals only) */}
          {stats.length > 0 && (
            <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              {stats.map(({ label, val, c, bg }) => (
                <div key={label} style={{ background: bg, borderRadius: 10, padding: "8px 14px", border: `1px solid ${c}22`, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: c, lineHeight: 1 }}>{val}</span>
                  <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>{label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Bulk edit bar (visible when rows selected) */}
          {selectedIds.size > 0 && (
            <BulkEditBar
              count={selectedIds.size}
              columns={columns}
              onReplace={handleReplace}
              onClear={() => setSelectedIds(new Set())}
            />
          )}

          {/* The grid */}
          <EditableGrid
            columns={columns}
            rows={rows}
            onRowsChange={setRows}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />

          {/* Keyboard hint */}
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 14 }}>
            <span>Tab — עמודה הבאה</span>
            <span>Enter — אשר עריכה</span>
            <span>Esc — בטל</span>
          </div>
        </div>
      )}

      {/* ══ Step 4: Done ═════════════════════════════════════════════════════ */}
      {step === "done" && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>הנתונים עודכנו בהצלחה</div>
          {syncResult && (
            <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 6 }}>
              {syncResult.bookings} הזמנות ·  {syncResult.guests} אורחים נטענו למערכת
            </div>
          )}
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 30 }}>
            אורחים עם שם חדר מוכנים לזרימת ה-WhatsApp
          </div>
          <button onClick={reset}
            style={{
              padding: "13px 32px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg,var(--gold),var(--gold-dark))",
              color: "#0F0F0F", fontFamily: "Heebo,sans-serif", fontSize: 14,
              fontWeight: 800, cursor: "pointer",
            }}>
            ייבוא נוסף
          </button>
        </div>
      )}
    </div>
  );
}
