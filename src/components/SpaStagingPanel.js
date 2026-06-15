import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// PDF.js CDN loader (lazy — only fetched when user triggers import)
// ─────────────────────────────────────────────────────────────────────────────
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error("Failed to load pdf.js from CDN"));
    document.head.appendChild(s);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF table extraction helpers
// ─────────────────────────────────────────────────────────────────────────────
function clusterByY(items, tol = 5) {
  const clusters = [];
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    const found = clusters.find((c) => Math.abs(c.cy - item.y) <= tol);
    if (found) {
      found.items.push(item);
    } else {
      clusters.push({ cy: item.y, items: [item] });
    }
  }
  return clusters.map((c) => ({
    cells: c.items.sort((a, b) => a.x - b.x),
    text: c.items.map((i) => i.text).join(" "),
  }));
}

function normalizePhone(raw) {
  const p = String(raw).replace(/[\s\-().+]/g, "");
  if (p.startsWith("972") && p.length >= 11) return p;
  if (p.startsWith("0") && p.length === 10) return "972" + p.slice(1);
  if (/^5\d{8}$/.test(p)) return "972" + p;
  return p;
}

const SUITE_MARKER      = "לאורחי הסוויטות";
const PHONE_CELL_RE     = /^(\+?972|0)\d{8,9}$/;

// ── Excel import helpers ──────────────────────────────────────────────────────

function normalizeTimeVal(raw) {
  if (!raw && raw !== 0) return null;
  // Excel time serial: fraction of a day (e.g. 0.375 = 09:00)
  if (typeof raw === "number" && raw >= 0 && raw < 1) {
    const totalMin = Math.round(raw * 24 * 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${String(raw.getHours()).padStart(2, "0")}:${String(raw.getMinutes()).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  const m = s.match(/(\d{1,2})[:.h](\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 3) return `0${digits[0]}:${digits.slice(1)}`;
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return null;
}
// ── Combined Daily Report parser (stateful) ───────────────────────────────────
// Handles EZGO combined format: columns 'הזמנה' (booking string with phone)
// and 'תוספות' (extras with embedded spa time).
//
// KEY CHALLENGE: phone is on the BOOKING row, but spa time may be on the NEXT row.
// Uses a state machine — currentPhone/currentName persist across iterations.
//
// Booking format:  "267135: פרי טורס - 0522822548"  or  "דיין חיים - 0507834236"
// Tosafot format:  "2 - 15:00 - טיפול 45 דקות לאורחי הסוויטות"
const PHONE_IN_BOOKING_RE = /(0[5-9]\d[-\s]?\d{3}[-\s]?\d{4}|0[5-9]\d{8}|\+972[5-9]\d{8}|972[5-9]\d{8})/;
const TIME_IN_TOSAFOT_RE  = /\b(\d{1,2}:\d{2})\b/;

function parseCombinedReport(rows) {
  const byPhone    = {};
  let currentPhone = null;
  let currentName  = null;

  for (const row of rows) {
    // Clean all hidden EZGO whitespace (\xa0 = non-breaking space is common)
    const cleanBooking = String(row["הזמנה"] ?? "")
      .replace(/[\r\n\t\xa0]+/g, " ").replace(/\s+/g, " ").trim();
    const cleanTosafot = String(row["תוספות"] ?? "")
      .replace(/[\r\n\t\xa0]+/g, " ").replace(/\s+/g, " ").trim();

    // ── Step 1: extract phone from booking cell → update context ──────────────
    const phoneMatch = cleanBooking.match(PHONE_IN_BOOKING_RE);
    if (phoneMatch) {
      currentPhone = normalizePhone(phoneMatch[1]);
      // Name = everything before the phone number, strip booking-ID prefix "12345: "
      const beforePhone = cleanBooking
        .slice(0, cleanBooking.indexOf(phoneMatch[1]))
        .replace(/\s*[-–]\s*$/, "")
        .trim();
      currentName = beforePhone.replace(/^\d+:\s*/, "").trim() || null;
    }

    // ── Step 2: check tosafot for spa time + category ─────────────────────────
    if (!cleanTosafot || cleanTosafot === "null") continue;

    const timeMatch = cleanTosafot.match(TIME_IN_TOSAFOT_RE);
    if (!timeMatch) continue; // no time → not a spa row

    const rawTime = timeMatch[1];
    // Ensure HH:MM (pad single-digit hour)
    const time = rawTime.includes(":") && rawTime.length === 4 ? `0${rawTime}` : rawTime;

    // Categorize by marker phrases
    let category;
    if (
      cleanTosafot.includes("לאורחי הסוויטות") ||
      cleanTosafot.includes("סוויט") ||
      cleanTosafot.includes("לשובר")
    ) {
      category = "suite";
    } else if (
      cleanTosafot.includes("בחבילה") ||
      cleanTosafot.includes("מוזל") ||
      cleanTosafot.includes("לאורחי היום")
    ) {
      category = "day_guest";
    } else {
      console.log("[parseCombinedReport] unrecognized tosafot:", cleanTosafot.slice(0, 80));
      continue;
    }

    if (!currentPhone) continue; // no phone context yet

    // Treatment description: strip leading "N - HH:MM - " prefix if present
    const afterTime = cleanTosafot.replace(/^\d+\s*[-–]\s*\d{1,2}:\d{2}\s*[-–]\s*/, "").trim();
    const treatmentType = afterTime || cleanTosafot;

    if (!byPhone[currentPhone]) {
      byPhone[currentPhone] = {
        phone: currentPhone,
        treatment_time: time,
        treatment_type: treatmentType,
        guest_name: currentName,
        raw_extras: cleanTosafot,
        category,
        room: null,
        arrival_date: null,
      };
    } else {
      // Multiple spa rows for same phone: keep earliest time; suite overrides day_guest
      if (time < byPhone[currentPhone].treatment_time) {
        byPhone[currentPhone].treatment_time = time;
      }
      if (category === "suite") byPhone[currentPhone].category = "suite";
    }
  }

  const all = Object.values(byPhone);
  return {
    suite: all.filter((r) => r.category === "suite"),
    day:   all.filter((r) => r.category === "day_guest"),
  };
}

// ── EZGO Spa CSV parser ───────────────────────────────────────────────────────
// Dispatcher: detects format from column names, then delegates to the right parser.
// — EZGO isolated spa schedule: columns tmStart / sTel / sExtraDesc
// — EZGO combined daily report:  columns הזמנה / תוספות
// Deduplicates by phone (earliest time wins). Skips groups + cancelled rows.
// EZGO cells contain embedded \r\n within the phrase — aggressive cleaning required.
function parseEzgoSpa(rows) {
  if (!rows.length) return { suite: [], day: [] };

  // Route to combined-report parser when header columns match
  if ("הזמנה" in rows[0] || "תוספות" in rows[0]) {
    return parseCombinedReport(rows);
  }

  const isEzgo = "tmStart" in rows[0] || "sTel" in rows[0];
  const byPhone  = {};
  const unmatched = [];

  for (const row of rows) {
    // Skip cancelled (iLineStatus = "0")
    const status = String(isEzgo ? (row.iLineStatus ?? "1") : "1").trim();
    if (status === "0") continue;

    // AGGRESSIVE CLEANING: strip \r \n \t, collapse multiple spaces
    const extraRaw   = String(row.sExtraDesc ?? "");
    const cleanExtra = extraRaw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

    // Categorize — fuzzy: phrase may be split across lines in raw cell
    let category;
    if (cleanExtra.includes("לאורחי הסוויטות")) category = "suite";
    else if (cleanExtra.includes("לקבוצות"))       continue; // skip groups
    else if (cleanExtra.includes("בחבילה"))         category = "day_guest";
    else {
      // Track rows that had phone+time but no recognized category marker
      const dbgPhone = isEzgo ? row.sTel : null;
      const dbgTime  = isEzgo ? row.tmStart : null;
      if (dbgPhone && dbgTime) unmatched.push({ phone: dbgPhone, time: dbgTime, extra: cleanExtra });
      continue;
    }

    const rawPhone = isEzgo ? row.sTel : null;
    const phone    = normalizePhone(rawPhone ?? "");
    if (!phone) continue;

    const rawTime = isEzgo ? row.tmStart : null;
    const time    = normalizeTimeVal(rawTime ?? "");
    if (!time) continue;

    // Extract booking name from "firstName (BookingName)" pattern
    const clientRaw  = String(isEzgo ? (row.sClientName ?? "") : "").trim();
    const parenMatch = clientRaw.match(/\(([^)]+)\)/);
    const guestName  = parenMatch ? parenMatch[1].trim() : clientRaw.split("(")[0].trim() || null;

    const arrivalDate   = isEzgo ? String(row.dtDate ?? "").trim().slice(0, 10) || null : null;
    const treatmentType = isEzgo ? String(row.sTreatDesc ?? "").trim() || null : null;
    const room          = isEzgo ? String(row.sActivityDesc ?? "").trim() || null : null;

    if (!byPhone[phone]) {
      byPhone[phone] = { phone, treatment_time: time, treatment_type: treatmentType,
        guest_name: guestName, raw_extras: cleanExtra, category, room, arrival_date: arrivalDate };
    } else {
      // Couple sharing phone: keep earliest time; suite overrides day_guest
      if (time < byPhone[phone].treatment_time) byPhone[phone].treatment_time = time;
      if (category === "suite") byPhone[phone].category = "suite";
    }
  }

  if (unmatched.length) {
    console.log("Spa parser — unmatched rows (phone+time present, no category):", unmatched);
  }

  const all = Object.values(byPhone);
  return {
    suite: all.filter((r) => r.category === "suite"),
    day:   all.filter((r) => r.category === "day_guest"),
  };
}

const TIME_RE           = /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/;
const KNOWN_TREATMENTS  = [
  "שוודי", "רקמות עמוק", "עיסוי לנשים הרות", "חמאם", "פילינג",
  "לימפטי", "ארומטרפי", "ארומה", "TIP",
];
const SKIP_CELL_RES     = [/^\d+$/, /^\d{1,2}:\d{2}/, /חדר/, /סוויטת/];

function extractTime(rowText) {
  const m = rowText.match(TIME_RE);
  return m ? m[0].replace(/\s/g, "") : null;
}

function extractPhone(cells) {
  for (const c of cells) {
    const clean = c.text.replace(/[\s\-().+]/g, "");
    if (PHONE_CELL_RE.test(clean)) return normalizePhone(clean);
  }
  return null;
}

function extractTreatmentType(rowText) {
  return KNOWN_TREATMENTS.find((t) => rowText.includes(t)) || null;
}

function extractGuestName(cells) {
  for (const c of cells) {
    const t = c.text.trim();
    if (!t || t.length < 3) continue;
    if (SKIP_CELL_RES.some((re) => re.test(t))) continue;
    if (PHONE_CELL_RE.test(t.replace(/[\s\-().+]/g, ""))) continue;
    if (TIME_RE.test(t)) continue;
    if (t.includes("טיפול") || t.includes("לאורחי") || t.includes("קבוצות")) continue;
    if (KNOWN_TREATMENTS.some((tr) => t.startsWith(tr))) continue;
    if (/[א-ת]/.test(t)) return t; // first cell with Hebrew chars that passes all checks
  }
  return null;
}

async function parsePdfSuiteGuests(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const buf   = await file.arrayBuffer();
  const pdf   = await pdfjs.getDocument({ data: buf }).promise;
  const found = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress(p, pdf.numPages);

    const page = await pdf.getPage(p);
    const vp   = page.getViewport({ scale: 1.0 });
    const tc   = await page.getTextContent();

    const items = tc.items
      .filter((i) => i.str.trim())
      .map((i) => ({
        x:    Math.round(i.transform[4]),
        y:    Math.round(vp.height - i.transform[5]),
        text: i.str.trim(),
      }));

    for (const row of clusterByY(items, 5)) {
      if (!row.text.includes(SUITE_MARKER)) continue;
      found.push({
        treatment_time: extractTime(row.text),
        treatment_type: extractTreatmentType(row.text),
        guest_name:     extractGuestName(row.cells),
        phone:          extractPhone(row.cells),
        raw_extras:     SUITE_MARKER,
      });
    }
  }

  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert parsed rows → spa_staging (with booking lookup)
// ─────────────────────────────────────────────────────────────────────────────
async function insertParsedRows(guests) {
  // Group by phone for shared-phone detection
  const byPhone = new Map();
  for (const g of guests) {
    if (!g.phone) continue;
    if (!byPhone.has(g.phone)) byPhone.set(g.phone, []);
    byPhone.get(g.phone).push(g);
  }

  // Bulk booking lookup
  const phones = [...byPhone.keys()];
  const { data: bookings = [] } = await supabase
    .from("bookings")
    .select("id, phone, guest_name")
    .in("phone", phones);

  const bookingMap = {};
  for (const b of bookings) bookingMap[b.phone] = b;

  const batchId   = crypto.randomUUID();
  const stagingRows = [];

  for (const [phone, entries] of byPhone) {
    const booking       = bookingMap[phone] ?? null;
    const isShared      = entries.length > 1;

    for (const entry of entries) {
      let match_status;
      let suspicious_reason = null;

      if (!booking) {
        match_status = "no_booking";
      } else if (isShared) {
        match_status       = "suspicious";
        suspicious_reason  = `${entries.length} אורחים על אותו טלפון`;
      } else {
        match_status = "matched";
      }

      stagingRows.push({
        import_batch:       batchId,
        treatment_time:     entry.treatment_time ?? null,
        treatment_type:     entry.treatment_type ?? null,
        guest_name:         entry.guest_name ?? (booking?.guest_name ?? null),
        phone,
        raw_extras:         entry.raw_extras,
        matched_booking_id: booking?.id ?? null,
        match_status,
        suspicious_reason,
        sync_status:        "pending",
      });
    }
  }

  const { error } = await supabase.from("spa_staging").insert(stagingRows);
  if (error) throw new Error(error.message);

  const matched    = stagingRows.filter((r) => r.match_status === "matched").length;
  const suspicious = stagingRows.filter((r) => r.match_status === "suspicious").length;
  const no_booking = stagingRows.filter((r) => r.match_status === "no_booking").length;

  return { total: stagingRows.length, matched, suspicious, no_booking, batchId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick-Add modal (for no_booking rows)
// ─────────────────────────────────────────────────────────────────────────────
function QuickAddModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    guest_name:   row.guest_name || "",
    phone:        row.phone      || "",
    arrival_date: new Date().toISOString().slice(0, 10),
    nights:       1,
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");

  const handleSave = async () => {
    if (!form.phone || !form.arrival_date) { setErr("טלפון ותאריך הגעה נדרשים"); return; }
    setSaving(true);
    setErr("");

    const { data, error } = await supabase
      .from("bookings")
      .upsert(
        {
          guest_name:    form.guest_name || null,
          phone:         form.phone,
          arrival_date:  form.arrival_date,
          nights:        form.nights ? parseInt(form.nights) : null,
          treatment_time: row.treatment_time || null,
          treatment_type: row.treatment_type || null,
        },
        { onConflict: "phone,arrival_date", ignoreDuplicates: false }
      )
      .select("id")
      .maybeSingle();

    if (error) { setErr(error.message); setSaving(false); return; }

    await supabase
      .from("spa_staging")
      .update({
        sync_status:        "synced",
        matched_booking_id: data?.id ?? null,
        reviewed_at:        new Date().toISOString(),
      })
      .eq("id", row.id);

    onSaved();
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(15,15,15,0.75)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: "var(--card-bg)", borderRadius: 18, padding: 28,
        width: "100%", maxWidth: 440,
        boxShadow: "0 32px 80px rgba(0,0,0,0.25)", border: "1px solid var(--border)",
      }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          הוספה ידנית
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
          האורח לא נמצא בטבלת ההגעות — הוסף אותו לקישור הטיפול
        </div>
        <div style={{ background: "#f3f0ff", borderRadius: 10, padding: "10px 14px", marginBottom: 20, fontSize: 13 }}>
          <strong>טיפול:</strong> {row.treatment_type || "—"} בשעה {row.treatment_time || "—"}
        </div>
        {[
          { label: "שם אורח",      field: "guest_name",   type: "text",   ph: "שם מלא" },
          { label: "טלפון",        field: "phone",        type: "text",   ph: "972XXXXXXXXX" },
          { label: "תאריך הגעה",   field: "arrival_date", type: "date" },
          { label: "מספר לילות",   field: "nights",       type: "number", ph: "1" },
        ].map(({ label, field, type, ph }) => (
          <div key={field} style={{ marginBottom: 13 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", fontWeight: 700, marginBottom: 4 }}>{label}</label>
            <input type={type} value={form[field]} placeholder={ph}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontFamily: "Heebo,sans-serif", fontSize: 14, outline: "none" }}
            />
          </div>
        ))}
        {err && <div style={{ color: "#c0392b", fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo,sans-serif", fontSize: 13 }}>ביטול</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: saving ? "var(--border)" : "linear-gradient(135deg,var(--gold) 0%,var(--gold-dark) 100%)", color: "#0F0F0F", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "Heebo,sans-serif", fontSize: 13 }}>
            {saving ? "⏳ שומר..." : "✅ הוסף ועדכן טיפול"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Import Drop Zone
// ─────────────────────────────────────────────────────────────────────────────
function PdfImportZone({ onImportDone, onError }) {
  const [dragging,    setDragging]    = useState(false);
  const [parsing,     setParsing]     = useState(false);
  const [progress,    setProgress]    = useState({ page: 0, total: 0 });
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef();

  const handleFile = useCallback(async (file) => {
    if (!file || !file.name.endsWith(".pdf")) { onError("בחר קובץ PDF בלבד"); return; }
    setParsing(true);
    setProgress({ page: 0, total: 0 });
    setImportResult(null);

    try {
      const guests = await parsePdfSuiteGuests(file, (page, total) =>
        setProgress({ page, total })
      );

      if (!guests.length) {
        setParsing(false);
        onError(`לא נמצאו שורות עם "${SUITE_MARKER}" ב-PDF`);
        return;
      }

      const result = await insertParsedRows(guests);
      setImportResult(result);
      onImportDone(result);
    } catch (err) {
      onError(err.message);
    } finally {
      setParsing(false);
    }
  }, [onImportDone, onError]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const pct = progress.total > 0 ? Math.round((progress.page / progress.total) * 100) : 0;

  if (importResult) {
    return (
      <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 24 }}>✅</span>
        <div>
          <div style={{ fontWeight: 700, color: "#065f46", fontSize: 14 }}>
            {importResult.total} שורות נקלטו לאישור
          </div>
          <div style={{ fontSize: 12, color: "#065f46", marginTop: 2 }}>
            {importResult.matched} ירוק · {importResult.suspicious} צהוב · {importResult.no_booking} אדום
          </div>
        </div>
        <button onClick={() => setImportResult(null)} style={{ marginRight: "auto", padding: "6px 14px", borderRadius: 7, border: "1px solid #6ee7b7", background: "transparent", color: "#065f46", cursor: "pointer", fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700 }}>
          ייבוא נוסף
        </button>
      </div>
    );
  }

  if (parsing) {
    return (
      <div style={{ background: "#f3f0ff", border: "1px solid #c4b5fd", borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{ width: 20, height: 20, border: "3px solid #c4b5fd", borderTop: "3px solid #6f42c1", borderRadius: "50%", animation: "di-spin 0.8s linear infinite", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#4a3f7f" }}>
            {progress.total > 0 ? `מנתח עמוד ${progress.page} מתוך ${progress.total}...` : "טוען PDF..."}
          </span>
        </div>
        {progress.total > 0 && (
          <div style={{ height: 6, background: "#ede9fe", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,#7c3aed,#6f42c1)", borderRadius: 4, transition: "width 0.3s" }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => fileRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "#6f42c1" : "#c4b5fd"}`,
        borderRadius: 12,
        background: dragging ? "#f3f0ff" : "#faf9ff",
        padding: "24px 20px",
        textAlign: "center",
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <div style={{ fontSize: 32, marginBottom: 8 }}>{dragging ? "📂" : "📄"}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#4a3f7f", marginBottom: 4 }}>
        גרור לכאן את PDF הפעילויות מ-EZGO
      </div>
      <div style={{ fontSize: 12, color: "#7c6f8e" }}>
        או לחץ לבחירת קובץ · מחפש שורות עם "לאורחי הסוויטות"
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Excel Import Zone — EZGO-aware, 2-step: upload → preview split → stage
// ─────────────────────────────────────────────────────────────────────────────
function ExcelImportZone({ onImportDone, onError }) {
  const [step,     setStep]     = useState("upload"); // "upload" | "preview" | "staging" | "done"
  const [dragging, setDragging] = useState(false);
  const [parsing,  setParsing]  = useState(false);
  const [parsed,   setParsed]   = useState({ suite: [], day: [] });
  const [selected, setSelected] = useState(new Set(["suite", "day_guest"]));
  const [result,   setResult]   = useState(null);
  const [previewTab, setPreviewTab] = useState("suite");
  const fileRef = useRef();

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      onError("בחר קובץ .xlsx / .xls / .csv"); return;
    }
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: "array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (!rows.length) { onError("הקובץ ריק"); return; }

      const parsed = parseEzgoSpa(rows);
      if (!parsed.suite.length && !parsed.day.length) {
        onError("לא נמצאו לקוחות ספא — בדוק שהקובץ מ-EZGO (דוח ספא יומי עם tmStart/sTel, או דוח משולב עם הזמנה/תוספות)"); return;
      }
      setParsed(parsed);
      setPreviewTab(parsed.suite.length ? "suite" : "day");
      setStep("preview");
    } catch (err) {
      onError(err.message);
    } finally {
      setParsing(false);
    }
  }, [onError]);

  const handleStage = async () => {
    const toStage = [
      ...(selected.has("suite")     ? parsed.suite : []),
      ...(selected.has("day_guest") ? parsed.day   : []),
    ];
    if (!toStage.length) { onError("לא נבחרה קטגוריה לייבוא"); return; }
    setStep("staging");
    try {
      const res = await insertParsedRows(toStage);
      setResult(res);
      setStep("done");
      onImportDone(res);
    } catch (err) {
      onError(err.message);
      setStep("preview");
    }
  };

  const toggleCat = (cat) => setSelected((prev) => {
    const s = new Set(prev);
    s.has(cat) ? s.delete(cat) : s.add(cat);
    return s;
  });

  const previewRows = previewTab === "suite" ? parsed.suite : parsed.day;

  // ── Done ──
  if (step === "done" && result) {
    return (
      <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 24 }}>✅</span>
        <div>
          <div style={{ fontWeight: 700, color: "#065f46", fontSize: 14 }}>{result.total} אורחים נשלחו לסקירה</div>
          <div style={{ fontSize: 12, color: "#065f46", marginTop: 2 }}>{result.matched} נמצאו · {result.no_booking} לא ידוע</div>
        </div>
        <button onClick={() => { setStep("upload"); setParsed({ suite: [], day: [] }); setResult(null); }}
          style={{ marginRight: "auto", padding: "6px 14px", borderRadius: 7, border: "1px solid #6ee7b7", background: "transparent", color: "#065f46", cursor: "pointer", fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700 }}>
          ייבוא נוסף
        </button>
      </div>
    );
  }

  // ── Staging spinner ──
  if (step === "staging") {
    return (
      <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "18px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 20, height: 20, border: "3px solid #86efac", borderTop: "3px solid #16a34a", borderRadius: "50%", animation: "di-spin 0.8s linear infinite", flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "#15803d" }}>שולח לסקירה...</span>
      </div>
    );
  }

  // ── Preview step ──
  if (step === "preview") {
    return (
      <div>
        {/* Category selector */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            { key: "suite",     label: `🏨 אורחי סוויטות`, count: parsed.suite.length, color: "#7c3aed", bg: "#f3f0ff" },
            { key: "day_guest", label: `☀️ בילוי יומי`,    count: parsed.day.length,   color: "#16a34a", bg: "#f0fdf4" },
          ].map(({ key, label, count, color, bg }) => (
            <button key={key} onClick={() => toggleCat(key)} style={{
              padding: "10px 18px", borderRadius: 10, cursor: "pointer", fontFamily: "Heebo,sans-serif",
              fontSize: 13, fontWeight: 700, transition: "all 0.15s",
              border: `2px solid ${selected.has(key) ? color : "var(--border)"}`,
              background: selected.has(key) ? bg : "var(--card-bg)",
              color: selected.has(key) ? color : "var(--text-muted)",
            }}>
              {selected.has(key) ? "✓ " : ""}{label} ({count})
            </button>
          ))}
        </div>

        {/* Preview tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[["suite", "🏨 סוויטות"], ["day", "☀️ יומי"]].map(([t, lbl]) => (
            parsed[t].length > 0 && (
              <button key={t} onClick={() => setPreviewTab(t)} style={{
                padding: "5px 14px", borderRadius: 20, border: "none", cursor: "pointer",
                fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
                background: previewTab === t ? "var(--gold)" : "var(--border)",
                color: previewTab === t ? "#0F0F0F" : "var(--text-muted)",
              }}>{lbl} ({parsed[t].length})</button>
            )
          ))}
        </div>

        {/* Preview table */}
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ overflowX: "auto", maxHeight: 260 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
              <thead>
                <tr style={{ background: "var(--ivory)" }}>
                  {["שם (הזמנה)", "טלפון", "שעת טיפול", "סוג טיפול"].map((h) => (
                    <th key={h} style={{ padding: "9px 12px", fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textAlign: "right", borderBottom: "1px solid var(--border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 50).map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600 }}>{r.guest_name || "—"}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--text-muted)", direction: "ltr", textAlign: "right" }}>
                      {r.phone ? r.phone.replace(/^972/, "0") : "—"}
                    </td>
                    <td style={{ padding: "9px 12px", fontSize: 14, fontWeight: 800, color: "#7c3aed" }}>{r.treatment_time}</td>
                    <td style={{ padding: "9px 12px", fontSize: 12 }}>{r.treatment_type || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewRows.length > 50 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
              ועוד {previewRows.length - 50} שורות...
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleStage} disabled={!selected.size}
            style={{
              flex: 1, padding: "12px", borderRadius: 10, border: "none",
              background: selected.size ? "linear-gradient(135deg,var(--gold),var(--gold-dark))" : "var(--border)",
              color: selected.size ? "#0F0F0F" : "var(--text-muted)",
              fontFamily: "Heebo,sans-serif", fontSize: 14, fontWeight: 800, cursor: selected.size ? "pointer" : "not-allowed",
            }}>
            📤 שלח לסקירה ({(selected.has("suite") ? parsed.suite.length : 0) + (selected.has("day_guest") ? parsed.day.length : 0)} אורחים)
          </button>
          <button onClick={() => setStep("upload")}
            style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo,sans-serif", fontSize: 13, color: "var(--text-muted)" }}>
            ← חזור
          </button>
        </div>
      </div>
    );
  }

  // ── Upload drop zone ──
  return (
    <div>
      {parsing ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "18px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 20, height: 20, border: "3px solid #86efac", borderTop: "3px solid #16a34a", borderRadius: "50%", animation: "di-spin 0.8s linear infinite", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#15803d" }}>מנתח קובץ...</span>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#16a34a" : "#86efac"}`,
            borderRadius: 12, background: dragging ? "#f0fdf4" : "#fafffe",
            padding: "28px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.2s",
          }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <div style={{ fontSize: 36, marginBottom: 8 }}>{dragging ? "📂" : "📊"}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d", marginBottom: 4 }}>גרור לוח ספא EZGO לכאן</div>
          <div style={{ fontSize: 12, color: "#4ade80", marginBottom: 6 }}>או לחץ לבחירת קובץ · .xlsx / .xls / .csv</div>
          <div style={{ fontSize: 11, color: "#86efac" }}>
            מזהה אוטומטית: 🏨 אורחי סוויטות · ☀️ בילוי יומי · מסנן קבוצות ומבוטלים
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Panel
// ─────────────────────────────────────────────────────────────────────────────
export default function SpaStagingPanel() {
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [syncing,      setSyncing]      = useState(false);
  const [quickAdd,     setQuickAdd]     = useState(null);
  const [statusMsg,    setStatusMsg]    = useState(null);
  const [filterMode,   setFilterMode]   = useState("pending");
  const [showImport,   setShowImport]   = useState(false);
  const [importMode,   setImportMode]   = useState("pdf"); // "pdf" | "excel"
  const [pendingCount, setPendingCount] = useState(0);

  // ── data fetching ─────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    let query = supabase
      .from("spa_staging")
      .select("*")
      .order("imported_at", { ascending: false });
    if (filterMode === "pending") query = query.in("sync_status", ["pending"]);
    const { data, error } = await query;
    if (!error && data) setRows(data);
    setLoading(false);
  }, [filterMode]);

  const fetchPendingCount = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { count } = await supabase
      .from("spa_staging")
      .select("id", { count: "exact", head: true })
      .eq("sync_status", "pending");
    setPendingCount(count ?? 0);
  }, []);

  useEffect(() => { fetchRows(); fetchPendingCount(); }, [fetchRows, fetchPendingCount]);

  // Realtime — auto-refresh when new rows arrive (email or PDF import)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("spa_staging_changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "spa_staging" }, () => {
        fetchRows();
        fetchPendingCount();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchRows, fetchPendingCount]);

  // ── actions ───────────────────────────────────────────────────────────────
  const flash = (type, text, ms = 4000) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), ms);
  };

  const syncRow = async (row) => {
    if (!row.matched_booking_id) return;
    const { error } = await supabase
      .from("bookings")
      .update({ treatment_time: row.treatment_time, treatment_type: row.treatment_type })
      .eq("id", row.matched_booking_id);
    if (error) { flash("error", `שגיאה: ${error.message}`); return; }
    await supabase.from("spa_staging")
      .update({ sync_status: "synced", reviewed_at: new Date().toISOString() })
      .eq("id", row.id);
    flash("ok", `✅ ${row.guest_name || row.phone} — סונכרן`);
    fetchRows(); fetchPendingCount();
  };

  const rejectRow = async (id) => {
    await supabase.from("spa_staging")
      .update({ sync_status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", id);
    fetchRows(); fetchPendingCount();
  };

  const syncAllGreen = async () => {
    const green = rows.filter((r) => r.match_status === "matched" && r.sync_status === "pending");
    if (!green.length) { flash("warn", "אין שורות ירוקות לסנכרון"); return; }
    setSyncing(true);
    let ok = 0;
    for (const row of green) {
      const { error } = await supabase.from("bookings")
        .update({ treatment_time: row.treatment_time, treatment_type: row.treatment_type })
        .eq("id", row.matched_booking_id);
      if (!error) {
        ok++;
        await supabase.from("spa_staging")
          .update({ sync_status: "synced", reviewed_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }
    setSyncing(false);
    flash("ok", `✅ ${ok} מתוך ${green.length} סונכרנו בהצלחה`, 5000);
    fetchRows(); fetchPendingCount();
  };

  // ── derived counts ────────────────────────────────────────────────────────
  const greenCount = rows.filter((r) => r.match_status === "matched"    && r.sync_status === "pending").length;
  const yellowCount = rows.filter((r) => r.match_status === "suspicious" && r.sync_status === "pending").length;
  const redCount    = rows.filter((r) => r.match_status === "no_booking" && r.sync_status === "pending").length;

  // ── row styling ───────────────────────────────────────────────────────────
  const rowStyle = {
    matched:    { bg: "#d1fae5", label: "✓ נמצא",    lc: "#065f46" },
    suspicious: { bg: "#fef3c7", label: "⚠ משותף",   lc: "#92400e" },
    no_booking: { bg: "#fee2e2", label: "✗ לא קיים", lc: "#991b1b" },
    synced:     { bg: "#eff6ff", label: "✓ סונכרן",  lc: "#1e40af" },
    rejected:   { bg: "#f3f4f6", label: "נדחה",       lc: "#6b7280" },
  };

  return (
    <div>

      {/* ── Import Zone (PDF / Excel toggle) ───────────────────────────── */}
      {showImport && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[["pdf", "📄 PDF"], ["excel", "📊 Excel"]].map(([m, lbl]) => (
                <button key={m} onClick={() => setImportMode(m)} style={{
                  padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer",
                  fontFamily: "Heebo,sans-serif", fontSize: 13, fontWeight: 700,
                  background: importMode === m ? "var(--gold)" : "var(--border)",
                  color: importMode === m ? "#0F0F0F" : "var(--text-muted)",
                  transition: "all 0.2s",
                }}>{lbl}</button>
              ))}
            </div>
            <button onClick={() => setShowImport(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)", lineHeight: 1 }}>✕</button>
          </div>
          {importMode === "pdf" ? (
            <PdfImportZone
              onImportDone={(result) => {
                setShowImport(false);
                flash("ok", `✅ ${result.total} שורות נקלטו — ${result.matched} ירוק · ${result.suspicious} צהוב · ${result.no_booking} אדום`, 6000);
              }}
              onError={(msg) => flash("error", msg)}
            />
          ) : (
            <ExcelImportZone
              onImportDone={(result) => {
                setShowImport(false);
                flash("ok", `✅ ${result.total} שורות נקלטו — ${result.matched} ירוק · ${result.suspicious} צהוב · ${result.no_booking} אדום`, 6000);
              }}
              onError={(msg) => flash("error", msg)}
            />
          )}
        </div>
      )}

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "ממתינים לסנכרון",  value: greenCount,    color: "#065f46", bg: "#d1fae5" },
          { label: "טלפון משותף",      value: yellowCount,   color: "#92400e", bg: "#fef3c7" },
          { label: "לא בהגעות",        value: redCount,      color: "#991b1b", bg: "#fee2e2" },
          { label: "סה״כ ממתין",       value: pendingCount,  color: "var(--gold-dark)", bg: "rgba(201,169,110,0.12)" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{ background: bg, borderRadius: 12, padding: "13px 18px", minWidth: 120, border: `1px solid ${color}22` }}>
            <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 11, color, marginTop: 4, fontWeight: 600 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Status message ───────────────────────────────────────────────── */}
      {statusMsg && (
        <div style={{
          padding: "11px 16px", borderRadius: 10, marginBottom: 14, fontSize: 14, fontWeight: 600,
          background: statusMsg.type === "ok" ? "#d1fae5" : statusMsg.type === "error" ? "#fee2e2" : "#fef3c7",
          color:      statusMsg.type === "ok" ? "#065f46" : statusMsg.type === "error" ? "#991b1b" : "#92400e",
        }}>
          {statusMsg.text}
        </div>
      )}

      {/* ── Action bar ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>

        {/* Import button — PDF or Excel */}
        <button
          onClick={() => { setImportMode("pdf"); setShowImport((v) => !v); }}
          style={{
            padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: showImport && importMode === "pdf" ? "#6f42c1" : "#f3f0ff",
            color: showImport && importMode === "pdf" ? "#fff" : "#6f42c1",
            fontFamily: "Heebo,sans-serif", fontWeight: 700, fontSize: 13,
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
          }}
        >
          📄 ייבוא PDF
        </button>
        <button
          onClick={() => { setImportMode("excel"); setShowImport((v) => !v); }}
          style={{
            padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: showImport && importMode === "excel" ? "#16a34a" : "#f0fdf4",
            color: showImport && importMode === "excel" ? "#fff" : "#16a34a",
            fontFamily: "Heebo,sans-serif", fontWeight: 700, fontSize: 13,
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
          }}
        >
          📊 ייבוא Excel
        </button>

        {/* Sync all green */}
        <button
          onClick={syncAllGreen}
          disabled={syncing || greenCount === 0}
          style={{
            padding: "10px 16px", borderRadius: 8, border: "none",
            cursor: syncing || greenCount === 0 ? "not-allowed" : "pointer",
            background: syncing || greenCount === 0 ? "var(--border)" : "linear-gradient(135deg,#059669 0%,#065f46 100%)",
            color: syncing || greenCount === 0 ? "var(--text-muted)" : "#fff",
            fontFamily: "Heebo,sans-serif", fontWeight: 700, fontSize: 13,
          }}
        >
          {syncing ? "⏳ מסנכרן..." : `✓ סנכרן הכל ירוק (${greenCount})`}
        </button>

        {/* Refresh */}
        <button
          onClick={fetchRows}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo,sans-serif", fontSize: 13, color: "var(--text-muted)" }}
        >
          ↻ רענן
        </button>

        {/* Filter toggle */}
        <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)", marginRight: "auto" }}>
          {[["pending", "ממתינים"], ["all", "הכל"]].map(([val, label]) => (
            <button key={val} onClick={() => setFilterMode(val)} style={{
              padding: "9px 14px", border: "none", cursor: "pointer",
              fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
              background: filterMode === val ? "var(--gold)" : "var(--card-bg)",
              color:      filterMode === val ? "#0F0F0F"    : "var(--text-muted)",
              transition: "all 0.2s",
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Staging table ────────────────────────────────────────────────── */}
      <div style={{ background: "var(--card-bg)", borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>⏳ טוען...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💆</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--black)", marginBottom: 6 }}>
              {filterMode === "pending" ? "אין שורות ממתינות לאישור" : "טבלת הסטייג'ינג ריקה"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              ייבא PDF מלמעלה · או המתן למייל אוטומטי מ-Make.com
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: "var(--ivory)" }}>
                  {["שם אורח", "טלפון", "שעת טיפול", "סוג טיפול", "סטטוס", "יובא", "פעולות"].map((h) => (
                    <th key={h} style={{ padding: "11px 14px", fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textAlign: "right", borderBottom: "1px solid var(--border)", letterSpacing: "0.5px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const styleKey  = row.sync_status === "synced"   ? "synced"
                                  : row.sync_status === "rejected" ? "rejected"
                                  : row.match_status;
                  const { bg, label, lc } = rowStyle[styleKey] ?? { bg: "#fff", label: styleKey, lc: "#333" };
                  const isFinal = row.sync_status === "synced" || row.sync_status === "rejected";
                  const ts = new Date(row.imported_at).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

                  return (
                    <tr key={row.id} style={{ background: bg }}>
                      <td style={{ padding: "12px 14px", fontSize: 14, fontWeight: 600 }}>
                        {row.guest_name || <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-muted)", direction: "ltr", textAlign: "right" }}>
                        {row.phone ? row.phone.replace(/^972/, "0") : "—"}
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: 14, fontWeight: 700 }}>
                        {row.treatment_time || "—"}
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: 13 }}>
                        {row.treatment_type || "—"}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: bg, color: lc, border: `1px solid ${lc}33` }}>
                          {label}
                        </span>
                        {row.suspicious_reason && (
                          <div style={{ fontSize: 10, color: "#92400e", marginTop: 2 }}>{row.suspicious_reason}</div>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {ts}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        {!isFinal ? (
                          <div style={{ display: "flex", gap: 5 }}>
                            {row.match_status === "matched" && (
                              <button onClick={() => syncRow(row)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo,sans-serif" }}>
                                סנכרן
                              </button>
                            )}
                            {row.match_status === "no_booking" && (
                              <button onClick={() => setQuickAdd(row)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#6f42c1", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo,sans-serif" }}>
                                הוסף ידנית
                              </button>
                            )}
                            {row.match_status === "suspicious" && (
                              <button onClick={() => syncRow(row)} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #d97706", background: "#fef3c7", color: "#92400e", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo,sans-serif" }}>
                                אשר בכל זאת
                              </button>
                            )}
                            <button onClick={() => rejectRow(row.id)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff1f2", color: "#991b1b", fontSize: 12, cursor: "pointer", fontFamily: "Heebo,sans-serif" }}>
                              דחה
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{row.sync_status === "synced" ? "✓" : "✗"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {quickAdd && (
        <QuickAddModal
          row={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={() => { fetchRows(); fetchPendingCount(); setQuickAdd(null); }}
        />
      )}
    </div>
  );
}
