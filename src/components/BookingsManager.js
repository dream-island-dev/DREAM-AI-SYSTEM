import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import EzgoImport from "./EzgoImport";

// ── Constants ─────────────────────────────────────────────────────────────────
const CONFIRM_STATUS = {
  pending:   { label: "ממתין",  bg: "rgba(184,134,11,0.1)",  color: "#8B6914" },
  confirmed: { label: "אישר",   bg: "rgba(26,122,74,0.1)",   color: "#1A7A4A" },
  cancelled: { label: "ביטל",   bg: "rgba(192,57,43,0.1)",   color: "#C0392B" },
};
const PAYMENT_STATUS = {
  pending:    { label: "טרם נשלח", bg: "#F5F0E8",              color: "#8A7A6A" },
  link_sent:  { label: "קישור נשלח", bg: "rgba(184,134,11,0.1)", color: "#8B6914" },
  paid:       { label: "שולם ✓",  bg: "rgba(26,122,74,0.1)",   color: "#1A7A4A" },
  refunded:   { label: "הוחזר",   bg: "rgba(192,57,43,0.08)",  color: "#C0392B" },
};

// ── CSV header mapping (Hebrew + English) ─────────────────────────────────────
const HEADER_MAP = {
  שם: "guest_name", name: "guest_name", "שם אורח": "guest_name",
  טלפון: "phone", phone: "phone", "מספר טלפון": "phone",
  "תאריך הגעה": "arrival_date", "תאריך": "arrival_date",
  date: "arrival_date", arrival_date: "arrival_date",
  סכום: "amount", amount: "amount", "סכום לתשלום": "amount", price: "amount",
  הערות: "notes", notes: "notes",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  let p = String(raw).replace(/[\s\-()‏]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0"))  p = "972" + p.slice(1);
  return p;
}

function parseDate(raw) {
  if (!raw) return null;
  // DD/MM/YYYY or DD.MM.YYYY → YYYY-MM-DD
  const m = String(raw).match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("הקובץ ריק — נדרש לפחות שורת כותרות + שורה אחת");

  const rawHeaders = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const keys = rawHeaders.map((h) => HEADER_MAP[h.toLowerCase()] ?? HEADER_MAP[h] ?? null);

  if (!keys.includes("guest_name")) throw new Error("חסרה עמודת שם (שם / name)");
  if (!keys.includes("phone"))      throw new Error("חסרה עמודת טלפון (טלפון / phone)");
  if (!keys.includes("arrival_date")) throw new Error("חסרה עמודת תאריך הגעה");

  return lines.slice(1).map((line, i) => {
    const vals = line.split(",").map((v) => v.trim().replace(/"/g, ""));
    const row = {};
    keys.forEach((k, idx) => { if (k) row[k] = vals[idx] ?? ""; });

    row.phone = normalizePhone(row.phone);
    row.arrival_date = parseDate(row.arrival_date);
    if (row.amount) row.amount = parseFloat(String(row.amount).replace(/[^\d.]/g, "")) || null;
    if (!row.arrival_date) throw new Error(`שורה ${i + 2}: תאריך לא תקין — "${vals[keys.indexOf("arrival_date")]}"`);
    if (row.phone.length < 10) throw new Error(`שורה ${i + 2}: טלפון לא תקין — "${row.phone}"`);
    return row;
  });
}

function formatDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function showToastFn(setToast) {
  return (msg) => { setToast(msg); setTimeout(() => setToast(""), 3500); };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BookingsManager() {
  const [tab, setTab]             = useState("list");
  const [bookings, setBookings]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState({ confirm: "all", payment: "all", date: "" });
  const [csvRows, setCsvRows]     = useState([]);
  const [csvError, setCsvError]   = useState("");
  const [importing, setImporting] = useState(false);
  const [actioning, setActioning] = useState(null); // booking id
  const [toast, setToast]         = useState("");
  const showToast = showToastFn(setToast);

  // ── Fetch bookings ──────────────────────────────────────────────────────────
  const fetchBookings = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured) {
      setBookings(DEMO_BOOKINGS);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .order("arrival_date", { ascending: true });
    if (!error) setBookings(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = {
    total:     bookings.length,
    confirmed: bookings.filter((b) => b.confirmation_status === "confirmed").length,
    paid:      bookings.filter((b) => b.payment_status === "paid").length,
    pending:   bookings.filter((b) => b.payment_status === "pending" && b.confirmation_status === "confirmed").length,
    revenue:   bookings.filter((b) => b.payment_status === "paid")
                        .reduce((s, b) => s + (b.amount ?? 0), 0),
    expected:  bookings.filter((b) => b.confirmation_status === "confirmed")
                        .reduce((s, b) => s + (b.amount ?? 0), 0),
  };

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = bookings.filter((b) => {
    if (filter.confirm !== "all"  && b.confirmation_status !== filter.confirm)  return false;
    if (filter.payment !== "all"  && b.payment_status      !== filter.payment)  return false;
    if (filter.date    && b.arrival_date !== filter.date) return false;
    return true;
  });

  // ── CSV upload ──────────────────────────────────────────────────────────────
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(""); setCsvRows([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        setCsvRows(rows);
      } catch (err) {
        setCsvError(err.message);
      }
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const handleImport = async () => {
    if (!csvRows.length || importing) return;
    setImporting(true);
    let ok = 0, fail = 0;
    if (isSupabaseConfigured) {
      const { error } = await supabase.from("bookings").insert(
        csvRows.map((r) => ({ ...r, confirmation_status: "pending", payment_status: "pending" }))
      );
      if (error) { showToast(`❌ ${error.message}`); fail = csvRows.length; }
      else { ok = csvRows.length; }
    } else {
      // Demo mode — add to local state
      setBookings((prev) => [...prev, ...csvRows.map((r, i) => ({
        id: `demo-${Date.now()}-${i}`, ...r,
        confirmation_status: "pending", payment_status: "pending",
      }))]);
      ok = csvRows.length;
    }
    showToast(`✅ יובאו ${ok} הזמנות${fail ? ` | ❌ ${fail} נכשלו` : ""}`);
    setCsvRows([]);
    setImporting(false);
    if (ok > 0) { setTab("list"); fetchBookings(); }
  };

  // ── WhatsApp actions ────────────────────────────────────────────────────────
  async function sendWA(booking, templateName, params) {
    setActioning(booking.id);
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", {
          body: { to: booking.phone, template: { name: templateName, language: "he", params } },
        });
        if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "שגיאה");
      }
      showToast(`✅ נשלח: ${templateName}`);
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
    setActioning(null);
  }

  async function handleMarkPaid(booking) {
    if (!isSupabaseConfigured) {
      setBookings((prev) => prev.map((b) =>
        b.id === booking.id ? { ...b, payment_status: "paid", paid_at: new Date().toISOString() } : b
      ));
      showToast("✅ סומן ששולם");
      return;
    }
    const { error } = await supabase.from("bookings")
      .update({ payment_status: "paid", paid_at: new Date().toISOString() })
      .eq("id", booking.id);
    if (!error) { showToast("✅ סומן ששולם"); fetchBookings(); }
    else showToast(`❌ ${error.message}`);
  }

  async function handleSendConfirm(booking) {
    const dateLabel = formatDate(booking.arrival_date);
    await sendWA(booking, "dream_arrival_confirm", [booking.guest_name, dateLabel]);
  }

  async function handleSendPayment(booking) {
    const dateLabel = formatDate(booking.arrival_date);
    // TODO: כשתחבר חברת תשלומים — replace עם קישור אמיתי שנוצר מה-API
    const payLink = booking.payment_link ?? `https://pay.dream-island.co.il/pay?id=${booking.id}`;
    await sendWA(booking, "dream_payment_link", [booking.guest_name, dateLabel, payLink]);
    if (isSupabaseConfigured) {
      await supabase.from("bookings")
        .update({ payment_status: "link_sent", payment_link_sent_at: new Date().toISOString() })
        .eq("id", booking.id);
      fetchBookings();
    }
  }

  async function handleSendWorkshop(booking, link) {
    const dateLabel = formatDate(booking.arrival_date);
    await sendWA(booking, "dream_workshop_signup", [booking.guest_name, dateLabel, link]);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl">

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A1A", color: "#fff", padding: "10px 28px", borderRadius: 30,
          fontWeight: 700, fontSize: 14, zIndex: 9999, whiteSpace: "nowrap",
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)", border: "1px solid rgba(201,169,110,0.3)" }}>
          {toast}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">הזמנות</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{stats.confirmed}</div>
          <div className="stat-label">אישרו הגעה</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💳</div>
          <div className="stat-value">{stats.paid}</div>
          <div className="stat-label">שילמו</div>
          {stats.pending > 0 && (
            <div className="stat-sub" style={{ color: "#B8860B" }}>
              {stats.pending} ממתינים לתשלום
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-value">
            {stats.revenue > 0 ? `₪${stats.revenue.toLocaleString()}` : "—"}
          </div>
          <div className="stat-label">הכנסות</div>
          {stats.expected > stats.revenue && (
            <div className="stat-sub" style={{ color: "#8A7A6A" }}>
              צפי: ₪{stats.expected.toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`btn ${tab === "list" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("list")}>
          📋 רשימת הזמנות
        </button>
        <button className={`btn ${tab === "import" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("import")}>
          📥 ייבוא CSV
        </button>
        <button className={`btn ${tab === "ezgo" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setTab("ezgo")}>
          📊 ייבוא EZGO
        </button>
        <button className="btn btn-ghost" onClick={fetchBookings}
          style={{ marginRight: "auto" }} disabled={loading}>
          🔄 {loading ? "טוען..." : "רענן"}
        </button>
      </div>

      {/* ════ TAB: IMPORT ════ */}
      {tab === "import" && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">📥 ייבוא הזמנות מ-CSV / Excel</div>
          </div>
          <div style={{ padding: "20px 24px" }}>

            {/* Format guide */}
            <div style={{ background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.25)",
              borderRadius: 12, padding: "14px 18px", marginBottom: 20, fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: "#A8843A" }}>
                פורמט הקובץ — שמור את האקסל כ-CSV (UTF-8)
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 12, color: "#555",
                background: "#fff", padding: "8px 12px", borderRadius: 8,
                border: "1px solid #E0D5C5", direction: "ltr", textAlign: "left" }}>
                שם,טלפון,תאריך הגעה,סכום,הערות<br/>
                אליעד בן שימול,0501234567,15/07/2026,975,<br/>
                רונית כהן,0521234567,16/07/2026,1040,חדר מיוחד
              </div>
              <div style={{ fontSize: 11, color: "#8A7A6A", marginTop: 8 }}>
                עמודות חובה: שם, טלפון, תאריך הגעה | אופציונלי: סכום, הערות
              </div>
            </div>

            {/* File input */}
            <label style={{ display: "block", border: "2px dashed #C9A96E",
              borderRadius: 12, padding: "32px 24px", textAlign: "center",
              cursor: "pointer", background: "rgba(201,169,110,0.04)",
              transition: "all 0.2s" }}>
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload}
                style={{ display: "none" }} />
              <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
              <div style={{ fontWeight: 700, color: "#A8843A", marginBottom: 4 }}>
                לחץ לבחירת קובץ CSV
              </div>
              <div style={{ fontSize: 12, color: "#8A7A6A" }}>
                קובץ CSV שנשמר מ-Excel (גיליון אלקטרוני → שמור בשם → CSV UTF-8)
              </div>
            </label>

            {/* Error */}
            {csvError && (
              <div style={{ marginTop: 14, padding: "12px 16px",
                background: "rgba(192,57,43,0.07)", border: "1px solid rgba(192,57,43,0.2)",
                borderRadius: 10, color: "#C0392B", fontSize: 13 }}>
                ❌ {csvError}
              </div>
            )}

            {/* Preview */}
            {csvRows.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: "#1A1A1A" }}>
                  תצוגה מקדימה — {csvRows.length} שורות
                </div>
                <div style={{ overflowX: "auto", borderRadius: 10,
                  border: "1px solid #E0D5C5", maxHeight: 300, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#FAF6EE", borderBottom: "2px solid #E0D5C5" }}>
                        {["שם", "טלפון", "תאריך הגעה", "סכום", "הערות"].map((h) => (
                          <th key={h} style={{ padding: "8px 12px", textAlign: "right",
                            fontWeight: 700, color: "#1A1A1A", whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F5F0E8" }}>
                          <td style={{ padding: "8px 12px" }}>{r.guest_name}</td>
                          <td style={{ padding: "8px 12px", direction: "ltr",
                            textAlign: "right", color: "#555" }}>+{r.phone}</td>
                          <td style={{ padding: "8px 12px" }}>{formatDate(r.arrival_date)}</td>
                          <td style={{ padding: "8px 12px", color: r.amount ? "#1A7A4A" : "#8A7A6A" }}>
                            {r.amount ? `₪${r.amount}` : "—"}
                          </td>
                          <td style={{ padding: "8px 12px", color: "#8A7A6A", fontSize: 12 }}>
                            {r.notes ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" onClick={() => setCsvRows([])}>
                    ביטול
                  </button>
                  <button className="btn btn-primary" onClick={handleImport}
                    disabled={importing}>
                    {importing ? "מייבא..." : `✅ ייבא ${csvRows.length} הזמנות`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════ TAB: EZGO IMPORT ════ */}
      {tab === "ezgo" && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">📊 ייבוא הזמנות מ-EZGO</div>
          </div>
          <div style={{ padding: "20px 24px" }}>
            <EzgoImport onImported={() => { setTab("list"); fetchBookings(); }} />
          </div>
        </div>
      )}

      {/* ════ TAB: LIST ════ */}
      {tab === "list" && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">📋 הזמנות</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* Confirm filter */}
              <select value={filter.confirm}
                onChange={(e) => setFilter((f) => ({ ...f, confirm: e.target.value }))}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E0D5C5",
                  fontSize: 12, direction: "rtl" }}>
                <option value="all">כל הסטטוסים</option>
                <option value="pending">ממתין לאישור</option>
                <option value="confirmed">אישר הגעה</option>
                <option value="cancelled">ביטל</option>
              </select>
              {/* Payment filter */}
              <select value={filter.payment}
                onChange={(e) => setFilter((f) => ({ ...f, payment: e.target.value }))}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E0D5C5",
                  fontSize: 12, direction: "rtl" }}>
                <option value="all">כל סטטוסי תשלום</option>
                <option value="pending">טרם נשלח</option>
                <option value="link_sent">קישור נשלח</option>
                <option value="paid">שולם</option>
              </select>
              {/* Date filter */}
              <input type="date" value={filter.date}
                onChange={(e) => setFilter((f) => ({ ...f, date: e.target.value }))}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E0D5C5",
                  fontSize: 12 }} />
              {(filter.confirm !== "all" || filter.payment !== "all" || filter.date) && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setFilter({ confirm: "all", payment: "all", date: "" })}>
                  ✕ נקה
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#8A7A6A" }}>טוען...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#8A7A6A", fontSize: 14 }}>
              {bookings.length === 0
                ? "אין הזמנות עדיין — ייבא מאקסל / CSV"
                : "אין תוצאות לפילטר הנוכחי"}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#FAF6EE", borderBottom: "2px solid #E0D5C5" }}>
                    {["תאריך הגעה","שם","טלפון","סכום","אישור הגעה","תשלום","פעולות"].map((h) => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "right",
                        fontWeight: 700, color: "#1A1A1A", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => {
                    const cs = CONFIRM_STATUS[b.confirmation_status] ?? CONFIRM_STATUS.pending;
                    const ps = PAYMENT_STATUS[b.payment_status]      ?? PAYMENT_STATUS.pending;
                    const busy = actioning === b.id;
                    return (
                      <tr key={b.id} style={{ borderBottom: "1px solid #F5F0E8",
                        opacity: busy ? 0.6 : 1 }}>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap", fontWeight: 600 }}>
                          {formatDate(b.arrival_date)}
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                          {b.guest_name}
                        </td>
                        <td style={{ padding: "10px 14px", direction: "ltr",
                          textAlign: "right", color: "#555", fontSize: 12 }}>
                          +{b.phone}
                        </td>
                        <td style={{ padding: "10px 14px",
                          color: b.amount ? "#1A1A1A" : "#8A7A6A", fontWeight: b.amount ? 600 : 400 }}>
                          {b.amount ? `₪${Number(b.amount).toLocaleString()}` : "—"}
                        </td>
                        {/* Confirm status */}
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11,
                            fontWeight: 700, background: cs.bg, color: cs.color }}>
                            {cs.label}
                          </span>
                        </td>
                        {/* Payment status */}
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11,
                            fontWeight: 700, background: ps.bg, color: ps.color }}>
                            {ps.label}
                          </span>
                        </td>
                        {/* Actions */}
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {/* Send confirm (if pending) */}
                            {b.confirmation_status === "pending" && (
                              <button className="btn btn-ghost btn-sm"
                                style={{ fontSize: 11 }} disabled={busy}
                                onClick={() => handleSendConfirm(b)}
                                title="שלח dream_arrival_confirm">
                                📩 אישור הגעה
                              </button>
                            )}
                            {/* Send payment link */}
                            {b.confirmation_status === "confirmed" && b.payment_status !== "paid" && (
                              <button className="btn btn-ghost btn-sm"
                                style={{ fontSize: 11 }} disabled={busy}
                                onClick={() => handleSendPayment(b)}
                                title="שלח dream_payment_link">
                                💳 קישור תשלום
                              </button>
                            )}
                            {/* Mark paid manually */}
                            {b.payment_status === "link_sent" && (
                              <button className="btn btn-ghost btn-sm"
                                style={{ fontSize: 11, color: "#1A7A4A" }} disabled={busy}
                                onClick={() => handleMarkPaid(b)}
                                title="סמן ששולם ידנית">
                                ✅ אשר תשלום
                              </button>
                            )}
                            {/* Send workshop */}
                            {b.confirmation_status === "confirmed" && (
                              <button className="btn btn-ghost btn-sm"
                                style={{ fontSize: 11 }} disabled={busy}
                                onClick={() => {
                                  const link = window.prompt("קישור להרשמה לסדנאות:");
                                  if (link) handleSendWorkshop(b, link);
                                }}
                                title="שלח dream_workshop_signup">
                                🧘 סדנאות
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: "10px 16px", fontSize: 11, color: "#8A7A6A",
                borderTop: "1px solid #F5F0E8", textAlign: "left" }}>
                מציג {filtered.length} מתוך {bookings.length} הזמנות
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Demo data (when Supabase not configured) ──────────────────────────────────
const DEMO_BOOKINGS = [
  { id: "d1", guest_name: "אליעד בן שימול", phone: "972501234567",
    arrival_date: "2026-07-15", amount: 975,
    confirmation_status: "confirmed", payment_status: "paid" },
  { id: "d2", guest_name: "רונית כהן", phone: "972521234567",
    arrival_date: "2026-07-15", amount: 1040,
    confirmation_status: "confirmed", payment_status: "link_sent" },
  { id: "d3", guest_name: "משה לוי", phone: "972531234567",
    arrival_date: "2026-07-18", amount: 660,
    confirmation_status: "pending", payment_status: "pending" },
  { id: "d4", guest_name: "שרה גולדברג", phone: "972541234567",
    arrival_date: "2026-07-20", amount: 975,
    confirmation_status: "confirmed", payment_status: "pending" },
];
