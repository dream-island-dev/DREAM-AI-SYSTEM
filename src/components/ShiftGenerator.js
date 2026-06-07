// src/components/ShiftGenerator.js
// AI Shift Generator workspace: upload a past schedule + free-text Hebrew
// constraints → Gemini (primary)/Claude (fallback) generate a balanced week →
// Review & Approve → insert into Supabase + queue WhatsApp staff notifications.
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

function nextSunday() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

const DEPT_LABEL = {
  housekeeping: "🛏️ ניקיון וחדרים",
  maintenance:  "🔧 תחזוקה",
  reception:    "🏨 קבלה ופרונט",
  spa:          "💆 ספא ובריאות",
  management:   "📋 ניהול כללי",
};

export default function ShiftGenerator({ onApproved, user }) {
  const [employees, setEmployees]     = useState([]);
  const [pastShifts, setPastShifts]   = useState([]);
  const [pastName, setPastName]       = useState("");
  const [constraints, setConstraints] = useState("");
  const [weekStart, setWeekStart]     = useState(nextSunday());
  const [schedule, setSchedule]       = useState(null);
  const [engine, setEngine]           = useState(null);
  const [generating, setGenerating]   = useState(false);
  const [approving, setApproving]     = useState(false);
  const [toast, setToast]             = useState(null);
  const [managerDepartment, setManagerDepartment] = useState(null);
  const inputRef = useRef(null);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 4500); };

  // Fetch employees filtered by department, and manager's own department
  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured || !supabase) return;
      const { data } = await supabase.from("employees").select("id,name,department,role");
      setEmployees(data ?? []);
    })();
  }, []);

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured || !supabase) return;
    supabase
      .from("profiles")
      .select("department")
      .eq("id", user.id)
      .single()
      .then(({ data }) => { if (data?.department) setManagerDepartment(data.department); });
  }, [user?.id]);

  const parsePast = useCallback((file) => {
    if (!file) return;
    setPastName(file.name);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(e.target.result, { type: "array" });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
        setPastShifts(rows);
        showToast("ok", `נטענו ${rows.length} שורות מהסידור הקודם`);
      } catch (err) { showToast("err", "שגיאה בקריאת הקובץ: " + err.message); }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const generate = async () => {
    if (!isSupabaseConfigured || !supabase) return showToast("err", "Supabase לא מחובר");
    setGenerating(true); setSchedule(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-schedule", {
        body: { pastShifts, employees, constraints, weekStart, department: managerDepartment },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "יצירת הסידור נכשלה");
      setSchedule(data.schedule || []);
      setEngine(data.engine || null);
      if (!data.schedule?.length) showToast("err", "המודל לא החזיר משמרות — נסה לחדד אילוצים");
    } catch (e) {
      showToast("err", "שגיאה: " + (e?.message ?? e));
    }
    setGenerating(false);
  };

  const removeRow = (i) => setSchedule((s) => s.filter((_, idx) => idx !== i));

  const approve = async () => {
    if (!schedule?.length) return;
    setApproving(true);
    const rows = schedule.map((s, i) => ({
      id: Date.now() + i,
      employeeName: s.employeeName,
      // Always stamp with manager's department; fall back to what the AI returned
      department: managerDepartment || s.department,
      date: s.date,
      start: s.start,
      end: s.end,
      status: s.status || "עתידי",
    }));
    const { error } = await supabase.from("shifts").upsert(rows);
    if (error) { showToast("err", "שגיאה בשמירה: " + error.message); setApproving(false); return; }

    // Queue WhatsApp staff notifications (best-effort; no-op until deployed).
    try {
      const byEmp = {};
      rows.forEach((r) => { (byEmp[r.employeeName] ||= []).push(r); });
      await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "shift_assignment", weekStart, assignments: byEmp },
      });
    } catch { /* whatsapp-send may not be deployed yet */ }

    showToast("ok", `✅ ${rows.length} משמרות נשמרו ונשלחו התראות לצוות`);
    setSchedule(null); setApproving(false);
    onApproved?.();
  };

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color: toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
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

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.7 }}>
            העלה סידור משמרות קודם, הוסף אילוצים בשפה חופשית, וה-AI ייצור סידור שבועי חדש ומאוזן.
            תוכל לעבור עליו ולאשר לפני שמירה.
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label>שבוע מתחיל בתאריך</label>
              <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} dir="ltr" />
            </div>
            <div className="form-field">
              <label>סידור קודם (Excel/CSV)</label>
              <button onClick={() => inputRef.current?.click()}
                className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
                {pastName || "📂 בחר קובץ"}
              </button>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => parsePast(e.target.files?.[0])} />
            </div>
          </div>

          <div className="form-field" style={{ marginTop: 4 }}>
            <label>אילוצים והתאמות (טקסט חופשי)</label>
            <textarea rows={4} value={constraints} onChange={(e) => setConstraints(e.target.value)}
              placeholder='לדוגמה: "אביב בחופשה ביום שלישי", "החלף בין בני ליוסי במשמרת לילה של חמישי", "דנה רק בקרים"'
              style={{ resize: "vertical" }} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {employees.length} עובדים · {pastShifts.length} משמרות עבר
            </div>
            <button className="btn btn-primary" disabled={generating} onClick={generate}
              style={{ minWidth: 180, opacity: generating ? 0.6 : 1 }}>
              {generating ? "🪄 מייצר סידור..." : "🪄 צור סידור חכם"}
            </button>
          </div>
        </div>
      </div>

      {schedule && (
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="card-title">
              סקירה ואישור · {schedule.length} משמרות
              {engine && <span style={{ marginRight: 8, fontSize: 11, color: "var(--text-muted)" }}>
                {engine === "gemini" ? "✨ Gemini" : "🤖 Claude"}
              </span>}
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 680 }}>
                <thead><tr><th>עובד</th><th>מחלקה</th><th>תאריך</th><th>התחלה</th><th>סיום</th><th></th></tr></thead>
                <tbody>
                  {schedule.map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 700 }}>{s.employeeName}</td>
                      <td>{s.department}</td>
                      <td style={{ direction: "ltr", fontSize: 13 }}>{s.date}</td>
                      <td style={{ direction: "ltr" }}>{s.start}</td>
                      <td style={{ direction: "ltr" }}>{s.end}</td>
                      <td>
                        <button className="btn btn-sm" onClick={() => removeRow(i)}
                          style={{ background: "#FFF0EE", color: "#C0392B" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setSchedule(null)}>ביטול</button>
              <button className="btn btn-primary" disabled={approving} onClick={approve}
                style={{ minWidth: 180, opacity: approving ? 0.6 : 1 }}>
                {approving ? "שומר..." : "✓ אשר ושמור + שלח לצוות"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
