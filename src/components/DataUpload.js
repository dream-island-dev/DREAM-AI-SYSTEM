// src/components/DataUpload.js
// Dual-purpose responsive Excel/CSV upload engine.
// Parses Daily Check-Ins (Guests) OR Staff Shifts client-side (SheetJS),
// previews + auto-maps columns, then writes to Supabase.
// Works from smartphone (file picker) and desktop (drag-drop).
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
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
  if (/^\d{4}[-\/]\d{2}[-\/]\d{2}/.test(s)) {
    return s.slice(0, 10).replace(/\//g, "-");
  }
  // ── Form 3: Israeli — DD/MM/YYYY, DD.MM.YYYY, or DD-MM-YYYY ──
  const dmy = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
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
 * Normalises room-type strings to a standard value.
 * Recognises Hebrew and English suite / deluxe / standard variants.
 * Falls back to the raw value (lowercased) so non-standard types are preserved.
 */
function normalizeRoomType(raw) {
  const s = String(raw ?? "");
  if (/suite|סוויט|junior suite|penthouse|פנטהאוז|presidential|vip/i.test(s)) return "suite";
  if (/deluxe|דלוקס/i.test(s)) return "deluxe";
  if (/standard|סטנדרט|classic|קלאסי|basic/i.test(s)) return "standard";
  const n = s.trim().toLowerCase();
  return n || "standard";
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

const TARGETS = {
  guests: {
    label: "🛎️ צ'ק-אין אורחים",
    table: "guests",
    required: ["name"],
    aliases: {
      name:         ["name", "שם", "שם אורח", "שם מלא", "guest", "guest name", "אורח"],
      phone:        ["phone", "טלפון", "נייד", "mobile", "phone number", "מספר טלפון"],
      room:         ["room", "חדר", "מספר חדר", "room number", "room no"],
      room_type:    ["room_type", "type", "סוג", "סוג חדר", "roomtype", "קטגוריה"],
      arrival_date: ["arrival_date", "arrival", "date", "תאריך", "תאריך הגעה", "check-in", "checkin", "הגעה", "ת. התחלה", "התחלה"],
    },
    transform: (r) => ({
      name: r.name,
      phone: r.phone ?? null,
      room: r.room ?? null,
      room_type: /suite|סוויט/i.test(String(r.room_type ?? "")) ? "suite" : "standard",
      arrival_date: r.arrival_date ? String(r.arrival_date).slice(0, 10) : null,
      status: "expected",
    }),
    insert: (rows) => supabase.from("guests").insert(rows), // identity id
  },
  ezgo: {
    label: "🏨 EZGO — הגעות VIP",
    table: "guests",
    required: ["name"],
    // ── Column aliases ──────────────────────────────────────────────────────
    // Each array is tried left-to-right against the normalised header string.
    // Hebrew aliases are listed first (most likely in EZGO exports).
    // English aliases follow for systems configured in English.
    aliases: {
      name: [
        // Hebrew
        "שם אורח", "שם מלא", "שם", "אורח", "שם האורח", "שם לקוח",
        // English
        "full name", "guest name", "guest", "name", "client name",
        "customer name", "customer",
      ],
      phone: [
        // Hebrew
        "טלפון", "נייד", "טלפון נייד", "מספר טלפון", "מס׳ טלפון",
        // English
        "phone", "mobile", "cell", "phone number", "mobile number",
        "telephone", "tel",
      ],
      room_type: [
        // Hebrew
        "סוג חדר", "סוג", "קטגוריה", "חבילה", "חדר", "סוויטה", "חדר סוויטה",
        // English
        "room type", "type", "room", "suite", "category", "package",
        "accommodation type", "room category",
      ],
      room: [
        // Hebrew
        "מספר חדר", "חדר מס׳", "#חדר", "מס חדר", "מס׳ חדר", "מספר",
        // English
        "room number", "room no", "room #", "room num", "unit", "unit number",
      ],
      arrival_date: [
        // Hebrew — EZGO exports "ת. התחלה" (start date = arrival date)
        "תאריך הגעה", "הגעה", "תאריך", "תאריך צ׳ק אין", "צ׳ק אין", "תאריך כניסה",
        "ת. התחלה", "ת׳ התחלה", "התחלה", "ת.התחלה",
        // English
        "arrival date", "arrival", "check in", "check-in", "checkin",
        "check in date", "arrival_date", "date", "in date",
      ],
      email: [
        // Hebrew
        "דואר אלקטרוני", "אימייל", "מייל", "ד״א", "דוא״ל",
        // English
        "email", "e-mail", "mail", "email address",
      ],
      notes: [
        // Hebrew
        "הערות", "הערה", "בקשות מיוחדות", "הנחיות",
        // English
        "notes", "note", "special requests", "requests", "remarks", "comments",
      ],
    },
    transform: (r) => ({
      name:         String(r.name ?? "").trim(),
      phone:        sanitizePhone(r.phone),
      email:        r.email ? String(r.email).trim().toLowerCase() : null,
      room:         r.room  ? String(r.room).trim()  : null,
      room_type:    normalizeRoomType(r.room_type),
      arrival_date: parseEzgoDate(r.arrival_date),
      notes:        r.notes ? String(r.notes).trim() : null,
      status:       "expected",
      // msg_* flags default FALSE via DB column defaults.
      // manager_id is auto-stamped by the set_guests_manager_id BEFORE INSERT trigger.
    }),
    insert: (rows) => supabase.from("guests").insert(rows),
  },

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

export default function DataUpload({ onImported, user }) {
  const [mode, setMode]               = useState("guests");
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

  const target = TARGETS[mode];

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

  // Map raw rows → target columns
  const colMap = mapHeaders(target.aliases, headers);
  const mappedRows = rawRows
    .map((r) => {
      const o = {};
      for (const col of Object.keys(target.aliases)) o[col] = colMap[col] ? r[colMap[col]] : null;
      return o;
    })
    .filter((r) => target.required.every((req) => r[req] != null && String(r[req]).trim() !== ""));

  const missingRequired = target.required.filter((req) => !colMap[req]);

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

      {/* Mode selector */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {Object.entries(TARGETS).map(([k, t]) => (
          <button key={k} onClick={() => { setMode(k); setRawRows([]); setHeaders([]); setFileName(""); }}
            style={{
              flex: "1 1 160px", padding: "14px 18px", borderRadius: 12, cursor: "pointer",
              fontFamily: "Heebo, sans-serif", fontSize: 15, fontWeight: 700,
              border: `2px solid ${mode === k ? "var(--gold)" : "var(--border)"}`,
              background: mode === k ? "rgba(201,169,110,0.1)" : "var(--card-bg)",
              color: "var(--black)",
            }}>
            {mode === k ? "✓ " : ""}{t.label}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
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
      </div>

      {/* Preview */}
      {rawRows.length > 0 && (
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
