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

      {/* ── PDF Import Zone (toggle) ─────────────────────────────────────── */}
      {showImport && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--black)" }}>📥 ייבוא לוח ספא מ-PDF</div>
            <button onClick={() => setShowImport(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-muted)", lineHeight: 1 }}>✕</button>
          </div>
          <PdfImportZone
            onImportDone={(result) => {
              setShowImport(false);
              flash("ok", `✅ ${result.total} שורות נקלטו — ${result.matched} ירוק · ${result.suspicious} צהוב · ${result.no_booking} אדום`, 6000);
            }}
            onError={(msg) => flash("error", msg)}
          />
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

        {/* PDF Import button */}
        <button
          onClick={() => setShowImport((v) => !v)}
          style={{
            padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: showImport ? "#6f42c1" : "#f3f0ff",
            color: showImport ? "#fff" : "#6f42c1",
            fontFamily: "Heebo,sans-serif", fontWeight: 700, fontSize: 13,
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
          }}
        >
          📥 ייבוא PDF
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
