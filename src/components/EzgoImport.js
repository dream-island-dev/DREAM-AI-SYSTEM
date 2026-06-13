// src/components/EzgoImport.js
// Deterministic EZGO Excel parser — strict column map, zero AI guessing.
import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Canonical EZGO column → field map ────────────────────────────────────────
// Covers every known variant exported by EZGO / Israeli hotel PMS systems.
// Matching is case-insensitive, whitespace-normalised.
const COL_MAP = {
  // Guest name
  "שם אורח":     "guest_name",
  "שם המזמין":   "guest_name",
  "שם הלקוח":   "guest_name",
  "שם":          "guest_name",
  "אורח":        "guest_name",
  "לקוח":        "guest_name",
  "name":        "guest_name",
  "guest name":  "guest_name",
  "guest":       "guest_name",

  // Phone
  "טלפון":        "phone",
  "נייד":         "phone",
  "טלפון נייד":  "phone",
  "מספר טלפון":  "phone",
  "phone":        "phone",
  "mobile":       "phone",
  "cell":         "phone",
  "tel":          "phone",

  // Arrival date
  "תאריך כניסה":    "arrival_date",
  "תאריך הגעה":     "arrival_date",
  "תאריך":          "arrival_date",
  "הגעה":           "arrival_date",
  "כניסה":          "arrival_date",
  "arrival":        "arrival_date",
  "arrival date":   "arrival_date",
  "check-in":       "arrival_date",
  "checkin":        "arrival_date",
  "check in":       "arrival_date",
  "תאריך צ'ק אין": "arrival_date",
  "צ'ק אין":        "arrival_date",

  // Balance / amount
  "יתרה":              "amount",
  "יתרה לתשלום":       "amount",
  'סה"כ לתשלום':      "amount",
  'סה"כ':             "amount",
  "סכום":              "amount",
  "מחיר":              "amount",
  "לתשלום":            "amount",
  "balance":           "amount",
  "balance owed":      "amount",
  "amount":            "amount",
  "total":             "amount",
  "price":             "amount",
};

const REQUIRED_FIELDS = ["guest_name", "phone", "arrival_date"];
const FIELD_LABELS    = { guest_name: "שם אורח", phone: "טלפון", arrival_date: "תאריך הגעה" };

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (raw == null) return "";
  let p = String(raw).replace(/[\s\-().‏+]/g, "");
  if (p.startsWith("972")) return p;
  if (p.startsWith("0"))   return "972" + p.slice(1);
  return p;
}

function parseExcelDate(raw) {
  if (raw == null || raw === "") return null;
  // SheetJS serial number (cellDates: false keeps them as numbers)
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  const s = String(raw).trim();
  // DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function normalizeKey(raw) {
  return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Supabase upsert (mock-safe) ───────────────────────────────────────────────
async function upsertToBookings(rows) {
  if (!isSupabaseConfigured) {
    await new Promise((r) => setTimeout(r, 700)); // simulate latency
    return { count: rows.length, error: null };
  }
  const payload = rows.map((r) => ({
    guest_name:          r.guest_name,
    phone:               r.phone,
    arrival_date:        r.arrival_date,
    amount:              r.amount ?? null,
    confirmation_status: "pending",
    payment_status:      "pending",
  }));
  const { error } = await supabase
    .from("bookings")
    .upsert(payload, { onConflict: "phone,arrival_date", ignoreDuplicates: false });
  return { count: payload.length, error: error ?? null };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function EzgoImport({ onImported }) {
  const [rows,      setRows]      = useState([]);
  const [parseErr,  setParseErr]  = useState("");
  const [warnMsg,   setWarnMsg]   = useState("");
  const [fileName,  setFileName]  = useState("");
  const [uploading, setUploading] = useState(false);
  const [done,      setDone]      = useState(null); // { count }
  const inputRef = useRef(null);

  // ── Parse EZGO Excel ──────────────────────────────────────────────────────
  function processFile(file) {
    if (!file) return;
    setParseErr(""); setWarnMsg(""); setRows([]); setDone(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(e.target.result, { type: "array", cellDates: false });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (raw.length < 2) {
          setParseErr("הגיליון ריק — נדרשת שורת כותרות ולפחות שורת נתונים אחת");
          return;
        }

        // Find the first row that matches ≥ 2 known columns (max first 10 rows)
        let headerRowIdx = -1;
        let colMap       = {}; // { colIndex → fieldName }

        for (let ri = 0; ri < Math.min(10, raw.length); ri++) {
          const candidate = {};
          for (let ci = 0; ci < raw[ri].length; ci++) {
            const key = normalizeKey(raw[ri][ci]);
            if (COL_MAP[key]) candidate[ci] = COL_MAP[key];
          }
          if (Object.keys(candidate).length >= 2) {
            headerRowIdx = ri;
            colMap       = candidate;
            break;
          }
        }

        if (headerRowIdx === -1) {
          setParseErr(
            "לא זוהו עמודות EZGO בגיליון.\n" +
            "ודאו שהגיליון מכיל לפחות: שם אורח, טלפון, תאריך כניסה"
          );
          return;
        }

        // Check required fields exist
        const foundFields = new Set(Object.values(colMap));
        const missing     = REQUIRED_FIELDS.filter((f) => !foundFields.has(f));
        if (missing.length) {
          setParseErr(`חסרות עמודות חובה: ${missing.map((f) => FIELD_LABELS[f]).join(", ")}`);
          return;
        }

        // Parse data rows
        const parsed    = [];
        const rowErrors = [];

        for (let ri = headerRowIdx + 1; ri < raw.length; ri++) {
          const row = raw[ri];
          if (row.every((c) => String(c).trim() === "")) continue; // blank row

          const obj = {};
          for (const [ci, field] of Object.entries(colMap)) {
            obj[field] = row[Number(ci)];
          }

          const name  = String(obj.guest_name ?? "").trim();
          const phone = normalizePhone(obj.phone);
          const date  = parseExcelDate(obj.arrival_date);

          const lineErrs = [];
          if (!name)             lineErrs.push("שם ריק");
          if (phone.length < 10) lineErrs.push(`טלפון לא תקין: "${obj.phone}"`);
          if (!date)             lineErrs.push(`תאריך לא תקין: "${obj.arrival_date}"`);

          if (lineErrs.length) {
            rowErrors.push(`שורה ${ri + 1}: ${lineErrs.join(" | ")}`);
            continue;
          }

          let amount = null;
          if (obj.amount != null && obj.amount !== "") {
            amount = parseFloat(String(obj.amount).replace(/[^\d.]/g, "")) || null;
          }

          parsed.push({ guest_name: name, phone, arrival_date: date, amount });
        }

        if (!parsed.length) {
          setParseErr(
            "לא נמצאו שורות תקינות לייבוא.\n" +
            (rowErrors.length ? rowErrors.slice(0, 5).join("\n") : "")
          );
          return;
        }

        if (rowErrors.length) {
          setWarnMsg(
            `${rowErrors.length} שורות דולגו בשל נתונים חסרים:\n` +
            rowErrors.slice(0, 3).join("\n") +
            (rowErrors.length > 3 ? `\n...ועוד ${rowErrors.length - 3}` : "")
          );
        }

        setRows(parsed);
      } catch (ex) {
        setParseErr(`שגיאת קריאת קובץ: ${ex.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleInputChange(e) {
    processFile(e.target.files?.[0]);
    e.target.value = "";
  }

  function handleDrop(e) {
    e.preventDefault();
    processFile(e.dataTransfer.files?.[0]);
  }

  async function handleConfirmUpload() {
    if (!rows.length || uploading) return;
    setUploading(true);
    const { count, error } = await upsertToBookings(rows);
    setUploading(false);
    if (error) {
      setParseErr(`שגיאת Supabase: ${error.message}`);
    } else {
      setDone({ count });
      setRows([]);
      onImported?.();
    }
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div dir="rtl" style={{ textAlign: "center", padding: "44px 20px" }}>
        <div style={{ fontSize: 52, marginBottom: 14 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#1A7A4A", marginBottom: 8 }}>
          {done.count} הזמנות עלו בהצלחה
        </div>
        <div style={{ fontSize: 13, color: "#8A7A6A", marginBottom: 28 }}>
          עכשיו ניתן לשלוח הודעות WhatsApp מלשונית "הזמנות"
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => { setDone(null); setFileName(""); setParseErr(""); setWarnMsg(""); }}
        >
          ← ייבוא נוסף
        </button>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div dir="rtl">

      {/* Drop-zone (hidden after file loaded) */}
      {!rows.length && (
        <>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            style={{
              border: "2px dashed #C9A96E",
              borderRadius: 14,
              padding: "38px 24px",
              textAlign: "center",
              cursor: "pointer",
              background: "rgba(201,169,110,0.04)",
              transition: "background 0.2s",
              marginBottom: 16,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,169,110,0.09)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(201,169,110,0.04)")}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleInputChange}
            />
            <div style={{ fontSize: 42, marginBottom: 10 }}>📊</div>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#A8843A", marginBottom: 6 }}>
              {fileName
                ? `✓ ${fileName} — לא נמצאו שורות תקינות`
                : "גרור קובץ EZGO לכאן, או לחץ לבחירה"}
            </div>
            <div style={{ fontSize: 12, color: "#8A7A6A" }}>
              Excel מיוצא מ-EZGO ‏(.xlsx / .xls) — הגיליון הראשון
            </div>
          </div>

          {/* Column-map legend */}
          <div style={{
            background: "rgba(201,169,110,0.06)",
            border: "1px solid rgba(201,169,110,0.2)",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 12,
            color: "#7A6A50",
            lineHeight: 1.9,
          }}>
            <strong style={{ display: "block", marginBottom: 4, color: "#A8843A" }}>
              מיפוי קנוני — ללא ניחושי AI
            </strong>
            <div>🏷 <strong>שם אורח:</strong> שם אורח / שם המזמין / שם הלקוח / Guest Name</div>
            <div>📞 <strong>טלפון:</strong> טלפון / נייד / טלפון נייד / Phone / Mobile</div>
            <div>📅 <strong>תאריך הגעה:</strong> תאריך כניסה / תאריך הגעה / Check-in / Arrival Date</div>
            <div>💰 <strong>יתרה לתשלום:</strong> יתרה / יתרה לתשלום / סה"כ / Balance / Amount</div>
          </div>
        </>
      )}

      {/* Parse error */}
      {parseErr && (
        <div style={{
          padding: "12px 16px",
          background: "rgba(192,57,43,0.07)",
          border: "1px solid rgba(192,57,43,0.2)",
          borderRadius: 10,
          color: "#C0392B",
          fontSize: 13,
          whiteSpace: "pre-line",
          marginTop: 14,
        }}>
          ❌ {parseErr}
        </div>
      )}

      {/* Row-level warnings (non-fatal) */}
      {warnMsg && (
        <div style={{
          padding: "10px 16px",
          background: "rgba(184,134,11,0.07)",
          border: "1px solid rgba(184,134,11,0.25)",
          borderRadius: 10,
          color: "#8B6914",
          fontSize: 12,
          whiteSpace: "pre-line",
          marginBottom: 14,
        }}>
          ⚠️ {warnMsg}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1A1A" }}>
              תצוגה מקדימה — <span style={{ color: "#1A7A4A" }}>{rows.length} שורות</span>
              <span style={{ color: "#8A7A6A", fontWeight: 400, fontSize: 12, marginRight: 8 }}>
                · {fileName}
              </span>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setRows([]); setParseErr(""); setWarnMsg(""); setFileName(""); }}
            >
              ✕ ביטול
            </button>
          </div>

          <div style={{
            overflowX: "auto",
            borderRadius: 12,
            border: "1px solid #E0D5C5",
            maxHeight: 340,
            overflowY: "auto",
            marginBottom: 18,
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{
                  background: "#FAF6EE",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  borderBottom: "2px solid #E0D5C5",
                }}>
                  {["#", "שם אורח", "טלפון", "תאריך הגעה", "יתרה לתשלום"].map((h) => (
                    <th key={h} style={{
                      padding: "10px 14px",
                      textAlign: "right",
                      fontWeight: 700,
                      color: "#1A1A1A",
                      whiteSpace: "nowrap",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{
                    borderBottom: "1px solid #F5F0E8",
                    background: i % 2 === 0 ? "#fff" : "#FDFBF7",
                  }}>
                    <td style={{ padding: "9px 14px", color: "#8A7A6A", fontSize: 11, width: 36 }}>
                      {i + 1}
                    </td>
                    <td style={{ padding: "9px 14px", fontWeight: 600 }}>
                      {r.guest_name}
                    </td>
                    <td style={{
                      padding: "9px 14px",
                      direction: "ltr",
                      textAlign: "right",
                      color: "#555",
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}>
                      +{r.phone}
                    </td>
                    <td style={{ padding: "9px 14px", fontWeight: 600, color: "#1B3A32" }}>
                      {formatDate(r.arrival_date)}
                    </td>
                    <td style={{
                      padding: "9px 14px",
                      fontWeight: r.amount ? 700 : 400,
                      color: r.amount ? "#1A7A4A" : "#8A7A6A",
                    }}>
                      {r.amount != null ? `₪${Number(r.amount).toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Confirm & Upload CTA */}
          <div style={{
            display: "flex",
            gap: 12,
            justifyContent: "flex-end",
            alignItems: "center",
          }}>
            {!isSupabaseConfigured && (
              <span style={{ fontSize: 11, color: "#8A7A6A" }}>
                מצב דמו — הנתונים לא יישמרו
              </span>
            )}
            <button
              className="btn btn-primary"
              style={{ minWidth: 220, fontSize: 14, fontWeight: 800, padding: "13px 24px" }}
              onClick={handleConfirmUpload}
              disabled={uploading}
            >
              {uploading
                ? "מעלה..."
                : `אשר והעלה למערכת (${rows.length} הזמנות)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
