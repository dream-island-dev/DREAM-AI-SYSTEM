// src/components/DataUpload.js
// Dual-purpose responsive Excel/CSV upload engine.
// Parses Daily Check-Ins (Guests) OR Staff Shifts client-side (SheetJS),
// previews + auto-maps columns, then writes to Supabase.
// Works from smartphone (file picker) and desktop (drag-drop).
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import SpaScheduleUploader from "./SpaScheduleUploader";
// NOTE: xlsx (SheetJS) is large (~110KB gz). It is lazy-loaded on first parse
// via dynamic import() so it never bloats the initial mobile bundle.

// Normalise a header/alias string for fuzzy matching:
//   1. lowercase + trim
//   2. strip everything that is not ASCII alphanumeric OR Hebrew Unicode (U+0590–U+05FF)
//      • removes spaces, dashes, slashes, apostrophes, geresh (׳), dots …
//      • preserves Hebrew letters so Hebrew aliases still resolve
// Both sides of every alias comparison go through this function, so
// "room type" ↔ "roomtype", "שם אורח" ↔ "שםאורח", "check-in" ↔ "checkin" all match.
const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿]/g, "");

// ── EZGO-specific parsing helpers ─────────────────────────────────────────────

/**
 * Parses a date value from an EZGO Excel export into ISO YYYY-MM-DD.
 * Handles four input forms that SheetJS + Israeli PMS systems produce:
 *   1. JS Date object   — SheetJS auto-converts Excel date-formatted cells
 *   2. ISO string       — "2026-06-07" or "2026/06/07"
 *   3. Israeli string   — "07/06/2026" or "07.06.2026" (DD/MM/YYYY)
 *   4. Excel serial     — numeric days-since-1900 (SheetJS raw:true for text cells)
 */
function parseEzgoDate(raw) {
  if (!raw) return null;
  // ── Form 1: JS Date (SheetJS parsed an Excel date-format cell) ──
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  // ── Form 2: ISO — YYYY-MM-DD or YYYY/MM/DD ──
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) {
    return s.slice(0, 10).replace(/\//g, "-");
  }
  // ── Form 3: Israeli — DD/MM/YYYY, DD.MM.YYYY, or DD-MM-YYYY ──
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // ── Form 4: Excel numeric serial (days since 1900-01-00, base-25569 from Unix) ──
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 1000) {
    const d = new Date(Math.round((serial - 25569) * 86_400_000));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Strips formatting from phone numbers and normalises to E.164.
 * Israeli mobile numbers (from EZGO exports) come in two forms:
 *   • 9 digits starting with 5  → 506489150  → +972506489150
 *   • 10 digits starting with 05 → 0506489150 → +972506489150
 * Meta WhatsApp Cloud API requires E.164 format for all sends.
 * Returns null when the result has fewer than 9 digits.
 */
function sanitizePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  // Already E.164
  if (cleaned.startsWith("+")) return cleaned.length >= 10 ? cleaned : null;
  // Israeli mobile — 9 digits starting with 5 (EZGO strips the leading 0)
  if (/^5\d{8}$/.test(cleaned)) return `+972${cleaned}`;
  // Israeli mobile — 10 digits starting with 05
  if (/^05\d{8}$/.test(cleaned)) return `+972${cleaned.slice(1)}`;
  // Already prefixed with country code 972
  if (cleaned.startsWith("972") && cleaned.length >= 11) return `+${cleaned}`;
  return cleaned.length >= 9 ? cleaned : null;
}

// Phone normalizer for bookings table — stores 972XXXXXXXXX (no leading +)
function normalizePhoneBookings(raw) {
  if (!raw) return null;
  const p = String(raw).replace(/[\s\-().+]/g, "");
  if (!p) return null;
  if (p.startsWith("972") && p.length >= 11) return p;
  if (p.startsWith("0") && p.length === 10) return "972" + p.slice(1);
  if (/^5\d{8}$/.test(p)) return "972" + p;
  return p.length >= 9 ? p : null;
}

// Compute checkout date from arrival + nights
function addNights(arrival_date, nights) {
  if (!arrival_date || !nights) return null;
  const d = new Date(arrival_date);
  d.setDate(d.getDate() + parseInt(nights));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ── Daily Arrivals Parser ─────────────────────────────────────────────────────
// Parses the hotel's daily "ספר הזמנות" Excel format:
//   Col A: Excel date serial (arrival date, first row only)
//   Col B: "BOOKING_ID: [SOURCE - ] GUEST_NAME - PHONE"
//   Col C: Add-ons / extras (spa slots embedded here)
//   Col D: Meal plan (HB etc.)
// Blocks: one booking per section; next row has "N חדרים, N לילות"; extras follow.

const ARRIVALS_SOURCE_RE = /^(Hotel\s+WebSite|Booking\s+Collect|Booking\.com|Booking|Expedia|Hotels\.com)\s*-\s*/i;

function extractSpaFromExtras(block, raw) {
  const clean = String(raw).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const timeM = clean.match(/(\d{1,2}):(\d{2})/);
  if (!timeM) return;
  const time = timeM[1].padStart(2, "0") + ":" + timeM[2];
  if (clean.includes("לקבוצות")) return; // skip group treatments
  let category = null;
  if (clean.includes("לאורחי הסוויטות") || clean.includes("לשובר סוויטה")) category = "suite";
  else if (clean.includes("בחבילה")) category = "day_guest";
  else return; // unrecognized marker
  // Keep earliest time; suite overrides day_guest
  if (!block.spa_time || time < block.spa_time) {
    block.spa_time     = time;
    block.spa_category = category;
  }
  if (category === "suite") block.spa_category = "suite";
}

function parseArrivalsExcel(rows) {
  let arrivalDate = null;
  let current     = null;
  const blocks    = [];

  for (const row of rows) {
    // rows come in header:1 format → plain arrays
    const [c0, c1, c2, c3] = Array.isArray(row) ? row : [];

    // Arrival date: first Excel serial found in col A
    if (!arrivalDate && typeof c0 === "number" && c0 > 40000) {
      arrivalDate = parseEzgoDate(c0); // reuses existing serial→ISO converter
    }

    // New booking block: col B starts with "DIGITS:"
    if (c1 && typeof c1 === "string" && /^\d+:/.test(c1)) {
      if (current) blocks.push(current);

      // Phone: always the LAST token after final " - " (handles intl +972 format)
      const phoneMatch = c1.match(/\s+-\s+([+\d][\d\s\-+]{7,})\s*$/);
      const phone      = phoneMatch ? normalizePhoneBookings(phoneMatch[1]) : null;

      // Name: strip "DIGITS: " prefix + optional source + phone suffix
      const afterId  = c1.replace(/^\d+:\s*/, "");
      const nameRaw  = phoneMatch
        ? afterId.slice(0, afterId.lastIndexOf(phoneMatch[0])).trim()
        : afterId.trim();
      const guestName = nameRaw.replace(ARRIVALS_SOURCE_RE, "").trim() || null;

      current = {
        guest_name:   guestName,
        phone,
        arrival_date: arrivalDate,
        nights:       null,
        rooms:        1,
        meal:         c3 ? String(c3).trim() : null,
        spa_time:     null,
        spa_category: null,
      };

      if (c2) extractSpaFromExtras(current, c2);
      continue;
    }

    if (!current) continue;

    // Rooms / nights metadata row (col B = "N חדרים , N לילות ...")
    if (c1 && typeof c1 === "string" && c1.includes("חדרים")) {
      const rm = c1.match(/(\d+)\s*חדרים/);  if (rm) current.rooms  = parseInt(rm[1]);
      const nm = c1.match(/(\d+)\s*לילות/);  if (nm) current.nights = parseInt(nm[1]);
    }

    // Additional extras lines (more spa slots)
    if (c2) extractSpaFromExtras(current, c2);
  }

  if (current) blocks.push(current);

  // Deduplicate by phone: sum rooms, keep earliest spa time
  const byPhone = {};
  for (const b of blocks) {
    if (!b.phone) continue;
    if (!byPhone[b.phone]) {
      byPhone[b.phone] = { ...b };
    } else {
      const ex = byPhone[b.phone];
      ex.rooms += b.rooms;
      if (b.spa_time && (!ex.spa_time || b.spa_time < ex.spa_time)) {
        ex.spa_time     = b.spa_time;
        ex.spa_category = b.spa_category;
      }
      if (b.spa_category === "suite") ex.spa_category = "suite";
    }
  }

  return Object.values(byPhone);
}

const TARGETS = {
  shifts: {
    label: "🕐 משמרות צוות",
    table: "shifts",
    required: ["employeeName"],
    aliases: {
      employeeName: ["employeename", "name", "שם", "עובד", "שם עובד", "employee"],
      department:   ["department", "מחלקה", "dept"],
      date:         ["date", "תאריך", "יום"],
      start:        ["start", "התחלה", "start time", "שעת התחלה", "from"],
      end:          ["end", "סיום", "end time", "שעת סיום", "to"],
      status:       ["status", "סטטוס", "מצב"],
    },
    transform: (r, i) => ({
      id: Date.now() + i, // shifts.id has no DB default
      employeeName: r.employeeName,
      department: r.department ?? null,
      date: r.date ? String(r.date).slice(0, 10) : null,
      start: r.start ?? null,
      end: r.end ?? null,
      status: r.status || "עתידי",
    }),
    insert: (rows) => supabase.from("shifts").upsert(rows),
  },
};

function mapHeaders(aliases, headers) {
  const map = {};
  for (const [col, al] of Object.entries(aliases)) {
    // Normalise BOTH sides: the raw header from the file AND each alias string.
    // This means "room type" (file) matches "roomtype" (alias), "check-in" matches
    // "checkin", and Hebrew variants with different spacing/punctuation all unify.
    const normAliases = al.map(norm);
    const found = headers.find((h) => normAliases.includes(norm(h)));
    if (found) map[col] = found;
  }
  return map;
}

const DEPT_LABEL = {
  housekeeping: "🛏️ ניקיון וחדרים",
  maintenance:  "🔧 תחזוקה",
  reception:    "🏨 קבלה ופרונט",
  spa:          "💆 ספא ובריאות",
  management:   "📋 ניהול כללי",
};

export default function DataUpload({ onImported, user, lockedMode }) {
  const [mode, setMode]               = useState(lockedMode ?? "arrivals");
  const [rawRows, setRawRows]         = useState([]);
  const [headers, setHeaders]         = useState([]);
  const [fileName, setFileName]       = useState("");
  const [busy, setBusy]               = useState(false);
  const [toast, setToast]             = useState(null);
  const [dragging, setDragging]       = useState(false);
  const [managerDepartment, setManagerDepartment] = useState(null);
  const inputRef = useRef(null);

  // Fetch this manager's department once on mount
  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || !supabase) return;
    supabase
      .from("profiles")
      .select("department")
      .eq("id", user.id)
      .single()
      .then(({ data }) => { if (data?.department) setManagerDepartment(data.department); });
  }, [user?.id]);

  const target = (mode !== "spa" && mode !== "arrivals") ? TARGETS[mode] : null;

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4000); };

  const parseFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx"); // lazy-loaded chunk
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
        if (!rows.length) { showToast("err", "הקובץ ריק או ללא כותרות"); return; }
        setHeaders(Object.keys(rows[0]));
        setRawRows(rows);
      } catch (err) {
        showToast("err", "שגיאה בקריאת הקובץ: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    parseFile(e.dataTransfer.files?.[0]);
  };

  // Map raw rows → target columns (skipped when mode === "spa")
  const colMap = target ? mapHeaders(target.aliases, headers) : {};
  const mappedRows = target
    ? rawRows
        .map((r) => {
          const o = {};
          for (const col of Object.keys(target.aliases)) o[col] = colMap[col] ? r[colMap[col]] : null;
          return o;
        })
        .filter((r) => target.required.every((req) => r[req] != null && String(r[req]).trim() !== ""))
    : [];

  const missingRequired = target ? target.required.filter((req) => !colMap[req]) : [];

  const handleImport = async () => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    if (missingRequired.length) return showToast("err", `חסרות עמודות חובה: ${missingRequired.join(", ")}`);
    if (!mappedRows.length) return showToast("err", "אין שורות תקינות לייבוא");
    setBusy(true);
    try {
      // transform() can throw on malformed dates / unexpected types — caught below
      const payload = mappedRows.map((r, i) => {
        const row = target.transform(r, i);
        // Tag every shift row with the manager's department
        if (mode === "shifts" && managerDepartment) row.department = managerDepartment;
        return row;
      });
      const { error } = await target.insert(payload);
      if (error) { showToast("err", "שגיאה בייבוא: " + error.message); return; }
      showToast("ok", `✅ יובאו ${payload.length} רשומות בהצלחה`);
      setRawRows([]); setHeaders([]); setFileName("");
      onImported?.(mode);
    } catch (err) {
      showToast("err", "שגיאה בייבוא: " + (err?.message ?? String(err)));
    } finally {
      // Guaranteed reset — UI never freezes even if transform() or insert() throws
      setBusy(false);
    }
  };

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* Department badge */}
      {managerDepartment && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16,
          background: "rgba(201,169,110,0.12)", border: "1px solid var(--gold)", borderRadius: 20,
          padding: "6px 14px", fontSize: 13, fontWeight: 700, color: "var(--gold-dark)" }}>
          {DEPT_LABEL[managerDepartment] || managerDepartment}
          <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>מחלקה נוכחית</span>
        </div>
      )}

      {/* Mode selector — hidden when a lockedMode is provided */}
      {!lockedMode && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { key: "arrivals", label: "📅 ייבוא יומי" },
            { key: "spa",      label: "💆 לוח ספא"    },
            { key: "shifts",   label: "🕐 משמרות צוות" },
          ].map(({ key, label }) => (
            <button key={key}
              onClick={() => { setMode(key); setRawRows([]); setHeaders([]); setFileName(""); }}
              style={{
                flex: "1 1 160px", padding: "14px 18px", borderRadius: 12, cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontSize: 15, fontWeight: 700,
                border: `2px solid ${mode === key ? "var(--gold)" : "var(--border)"}`,
                background: mode === key ? "rgba(201,169,110,0.1)" : "var(--card-bg)",
                color: "var(--black)",
              }}>
              {mode === key ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
      )}

      {/* Spa tab — fully self-contained component */}
      {mode === "spa" && <SpaScheduleUploader />}

      {/* Arrivals daily import — self-contained parser */}
      {mode === "arrivals" && <ArrivalsImporter />}

      {/* Drop zone */}
      {mode !== "spa" && mode !== "arrivals" && <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--gold)" : "var(--border)"}`,
          background: dragging ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
          borderRadius: 16, padding: "40px 20px", textAlign: "center", cursor: "pointer",
          transition: "all 0.2s", marginBottom: 20,
        }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📤</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
          {fileName || "גרור קובץ לכאן או לחץ לבחירה"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>תומך ב-Excel ‏(.xlsx/.xls) ו-CSV</div>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => parseFile(e.target.files?.[0])} />
      </div>}

      {/* Preview */}
      {mode !== "spa" && mode !== "arrivals" && rawRows.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">תצוגה מקדימה · {mappedRows.length} שורות תקינות מתוך {rawRows.length}</div>
          </div>
          <div style={{ padding: 16 }}>
            {missingRequired.length > 0 && (
              <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", color: "#C0392B",
                borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
                ⚠️ לא זוהו עמודות חובה: {missingRequired.join(", ")} — בדוק שהכותרות בקובץ תואמות.
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 600 }}>
                <thead><tr>{Object.keys(target.aliases).map((c) => (
                  <th key={c} style={{ color: colMap[c] ? "var(--black)" : "#C0392B" }}>
                    {c}{!colMap[c] && " ✕"}
                  </th>
                ))}</tr></thead>
                <tbody>
                  {mappedRows.slice(0, 8).map((r, i) => (
                    <tr key={i}>{Object.keys(target.aliases).map((c) => (
                      <td key={c} style={{ fontSize: 13 }}>{String(r[c] ?? "—")}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn btn-primary" disabled={busy} onClick={handleImport}
                style={{ minWidth: 180, fontSize: 15, opacity: busy ? 0.6 : 1 }}>
                {busy ? "מייבא..." : `⬆️ ייבא ל-${target.label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Spa-CSV helpers (used only by ArrivalsImporter) ───────────────────────────

const SPA_CSV_ALIASES_AR = {
  phone:          ["sTel", "tel", "טלפון", "phone", "טל"],
  line_status:    ["iLineStatus", "lineStatus", "status", "סטטוס"],
  treatment_time: ["tmStart", "שעה", "שעת טיפול", "שעת התחלה", "time", "hour"],
  treatment_type: ["טיפול", "שם טיפול", "סוג טיפול", "treatment", "treatment type"],
  category:       ["חבילה", "קטגוריה", "סוג", "package", "category"],
  guest_name:     ["sClientName", "שם אורח", "שם מלא", "שם", "לקוח", "guest name", "name"],
};

// Column aliases for EZGO CSV export (named-column format — iOrderId, sClientFullName, sTel1 …).
// Includes sub-item and room columns for suite vs day_guest detection.
const EZGO_CSV_ALIASES = {
  guest_name:    ["sClientFullName", "sClientName", "clientFullName", "שם"],
  phone:         ["sTel1", "sTel", "phone", "טלפון"],
  nights:        ["iNights", "nights", "לילות"],
  arrival_date:  ["dCheckIn", "dArrival", "dtCheckIn", "checkIn", "תאריך הגעה"],
  rooms:         ["iRooms", "iRoomCount", "rooms", "חדרים"],
  sub_item_name: ["sSubItemName", "subItemName"],
  room_name:     ["sRoomName", "roomName"],
  group_id:      ["Group_Id", "groupId"],
};

// Parse EZGO named-column CSV into guest objects with category and room detection.
// arrivalDate (ISO string) is the fallback when the file has no valid date column
// (extracted from filename, e.g. "16.6.26.csv" → "2026-06-16").
function parseEzgoCsvFull(rows, arrivalDate) {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const colMap  = mapHeaders(EZGO_CSV_ALIASES, headers);

  const byPhone = {};
  for (const r of rows) {
    const guestName   = colMap.guest_name    ? String(r[colMap.guest_name]    ?? "").trim() || null : null;
    const phoneRaw    = colMap.phone         ? String(r[colMap.phone]         ?? "").trim()          : "";
    const phone       = normalizePhoneBookings(phoneRaw);
    const nights      = colMap.nights        ? parseInt(String(r[colMap.nights]        ?? "0")) || 0  : 0;
    const rooms       = colMap.rooms         ? parseInt(String(r[colMap.rooms]         ?? "1")) || 1  : 1;
    const roomName    = colMap.room_name     ? String(r[colMap.room_name]     ?? "").trim() || null  : null;
    const subItemName = colMap.sub_item_name ? String(r[colMap.sub_item_name] ?? "").trim()           : "";
    const groupId     = colMap.group_id      ? String(r[colMap.group_id]      ?? "").trim()           : "";

    if (!phone && !guestName) continue;

    // Arrival date: use filename fallback; ignore EZGO dummy dates (01/01/2001)
    const rawDate = colMap.arrival_date ? String(r[colMap.arrival_date] ?? "").trim() : "";
    let rowDate = arrivalDate;
    if (rawDate && !/^01[/.-]01[/.-](1900|1970|2001)/i.test(rawDate)) {
      const parsed = parseEzgoDate(rawDate);
      if (parsed && parsed > "2020-01-01") rowDate = parsed;
    }

    // Category: day_guest when sSubItemName contains "Day"/"Premium" OR iNights=0 OR Group_Id=1
    let category = "suite";
    if (/premium\s*day|day\s*guest|בילוי.*יומי/i.test(subItemName) || nights === 0 || groupId === "1") {
      category = "day_guest";
    }

    const key = phone ?? guestName;
    if (!key) continue;

    if (!byPhone[key]) {
      byPhone[key] = { guest_name: guestName, phone, arrival_date: rowDate, nights, rooms: rooms || 1, room: roomName, category };
    } else {
      byPhone[key].rooms += (rooms || 1);
      if (category === "suite") byPhone[key].category = "suite";
    }
  }
  return Object.values(byPhone);
}

// Convert Excel time serial / JS Date / "HH:MM" strings → "HH:MM".
function normSpaTime(raw) {
  if (!raw && raw !== 0) return null;
  if (typeof raw === "number" && raw >= 0 && raw < 1) {
    const tot = Math.round(raw * 24 * 60);
    return `${String(Math.floor(tot / 60)).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
  }
  if (raw instanceof Date && !isNaN(raw.getTime()))
    return `${String(raw.getHours()).padStart(2, "0")}:${String(raw.getMinutes()).padStart(2, "0")}`;
  const s = String(raw).trim();
  const m = s.match(/(\d{1,2})[:.h](\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const d = s.replace(/\D/g, "");
  if (d.length === 3) return `0${d[0]}:${d.slice(1)}`;
  if (d.length === 4) return `${d.slice(0, 2)}:${d.slice(2)}`;
  return null;
}

// ── ArrivalsImporter — 2-tab daily import ────────────────────────────────────
// Tab 1 — EZGO: upload CSV/Excel → preview → INSERT to guests + bookings
// Tab 2 — Spa:  upload Spa CSV → UPDATE guests.spa_time by E.164 phone (no new rows)
function ArrivalsImporter() {
  const [activeTab,    setActiveTab]    = useState("ezgo");    // "ezgo" | "spa"

  // EZGO state
  const [ezgoStep,     setEzgoStep]     = useState("upload");  // "upload" | "preview" | "done"
  const [ezgoParsed,   setEzgoParsed]   = useState([]);
  const [ezgoDragging, setEzgoDragging] = useState(false);
  const [ezgoBusy,     setEzgoBusy]     = useState(false);
  const [ezgoResult,   setEzgoResult]   = useState(null);
  const ezgoRef = useRef(null);

  // Spa state
  const [spaUpdates,   setSpaUpdates]   = useState([]);        // [{phone, spa_time}]
  const [spaFileName,  setSpaFileName]  = useState("");
  const [spaDragging,  setSpaDragging]  = useState(false);
  const [spaBusy,      setSpaBusy]      = useState(false);
  const [spaResult,    setSpaResult]    = useState(null);
  const spaRef = useRef(null);

  const [toast, setToast] = useState(null);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  // ── Tab 1: Parse EZGO CSV or Excel ─────────────────────────────────────────
  const handleEzgoFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];

      const firstRow = (XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 })[0] ?? []);
      const isEzgoCsv = firstRow.some(
        (h) => typeof h === "string" && /^(iOrderId|sClientFullName|sTel1)$/i.test(h.trim())
      );

      let data;
      if (isEzgoCsv) {
        const csvRows = XLSX.utils.sheet_to_json(ws, { defval: null });
        const dm = file.name.match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})/);
        const fallbackDate = dm
          ? `${dm[3].length === 2 ? `20${dm[3]}` : dm[3]}-${dm[2].padStart(2,"0")}-${dm[1].padStart(2,"0")}`
          : null;
        data = parseEzgoCsvFull(csvRows, fallbackDate);
      } else {
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 });
        data = parseArrivalsExcel(rows);
      }

      if (!data.length) {
        showToast("err", "לא נמצאו הזמנות — בדוק פורמט קובץ");
        return;
      }
      setEzgoParsed(data);
      setEzgoStep("preview");
    } catch (err) {
      showToast("err", "שגיאה בקריאת קובץ EZGO: " + err.message);
    }
  }, []);

  // ── Tab 2: Parse Spa CSV → extract earliest {phone E.164, spa_time} per guest ──
  const handleSpaFile = useCallback(async (file) => {
    if (!file) return;
    setSpaFileName(file.name);
    setSpaResult(null);
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (!rawRows.length) { showToast("err", "קובץ הספא ריק"); return; }

      const hdrs   = Object.keys(rawRows[0]);
      const colMap = mapHeaders(SPA_CSV_ALIASES_AR, hdrs);

      // Index by E.164 phone; keep earliest tmStart (iLineStatus=1 only)
      const byPhone = {};
      for (const r of rawRows) {
        const statusVal = colMap.line_status ? String(r[colMap.line_status] ?? "").trim() : null;
        if (statusVal !== null && statusVal !== "1") continue;

        const rawTel = colMap.phone ? String(r[colMap.phone] ?? "").trim() : "";
        if (!rawTel) continue;
        const phone = sanitizePhone(rawTel); // E.164 "+972XXXXXXXXX"
        if (!phone) continue;

        const time = colMap.treatment_time ? normSpaTime(r[colMap.treatment_time]) : null;
        if (!time) continue;

        if (!byPhone[phone] || time < byPhone[phone]) byPhone[phone] = time;
      }

      const rows = Object.entries(byPhone).map(([phone, spa_time]) => ({ phone, spa_time }));
      if (!rows.length) {
        showToast("err", "לא נמצאו טיפולים פעילים (iLineStatus=1) עם טלפון ושעה");
        return;
      }
      setSpaUpdates(rows);
      showToast("ok", `💆 ${rows.length} אורחים ייחודיים זוהו`);
    } catch (err) {
      showToast("err", "שגיאה בקריאת קובץ ספא: " + err.message);
    }
  }, []);

  // ── Tab 1 DB Sync: upsert parsed EZGO data ─────────────────────────────────
  const handleEzgoSync = async () => {
    if (!supabase) { showToast("err", "Supabase לא מחובר"); return; }
    setEzgoBusy(true);
    try {
      const bookingRows = ezgoParsed
        .filter((g) => g.phone && g.arrival_date)
        .map((g) => ({
          guest_name:     g.guest_name,
          phone:          g.phone,                            // 972XXXXXXXXX (no +)
          arrival_date:   g.arrival_date,
          checkout_date:  addNights(g.arrival_date, g.nights),
          nights:         g.nights,
          room_count:     g.rooms,
          status:         "pending",
          treatment_time: null,
          treatment_type: null,
        }));

      if (bookingRows.length) {
        const { error: bErr } = await supabase
          .from("bookings")
          .upsert(bookingRows, { onConflict: "phone,arrival_date", ignoreDuplicates: false });
        if (bErr) throw new Error("bookings: " + bErr.message);
      }

      const guestRows = ezgoParsed
        .filter((g) => g.guest_name && g.phone && g.arrival_date)
        .map((g) => ({
          name:           g.guest_name,
          phone:          sanitizePhone(g.phone),             // E.164 "+972XXXXXXXXX"
          arrival_date:   g.arrival_date,
          departure_date: addNights(g.arrival_date, g.nights),
          room_type:      g.category === "suite" ? "suite" : "standard",
          room:           g.room ?? null,
          status:         "pending",
          guest_index:    1,
          spa_time:       null,
        }));

      if (guestRows.length) {
        const { error: gErr } = await supabase
          .from("guests")
          .upsert(guestRows, { onConflict: "phone,arrival_date,guest_index", ignoreDuplicates: false });
        if (gErr) throw new Error("guests: " + gErr.message);
      }

      const suites = ezgoParsed.filter((g) => g.category === "suite").length;
      const days   = ezgoParsed.filter((g) => g.category === "day_guest").length;
      setEzgoResult({ total: guestRows.length, suites, days, date: ezgoParsed[0]?.arrival_date });
      setEzgoStep("done");
    } catch (err) {
      showToast("err", "שגיאה בסנכרון: " + err.message);
    } finally {
      setEzgoBusy(false);
    }
  };

  // ── Tab 2 DB Sync: UPDATE guests.spa_time by phone (NO new guest rows) ─────
  const handleSpaSync = async () => {
    if (!supabase) { showToast("err", "Supabase לא מחובר"); return; }
    setSpaBusy(true);
    let matched = 0, missed = 0;
    try {
      for (const { phone, spa_time } of spaUpdates) {
        const { data, error } = await supabase
          .from("guests")
          .update({ spa_time })
          .eq("phone", phone)
          .select("id");
        if (error) { console.warn("[spa sync]", phone, error.message); missed++; }
        else if (!data?.length) missed++;
        else matched += data.length;
      }
      setSpaResult({ matched, missed, total: spaUpdates.length });
    } catch (err) {
      showToast("err", "שגיאה בעדכון ספא: " + err.message);
    } finally {
      setSpaBusy(false);
    }
  };

  const ToastEl = toast && (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
      padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
      color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
      border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
    }}>{toast.msg}</div>
  );

  return (
    <div>
      {ToastEl}

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { key: "ezgo", label: "📅 הזמנות EZGO" },
          { key: "spa",  label: "💆 עדכון ספא"   },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{
            flex: "1 1 160px", padding: "14px 18px", borderRadius: 12, cursor: "pointer",
            fontFamily: "Heebo, sans-serif", fontSize: 15, fontWeight: 700,
            border: `2px solid ${activeTab === key ? "var(--gold)" : "var(--border)"}`,
            background: activeTab === key ? "rgba(201,169,110,0.1)" : "var(--card-bg)",
            color: "var(--black)",
          }}>
            {activeTab === key ? "✓ " : ""}{label}
          </button>
        ))}
      </div>

      {/* ══════════ TAB 1: EZGO ══════════ */}
      {activeTab === "ezgo" && (
        <>
          {/* Upload step */}
          {ezgoStep === "upload" && (
            <div
              onDragOver={(e) => { e.preventDefault(); setEzgoDragging(true); }}
              onDragLeave={() => setEzgoDragging(false)}
              onDrop={(e) => { e.preventDefault(); setEzgoDragging(false); handleEzgoFile(e.dataTransfer.files?.[0]); }}
              onClick={() => ezgoRef.current?.click()}
              style={{
                border: `2px dashed ${ezgoDragging ? "var(--gold)" : "var(--border)"}`,
                background: ezgoDragging ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
                borderRadius: 16, padding: "44px 20px", textAlign: "center", cursor: "pointer",
                transition: "all 0.2s",
              }}>
              <input ref={ezgoRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && handleEzgoFile(e.target.files[0])} />
              <div style={{ fontSize: 44, marginBottom: 10 }}>📅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
                גרור קובץ EZGO לכאן או לחץ לבחירה
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
                CSV או Excel מ-EZGO · מזהה אוטומטי סוויטות vs בילוי יומי · תאריך מתוך שם הקובץ
              </div>
              <div style={{ display: "inline-flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
                <span>🏨 סוויטות</span><span>☀️ בילוי יומי</span><span>📱 מוכן לבוט</span>
              </div>
            </div>
          )}

          {/* Preview step */}
          {ezgoStep === "preview" && (
            <>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
                <strong>{ezgoParsed.length}</strong> הזמנות ·
                🏨 {ezgoParsed.filter((g) => g.category === "suite").length} סוויטות ·
                ☀️ {ezgoParsed.filter((g) => g.category === "day_guest").length} בילוי יומי ·
                תאריך: <strong>{ezgoParsed[0]?.arrival_date ?? "—"}</strong>
              </div>

              <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10,
                overflow: "hidden", marginBottom: 14 }}>
                <div style={{ overflowX: "auto", maxHeight: 360 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                    <thead>
                      <tr style={{ background: "var(--ivory)" }}>
                        {["שם", "טלפון", "חדר", "סוג", "לילות", "הגעה"].map((h) => (
                          <th key={h} style={{ padding: "9px 12px", fontSize: 11, color: "var(--text-muted)",
                            fontWeight: 700, textAlign: "right", borderBottom: "1px solid var(--border)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ezgoParsed.slice(0, 80).map((g, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{g.guest_name || "—"}</td>
                          <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--text-muted)",
                            direction: "ltr", textAlign: "right" }}>
                            {g.phone ? "0" + String(g.phone).slice(3) : "—"}
                          </td>
                          <td style={{ padding: "9px 12px", fontSize: 12 }}>{g.room ?? "—"}</td>
                          <td style={{ padding: "9px 12px", fontSize: 12 }}>
                            {g.category === "suite" ? "🏨 סוויטה" : g.category === "day_guest" ? "☀️ יומי" : "—"}
                          </td>
                          <td style={{ padding: "9px 12px", fontSize: 12 }}>{g.nights ?? "—"}</td>
                          <td style={{ padding: "9px 12px", fontSize: 12 }}>{g.arrival_date ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ezgoParsed.length > 80 && (
                  <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                    ועוד {ezgoParsed.length - 80} שורות...
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={handleEzgoSync} disabled={ezgoBusy} style={{
                  flex: 1, padding: "13px", borderRadius: 10, border: "none",
                  background: ezgoBusy ? "var(--border)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                  color: ezgoBusy ? "var(--text-muted)" : "#0F0F0F",
                  fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                  cursor: ezgoBusy ? "not-allowed" : "pointer",
                }}>
                  {ezgoBusy ? "מייבא..." : `⚡ ייבא ${ezgoParsed.length} אורחים ל-DB`}
                </button>
                <button onClick={() => { setEzgoStep("upload"); setEzgoParsed([]); }} style={{
                  padding: "13px 18px", borderRadius: 10, border: "1px solid var(--border)",
                  background: "var(--card-bg)", cursor: "pointer",
                  fontFamily: "Heebo, sans-serif", fontSize: 13, color: "var(--text-muted)",
                }}>← חזור</button>
              </div>
            </>
          )}

          {/* Done step */}
          {ezgoStep === "done" && ezgoResult && (
            <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 12, padding: "24px" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#065f46", marginBottom: 6 }}>
                {ezgoResult.total} אורחים יובאו — {ezgoResult.date}
              </div>
              <div style={{ fontSize: 13, color: "#065f46", marginBottom: 16, lineHeight: 1.8 }}>
                🏨 {ezgoResult.suites} סוויטות · ☀️ {ezgoResult.days} בילוי יומי
                <br />עכשיו העלה קובץ פעילות ספא כדי להזריק שעות טיפול
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setActiveTab("spa")} style={{
                  padding: "8px 18px", borderRadius: 8, border: "none",
                  background: "#7c3aed", color: "#fff", cursor: "pointer",
                  fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700 }}>
                  💆 עדכן ספא עכשיו
                </button>
                <button onClick={() => { setEzgoStep("upload"); setEzgoParsed([]); setEzgoResult(null); }} style={{
                  padding: "8px 18px", borderRadius: 8, border: "1px solid #6ee7b7",
                  background: "transparent", color: "#065f46", cursor: "pointer",
                  fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700 }}>
                  ← ייבוא יומי נוסף
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════ TAB 2: SPA ENRICHMENT ══════════ */}
      {activeTab === "spa" && (
        <>
          {/* Info banner */}
          <div style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.2)",
            borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12,
            color: "#5b21b6", lineHeight: 1.7 }}>
            <strong>חשוב:</strong> ייבוא ספא <u>לא יוצר</u> אורחים חדשים.
            הוא מזריק שעת ספא (<code>spa_time</code>) לאורחים שכבר קיימים ב-DB לפי מספר טלפון.
            <br />ייבא קובץ EZGO קודם (טאב שמאל) כדי ליצור רשומות אורחים.
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setSpaDragging(true); }}
            onDragLeave={() => setSpaDragging(false)}
            onDrop={(e) => { e.preventDefault(); setSpaDragging(false); handleSpaFile(e.dataTransfer.files?.[0]); }}
            onClick={() => spaRef.current?.click()}
            style={{
              border: `2px dashed ${spaDragging ? "#7c3aed" : spaFileName ? "rgba(124,58,237,0.5)" : "var(--border)"}`,
              background: spaDragging ? "rgba(124,58,237,0.06)" : spaFileName ? "rgba(124,58,237,0.03)" : "var(--ivory)",
              borderRadius: 16, padding: "36px 20px", textAlign: "center", cursor: "pointer",
              transition: "all 0.2s", marginBottom: 16,
            }}>
            <input ref={spaRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleSpaFile(e.target.files[0])} />
            {spaFileName ? (
              <div style={{ fontSize: 14, fontWeight: 700, color: "#7c3aed" }}>
                💆 {spaFileName}
                <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginTop: 4 }}>
                  {spaUpdates.length} אורחים ייחודיים זוהו · לחץ להחלפה
                </span>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 36, marginBottom: 8 }}>💆</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>
                  גרור קובץ פעילות ספא לכאן
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  CSV מ-EZGO ספא · עמודות: sTel, tmStart, iLineStatus
                </div>
              </>
            )}
          </div>

          {/* Preview spa updates (before sync) */}
          {spaUpdates.length > 0 && !spaResult && (
            <>
              <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10,
                overflow: "hidden", marginBottom: 14 }}>
                <div style={{ overflowX: "auto", maxHeight: 280 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--ivory)" }}>
                        {["טלפון", "שעת ספא"].map((h) => (
                          <th key={h} style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-muted)",
                            fontWeight: 700, textAlign: "right", borderBottom: "1px solid var(--border)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {spaUpdates.slice(0, 50).map(({ phone, spa_time }, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "8px 12px", fontSize: 12,
                            direction: "ltr", textAlign: "right", color: "var(--text-muted)" }}>{phone}</td>
                          <td style={{ padding: "8px 12px", fontSize: 14, fontWeight: 800, color: "#7c3aed" }}>
                            {spa_time}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <button onClick={handleSpaSync} disabled={spaBusy} style={{
                width: "100%", padding: "13px", borderRadius: 10, border: "none",
                background: spaBusy ? "var(--border)" : "#7c3aed",
                color: spaBusy ? "var(--text-muted)" : "#fff",
                fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                cursor: spaBusy ? "not-allowed" : "pointer",
              }}>
                {spaBusy ? "מעדכן..." : `💉 הזרק שעות ספא ל-${spaUpdates.length} אורחים`}
              </button>
            </>
          )}

          {/* Result */}
          {spaResult && (
            <div style={{
              background: spaResult.matched > 0 ? "#d1fae5" : "#FFF0EE",
              border: `1px solid ${spaResult.matched > 0 ? "#6ee7b7" : "#fca5a5"}`,
              borderRadius: 12, padding: "20px",
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{spaResult.matched > 0 ? "✅" : "⚠️"}</div>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8,
                color: spaResult.matched > 0 ? "#065f46" : "#C0392B" }}>
                {spaResult.matched} אורחים עודכנו עם שעת ספא
              </div>
              {spaResult.missed > 0 && (
                <div style={{ fontSize: 12, color: "#92400e", marginBottom: 12 }}>
                  ⚠️ {spaResult.missed} טלפונים לא נמצאו ב-guests
                  {spaResult.matched === 0 ? " — ייבא קובץ EZGO קודם" : ""}
                </div>
              )}
              <button onClick={() => { setSpaUpdates([]); setSpaFileName(""); setSpaResult(null); }} style={{
                padding: "8px 18px", borderRadius: 8, border: "1px solid #6ee7b7",
                background: "transparent", color: "#065f46", cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700 }}>
                ← עדכון ספא נוסף
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
