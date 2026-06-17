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
  guest_name:     ["שם אורח", "שם מלא", "שם", "לקוח", "guest name", "name"],
  treatment_time: ["שעה", "שעת טיפול", "שעת התחלה", "time", "hour"],
  treatment_type: ["טיפול", "שם טיפול", "סוג טיפול", "treatment", "treatment type"],
  category:       ["חבילה", "קטגוריה", "סוג", "package", "category"],
};

// Compact name key for fuzzy matching across EZGO and Spa CSV name formats.
function normNameKey(s) {
  return String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9֐-׿]/g, "");
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

// Derive suite/day_guest category from the Spa CSV "category" / "חבילה" column.
function spaCatFromRaw(raw) {
  const s = String(raw ?? "").toLowerCase();
  if (/סוויט|suite|vip/.test(s))         return "suite";
  if (/יומי|day|בחבילה|package/.test(s)) return "day_guest";
  return null;
}

// Merge spaRows (from the secondary Spa Activities CSV) into EZGO parsed array.
// Matching is done by normalized guest name. Spa CSV data wins over EZGO col-C extraction.
function mergeSpaIntoEzgo(parsed, spaRows) {
  if (!spaRows.length) return parsed;

  // Build primary lookup: exact normalized name → earliest spa entry
  const byExact = {};
  for (const s of spaRows) {
    const key = normNameKey(s.guest_name);
    if (!key) continue;
    if (!byExact[key] || (s.treatment_time && (!byExact[key].treatment_time || s.treatment_time < byExact[key].treatment_time)))
      byExact[key] = s;
  }

  return parsed.map((g) => {
    const gKey = normNameKey(g.guest_name);
    // Exact match first; then partial (one name contains the other — handles flipped order)
    let match = byExact[gKey];
    if (!match) {
      match = spaRows.find((s) => {
        const sKey = normNameKey(s.guest_name);
        return sKey && gKey && (gKey.includes(sKey) || sKey.includes(gKey));
      });
    }
    if (!match) return g;

    const spa_time     = match.treatment_time ?? g.spa_time;
    const rawCat       = spaCatFromRaw(match.category);
    const spa_category = rawCat ?? g.spa_category;
    return { ...g, spa_time, spa_category, spa_from_csv: true };
  });
}

// ── ArrivalsImporter — daily hotel bookings file parser ───────────────────────
// Step 1 (upload): EZGO "ספר הזמנות" Excel + optional "פעילות ספא" CSV.
// Step 2 (preview): merged table grouped by category.
// Step 3 (done): confirmation summary.
function ArrivalsImporter() {
  const [step,        setStep]        = useState("upload"); // upload|preview|done
  const [dragging,    setDragging]    = useState(false);
  const [spaDragging, setSpaDragging] = useState(false);
  const [parsed,      setParsed]      = useState([]);       // EZGO data (possibly merged)
  const [spaRows,     setSpaRows]     = useState([]);       // Spa CSV rows
  const [spaFileName, setSpaFileName] = useState("");
  const [previewTab,  setPreviewTab]  = useState("suite");
  const [busy,        setBusy]        = useState(false);
  const [result,      setResult]      = useState(null);
  const [toast,       setToast]       = useState(null);
  const fileRef    = useRef(null);
  const spaFileRef = useRef(null);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  // ── Derived view lists (recomputed on every render from current parsed) ──
  const suiteGuests = parsed.filter((g) => g.spa_category === "suite");
  const dayGuests   = parsed.filter((g) => g.spa_category === "day_guest");
  const noSpaGuests = parsed.filter((g) => !g.spa_category);
  const previewRows =
    previewTab === "suite" ? suiteGuests :
    previewTab === "day"   ? dayGuests   : noSpaGuests;

  // ── Parse EZGO "ספר הזמנות" Excel ──
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 });
      const data = parseArrivalsExcel(rows);
      if (!data.length) {
        showToast("err", "לא נמצאו הזמנות — בדוק שהקובץ בפורמט ספר ההזמנות היומי");
        return;
      }
      // If a Spa CSV is already loaded, merge immediately
      const merged = spaRows.length ? mergeSpaIntoEzgo(data, spaRows) : data;
      setParsed(merged);
      setPreviewTab(merged.some((g) => g.spa_category === "suite") ? "suite" : "day");
      setStep("preview");
    } catch (err) {
      showToast("err", "שגיאה בקריאת קובץ ההזמנות: " + err.message);
    }
  }, [spaRows]);

  // ── Parse "פעילות ספא" CSV/Excel ──
  const handleSpaFile = useCallback(async (file) => {
    if (!file) return;
    setSpaFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (!rawRows.length) { showToast("err", "קובץ הספא ריק"); return; }

      const hdrs  = Object.keys(rawRows[0]);
      const colMap = mapHeaders(SPA_CSV_ALIASES_AR, hdrs);

      const rows = rawRows
        .map((r) => ({
          guest_name:     colMap.guest_name     ? String(r[colMap.guest_name]     ?? "").trim() || null : null,
          treatment_time: colMap.treatment_time ? normSpaTime(r[colMap.treatment_time])                 : null,
          treatment_type: colMap.treatment_type ? String(r[colMap.treatment_type] ?? "").trim() || null : null,
          category:       colMap.category       ? String(r[colMap.category]       ?? "").trim() || null : null,
        }))
        .filter((r) => r.guest_name && r.treatment_time);

      if (!rows.length) {
        showToast("err", "לא נמצאו שורות תקינות בקובץ הספא — בדוק שעמודות שם ושעה קיימות");
        return;
      }

      setSpaRows(rows);
      // Re-merge if EZGO data is already loaded (preview mode)
      if (parsed.length) {
        const merged = mergeSpaIntoEzgo(parsed, rows);
        setParsed(merged);
      }
      showToast("ok", `💆 ${rows.length} טיפולי ספא נטענו — יתמזגו עם ההזמנות לפי שם אורח`);
    } catch (err) {
      showToast("err", "שגיאה בקריאת קובץ הספא: " + err.message);
    }
  }, [parsed]);

  // ── Sync both tables ──
  const handleSync = async () => {
    if (!supabase) { showToast("err", "Supabase לא מחובר"); return; }
    setBusy(true);
    try {
      // ── 1. bookings — primary EZGO target with spa fields ──────────────────
      const bookingRows = parsed
        .filter((g) => g.phone && g.arrival_date)
        .map((g) => ({
          guest_name:     g.guest_name,
          phone:          g.phone,
          arrival_date:   g.arrival_date,
          checkout_date:  addNights(g.arrival_date, g.nights),
          nights:         g.nights,
          room_count:     g.rooms,
          status:         "pending",
          treatment_time: g.spa_time     ?? null,
          treatment_type: g.spa_category ?? null,
        }));

      const { error: bErr } = await supabase
        .from("bookings")
        .upsert(bookingRows, { onConflict: "phone,arrival_date", ignoreDuplicates: false });
      if (bErr) throw new Error("bookings: " + bErr.message);

      // ── 2. guests — individual suite rows for the WhatsApp pipeline ────────
      // Only guests with ≤ 2 rooms (solo/couple) are written here; group
      // bookings live in bookings only and are handled by the cron directly.
      // onConflict targets the 3-col constraint added by migration 042.
      const guestRows = parsed
        .filter((g) => g.guest_name && g.phone && g.rooms <= 2 && g.arrival_date)
        .map((g) => ({
          name:           g.guest_name,
          phone:          sanitizePhone(g.phone),
          arrival_date:   g.arrival_date,
          departure_date: addNights(g.arrival_date, g.nights),
          room_type:      g.spa_category === "suite" ? "suite" : "standard",
          status:         "pending",
          guest_index:    1,
        }));

      if (guestRows.length) {
        const { error: gErr } = await supabase
          .from("guests")
          .upsert(guestRows, { onConflict: "phone,arrival_date,guest_index", ignoreDuplicates: false });
        if (gErr) throw new Error("guests: " + gErr.message);
      }

      const withSpa = parsed.filter((g) => g.spa_time).length;
      setResult({
        total:   bookingRows.length,
        suite:   suiteGuests.length,
        day:     dayGuests.length,
        withSpa,
        date:    parsed[0]?.arrival_date,
      });
      setStep("done");
    } catch (err) {
      showToast("err", "שגיאה בסנכרון: " + err.message);
    } finally {
      setBusy(false);
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

  // ── Done ──
  if (step === "done" && result) return (
    <div>
      {ToastEl}
      <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 12, padding: "24px" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
        <div style={{ fontWeight: 800, fontSize: 16, color: "#065f46", marginBottom: 6 }}>
          {result.total} הזמנות סונכרנו בהצלחה — {result.date}
        </div>
        <div style={{ fontSize: 13, color: "#065f46", marginBottom: 16, lineHeight: 1.8 }}>
          🏨 {result.suite} סוויטות · ☀️ {result.day} בילוי יומי · 💆 {result.withSpa} עם שעת ספא
          <br />הבוט מוכן לשלוח הודעות אישור
        </div>
        <button
          onClick={() => { setStep("upload"); setParsed([]); setSpaRows([]); setSpaFileName(""); setResult(null); }}
          style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #6ee7b7",
            background: "transparent", color: "#065f46", cursor: "pointer",
            fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700 }}>
          ← ייבוא יומי נוסף
        </button>
      </div>
    </div>
  );

  // ── Preview ──
  if (step === "preview") {
    const spaMergedCount = parsed.filter((g) => g.spa_from_csv).length;
    const TABS = [
      { key: "suite", label: "🏨 סוויטות",   count: suiteGuests.length, color: "#7c3aed" },
      { key: "day",   label: "☀️ בילוי יומי", count: dayGuests.length,   color: "#16a34a" },
      { key: "none",  label: "👥 ללא ספא",    count: noSpaGuests.length,  color: "#888"    },
    ];
    return (
      <div>
        {ToastEl}

        {/* Spa-CSV merge banner */}
        {spaFileName && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
            padding: "8px 14px", borderRadius: 8, background: "rgba(124,58,237,0.07)",
            border: "1px solid rgba(124,58,237,0.25)", fontSize: 12, color: "#7c3aed", fontWeight: 700 }}>
            💆 לוח ספא נטען: {spaFileName}
            {spaMergedCount > 0
              ? <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>· {spaMergedCount} אורחים הותאמו</span>
              : <span style={{ fontWeight: 400, color: "#C0392B" }}> · לא נמצאו התאמות — בדוק שמות</span>}
            <button onClick={() => spaFileRef.current?.click()}
              style={{ marginRight: "auto", fontSize: 11, color: "#7c3aed", background: "none",
                border: "1px solid currentColor", borderRadius: 5, padding: "2px 8px", cursor: "pointer",
                fontFamily: "Heebo, sans-serif" }}>
              החלף קובץ
            </button>
            <input ref={spaFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleSpaFile(e.target.files[0])} />
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          {TABS.map(({ key, label, count, color }) => (
            <button key={key} onClick={() => setPreviewTab(key)}
              style={{
                padding: "10px 18px", borderRadius: 10, cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontWeight: 800, fontSize: 13,
                border: `2px solid ${previewTab === key ? color : "var(--border)"}`,
                background: previewTab === key ? "var(--card-bg)" : "var(--ivory)",
                color: previewTab === key ? color : "var(--text-muted)",
              }}>
              {label} <span style={{ fontSize: 18, marginRight: 4 }}>{count}</span>
            </button>
          ))}
          <div style={{ marginRight: "auto", fontSize: 12, color: "var(--text-muted)", padding: "0 4px" }}>
            סה"כ {parsed.length} הזמנות · תאריך הגעה: <strong>{parsed[0]?.arrival_date}</strong>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10,
          overflow: "hidden", marginBottom: 14 }}>
          <div style={{ overflowX: "auto", maxHeight: 340 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr style={{ background: "var(--ivory)" }}>
                  {["שם", "טלפון", "לילות", "חדרים", "ספא", "שעה"].map((h) => (
                    <th key={h} style={{ padding: "9px 12px", fontSize: 11, color: "var(--text-muted)",
                      fontWeight: 700, textAlign: "right", borderBottom: "1px solid var(--border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 60).map((g, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>
                      {g.guest_name || "—"}
                      {g.spa_from_csv && (
                        <span style={{ fontSize: 9, color: "#7c3aed", marginRight: 4,
                          border: "1px solid #7c3aed", borderRadius: 3, padding: "1px 3px" }}>CSV</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--text-muted)",
                      direction: "ltr", textAlign: "right" }}>
                      {g.phone ? "0" + g.phone.slice(3) : "—"}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{g.nights ?? "—"}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{g.rooms > 1 ? `${g.rooms} 🏢` : g.rooms}</td>
                    <td style={{ padding: "9px 12px", fontSize: 11 }}>
                      {g.spa_category === "suite" ? "🏨" : g.spa_category === "day_guest" ? "☀️" : "—"}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 14, fontWeight: 800,
                      color: g.spa_time ? "#7c3aed" : "var(--text-muted)" }}>
                      {g.spa_time || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewRows.length > 60 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
              ועוד {previewRows.length - 60} שורות...
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSync} disabled={busy} style={{
            flex: 1, padding: "13px", borderRadius: 10, border: "none",
            background: busy ? "var(--border)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
            color: busy ? "var(--text-muted)" : "#0F0F0F",
            fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}>
            {busy ? "מסנכרן..." : `⚡ סנכרן ל-DB (${parsed.length} הזמנות)`}
          </button>
          <button onClick={() => setStep("upload")} style={{
            padding: "13px 18px", borderRadius: 10, border: "1px solid var(--border)",
            background: "var(--card-bg)", cursor: "pointer",
            fontFamily: "Heebo, sans-serif", fontSize: 13, color: "var(--text-muted)",
          }}>← חזור</button>
        </div>
      </div>
    );
  }

  // ── Upload step: EZGO drop zone + optional Spa CSV drop zone ──
  return (
    <div>
      {ToastEl}

      {/* ── Primary: EZGO "ספר הזמנות" ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--gold)" : "var(--border)"}`,
          background: dragging ? "rgba(201,169,110,0.08)" : "var(--card-bg)",
          borderRadius: 16, padding: "44px 20px", textAlign: "center", cursor: "pointer",
          transition: "all 0.2s", marginBottom: 14,
        }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <div style={{ fontSize: 44, marginBottom: 10 }}>📅</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
          גרור ספר הזמנות יומי לכאן
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
          קובץ יומי מ-EZGO (.xlsx/.xls) · שם, טלפון, לילות, שעת ספא מעמודת התוספות
        </div>
        <div style={{ display: "inline-flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
          <span>🏨 סוויטות</span><span>☀️ בילוי יומי</span><span>📱 מוכן לבוט</span>
        </div>
      </div>

      {/* ── Secondary: "פעילות ספא" CSV (optional) ── */}
      <div
        onDragOver={(e) => { e.preventDefault(); setSpaDragging(true); }}
        onDragLeave={() => setSpaDragging(false)}
        onDrop={(e) => { e.preventDefault(); setSpaDragging(false); handleSpaFile(e.dataTransfer.files?.[0]); }}
        onClick={() => spaFileRef.current?.click()}
        style={{
          border: `2px dashed ${spaDragging ? "#7c3aed" : spaFileName ? "rgba(124,58,237,0.5)" : "var(--border)"}`,
          background: spaDragging
            ? "rgba(124,58,237,0.06)"
            : spaFileName ? "rgba(124,58,237,0.03)" : "var(--ivory)",
          borderRadius: 12, padding: "20px", textAlign: "center", cursor: "pointer",
          transition: "all 0.2s",
        }}>
        <input ref={spaFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleSpaFile(e.target.files[0])} />
        {spaFileName ? (
          <div style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>
            💆 {spaFileName}
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginRight: 8 }}>
              · {spaRows.length} טיפולים טעונים · לחץ להחלפה
            </span>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 22, marginBottom: 6 }}>💆</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>
              הוסף לוח פעילות ספא <span style={{ fontWeight: 400 }}>(אופציונלי)</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              CSV/Excel עם שם אורח + שעת טיפול · יתמזג עם ההזמנות לפי שם
            </div>
          </>
        )}
      </div>
    </div>
  );
}
