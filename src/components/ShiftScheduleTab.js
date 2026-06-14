// src/components/ShiftScheduleTab.js
// Weekly shift schedule grid — Dream Island XOS Sprint 3.
// Props: user, employees (from parent), onNavigate (optional, for ShiftGenerator link)

import React, { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../supabaseClient";
import { canPerform } from "../utils/auth";

// ── Date helpers ──────────────────────────────────────────────────────────────
const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toYMD(date) {
  return date.toISOString().split("T")[0];
}

function formatDayLabel(date) {
  return `${HE_DAYS[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`;
}

function formatWeekRange(start, end) {
  return `${start.getDate()}/${start.getMonth() + 1} – ${end.getDate()}/${end.getMonth() + 1}/${end.getFullYear()}`;
}

// ── Shift constants ───────────────────────────────────────────────────────────
const SHIFT_STATUSES = ["עבודה", "חופש", "מחלה", "כוננות"];

const STATUS_STYLE = {
  עבודה:  { bg: "rgba(201,169,110,0.15)", border: "#C9A96E", text: "#6B4C1E" },
  חופש:   { bg: "#EAF3DE",                border: "#639922", text: "#3B6D11" },
  מחלה:   { bg: "#FCEBEB",                border: "#E24B4A", text: "#A32D2D" },
  כוננות: { bg: "#E6F1FB",                border: "#378ADD", text: "#185FA5" },
};

// ── Excel export ──────────────────────────────────────────────────────────────
function exportWeekToExcel(employees, weekDays, shifts) {
  const d0 = weekDays[0], d6 = weekDays[6];
  const label = `${d0.getDate()}-${d6.getDate()}_${d6.getMonth() + 1}_${d6.getFullYear()}`;
  const headers = ["עובד", "מחלקה", ...weekDays.map(formatDayLabel)];
  const rows = employees.map(emp => {
    const cells = weekDays.map(day => {
      const s = shifts.find(sh => sh.employee_id === emp.id && sh.date === toYMD(day));
      if (!s) return "";
      if (s.status === "חופש" || s.status === "מחלה") return s.status;
      const time = (s.start_time && s.end_time)
        ? `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`
        : s.status ?? "";
      return s.station ? `${time} (${s.station})` : time;
    });
    return [emp.name, emp.department ?? "", ...cells];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = [{ wch: 22 }, { wch: 14 }, ...weekDays.map(() => ({ wch: 20 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "לוח משמרות");
  XLSX.writeFile(wb, `משמרות_${label}.xlsx`);
}

// ── Shared button styles ──────────────────────────────────────────────────────
const navBtn = {
  padding: "7px 13px", borderRadius: 8, fontSize: 15, fontWeight: 700,
  cursor: "pointer", fontFamily: "Heebo, sans-serif",
  border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--black)",
};

const actionBtn = {
  padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
  cursor: "pointer", fontFamily: "Heebo, sans-serif",
};

function headCell(isFirst) {
  return {
    padding: "10px 12px", fontWeight: 700, fontSize: 11,
    textAlign: "center", color: "var(--text-muted)",
    background: "var(--card-bg)",
    borderLeft: isFirst ? "none" : "1px solid var(--border)",
    borderBottom: "2px solid var(--border)",
  };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ShiftScheduleTab({ user, employees, onNavigate }) {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [shifts,    setShifts]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  const [toast,     setToast]     = useState(null);

  const canEdit      = canPerform("edit_employee", user);
  const weekDays     = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const activeEmps   = (employees ?? []).filter(e => !e.status || e.status === "פעיל");

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchShifts = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const end = addDays(weekStart, 6);
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .gte("date", toYMD(weekStart))
      .lte("date", toYMD(end));
    if (!error) setShifts(data ?? []);
    setLoading(false);
  }, [weekStart]);

  useEffect(() => { fetchShifts(); }, [fetchShifts]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleSaved(action) {
    setModal(null);
    fetchShifts();
    const msgs = { add: "משמרת נוספה ✓", edit: "משמרת עודכנה ✓", delete: "משמרת נמחקה" };
    showToast(msgs[action] ?? "נשמר ✓", action === "delete" ? "warn" : "ok");
  }

  const getShift = (empId, day) =>
    shifts.find(s => s.employee_id === empId && s.date === toYMD(day)) ?? null;

  return (
    <div style={{ direction: "rtl", fontFamily: "Heebo, sans-serif" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          background: toast.type === "warn" ? "#FAEEDA" : toast.type === "err" ? "#FCEBEB" : "#EAF3DE",
          color:      toast.type === "warn" ? "#854F0B"  : toast.type === "err" ? "#A32D2D" : "#3B6D11",
          border: `1px solid ${toast.type === "warn" ? "#BA7517" : toast.type === "err" ? "#E24B4A" : "#639922"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Shift modal */}
      {modal && (
        <ShiftModal
          mode={modal.mode}
          shift={modal.shift}
          employee={modal.employee}
          date={modal.date}
          user={user}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Controls bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 18, flexWrap: "wrap", gap: 10 }}>

        {/* Week navigator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setWeekStart(d => addDays(d, -7))} style={navBtn}>‹</button>
          <div style={{ minWidth: 210, textAlign: "center", fontWeight: 700, fontSize: 14, color: "var(--black)" }}>
            {formatWeekRange(weekStart, weekDays[6])}
          </div>
          <button onClick={() => setWeekStart(d => addDays(d, +7))} style={navBtn}>›</button>
          <button
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            style={{ ...navBtn, background: "var(--gold)", color: "#412402", border: "none", fontWeight: 800, fontSize: 12, padding: "7px 14px" }}
          >
            היום
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => exportWeekToExcel(activeEmps, weekDays, shifts)}
            style={{ ...actionBtn, background: "var(--card-bg)", border: "1.5px solid var(--border)", color: "var(--black)" }}
          >
            ⬇️ ייצוא Excel
          </button>
          {canEdit && onNavigate && (
            <button
              onClick={() => onNavigate("scheduler")}
              style={{ ...actionBtn, background: "var(--gold)", border: "none", color: "#412402", fontWeight: 800 }}
            >
              📤 ייבוא Excel
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {SHIFT_STATUSES.map(st => {
          const s = STATUS_STYLE[st];
          return (
            <div key={st} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: s.bg, border: `1px solid ${s.border}` }} />
              <span style={{ color: "var(--text-muted)" }}>{st}</span>
            </div>
          );
        })}
        {canEdit && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
            לחץ על תא להוספה / עריכה
          </span>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)", fontSize: 14 }}>
          ⏳ טוען משמרות...
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "190px repeat(7, minmax(105px, 1fr))",
            minWidth: 920,
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}>
            {/* Header row */}
            <div style={headCell(true)}>עובד</div>
            {weekDays.map((day, i) => {
              const isToday = toYMD(day) === toYMD(new Date());
              return (
                <div key={i} style={{
                  ...headCell(false),
                  background: isToday ? "rgba(201,169,110,0.18)" : "var(--card-bg)",
                  color: isToday ? "var(--gold-dark, #A8843A)" : "var(--text-muted)",
                }}>
                  {formatDayLabel(day)}
                </div>
              );
            })}

            {/* Employee rows */}
            {activeEmps.length === 0 ? (
              <div style={{
                gridColumn: "1 / -1", padding: "40px 20px",
                textAlign: "center", color: "var(--text-muted)", fontSize: 14,
              }}>
                אין עובדים פעילים להצגה
              </div>
            ) : (
              activeEmps.map((emp, empIdx) => (
                <React.Fragment key={emp.id}>
                  {/* Employee name cell */}
                  <div style={{
                    padding: "10px 14px", minHeight: 68,
                    display: "flex", flexDirection: "column", justifyContent: "center",
                    background: empIdx % 2 === 0 ? "var(--ivory)" : "var(--card-bg)",
                    borderTop: "1px solid var(--border)",
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--black)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {emp.name}
                    </div>
                    {emp.department && (
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        {emp.department}
                      </div>
                    )}
                  </div>

                  {/* Day cells */}
                  {weekDays.map((day, dayIdx) => (
                    <ShiftCell
                      key={dayIdx}
                      shift={getShift(emp.id, day)}
                      isToday={toYMD(day) === toYMD(new Date())}
                      isAltRow={empIdx % 2 === 0}
                      canEdit={canEdit}
                      onClick={() => {
                        const shift = getShift(emp.id, day);
                        setModal({ mode: shift ? "edit" : "add", shift, employee: emp, date: toYMD(day) });
                      }}
                    />
                  ))}
                </React.Fragment>
              ))
            )}
          </div>
        </div>
      )}

      {/* Import hint */}
      <div style={{
        marginTop: 16, fontSize: 12, color: "var(--text-muted)",
        padding: "10px 16px", borderRadius: 8, background: "var(--ivory)",
        border: "1px solid var(--border)",
      }}>
        💡 ייבוא גדול של Excel / CSV — עבור ל<strong>מחולל משמרות</strong> בסרגל הצד
      </div>
    </div>
  );
}

// ── ShiftCell ─────────────────────────────────────────────────────────────────
function ShiftCell({ shift, isToday, isAltRow, canEdit, onClick }) {
  const [hovered, setHovered] = useState(false);
  const st  = STATUS_STYLE[shift?.status] ?? STATUS_STYLE["עבודה"];
  const bgBase = isToday ? "rgba(201,169,110,0.06)" : isAltRow ? "var(--ivory)" : "var(--card-bg)";

  return (
    <div
      onClick={canEdit ? onClick : undefined}
      onMouseEnter={() => canEdit && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: 6, minHeight: 68, boxSizing: "border-box",
        background: hovered ? "rgba(201,169,110,0.12)" : bgBase,
        borderTop: "1px solid var(--border)",
        borderLeft: "1px solid var(--border)",
        cursor: canEdit ? "pointer" : "default",
        transition: "background 0.15s",
      }}
    >
      {shift ? (
        <div style={{
          background: st.bg, border: `1px solid ${st.border}`, borderRadius: 6,
          padding: "5px 8px", height: "100%", boxSizing: "border-box",
          display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          {shift.status && shift.status !== "עבודה" && (
            <div style={{ fontSize: 11, fontWeight: 800, color: st.text }}>{shift.status}</div>
          )}
          {(shift.start_time || shift.end_time) && (
            <div style={{ fontSize: 12, fontWeight: 700, color: st.text }}>
              {shift.start_time?.slice(0, 5) ?? ""}
              {shift.start_time && shift.end_time ? "–" : ""}
              {shift.end_time?.slice(0, 5) ?? ""}
            </div>
          )}
          {shift.station && (
            <div style={{ fontSize: 10, color: st.text, opacity: 0.75, marginTop: 2 }}>
              {shift.station}
            </div>
          )}
        </div>
      ) : (
        canEdit && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", fontSize: 22, fontWeight: 300,
            color: "var(--gold)", opacity: hovered ? 0.6 : 0.2,
            transition: "opacity 0.15s",
          }}>
            +
          </div>
        )
      )}
    </div>
  );
}

// ── ShiftModal ────────────────────────────────────────────────────────────────
function ShiftModal({ mode, shift, employee, date, user, onClose, onSaved }) {
  const isEdit    = mode === "edit";
  const canDelete = canPerform("delete_employee", user);

  const [form, setForm] = useState({
    status:     shift?.status              ?? "עבודה",
    start_time: shift?.start_time?.slice(0, 5) ?? "08:00",
    end_time:   shift?.end_time?.slice(0, 5)   ?? "17:00",
    station:    shift?.station ?? "",
    notes:      shift?.notes   ?? "",
  });
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error,         setError]         = useState(null);

  const set = (k, v) => { setError(null); setForm(p => ({ ...p, [k]: v })); };
  const showTimes = form.status === "עבודה" || form.status === "כוננות";

  async function handleSave() {
    if (!supabase) return setError("Supabase לא מחובר");
    setSaving(true);
    const row = {
      employee_id:   employee.id,
      employee_name: employee.name,
      employeeName:  employee.name,
      department:    employee.department ?? null,
      date,
      start_time:    showTimes ? (form.start_time || null) : null,
      end_time:      showTimes ? (form.end_time   || null) : null,
      station:       form.station || null,
      notes:         form.notes   || null,
      status:        form.status,
      created_by:    user?.id ?? null,
    };
    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("shifts").update(row).eq("id", shift.id));
    } else {
      ({ error: err } = await supabase.from("shifts").insert(row));
    }
    if (err) { setError("שגיאה: " + err.message); setSaving(false); }
    else onSaved(isEdit ? "edit" : "add");
  }

  async function handleDelete() {
    if (!shift?.id || !supabase) return;
    setDeleting(true);
    const { error: err } = await supabase.from("shifts").delete().eq("id", shift.id);
    if (err) { setError("שגיאה: " + err.message); setDeleting(false); }
    else onSaved("delete");
  }

  const inp = {
    width: "100%", padding: "10px 12px", boxSizing: "border-box",
    border: "1.5px solid var(--border)", borderRadius: 8,
    fontFamily: "Heebo, sans-serif", fontSize: 14, direction: "rtl",
    color: "var(--black)", background: "var(--card-bg)", outline: "none",
    transition: "border-color 0.2s",
  };
  const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--card-bg)", borderRadius: 16, padding: 28,
          width: "100%", maxWidth: 420, direction: "rtl",
          boxShadow: "0 20px 60px rgba(0,0,0,0.22)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--black)" }}>
              {isEdit ? "✏️ עריכת משמרת" : "➕ הוספת משמרת"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              👤 {employee.name} · {date}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer",
              color: "var(--text-muted)", padding: 4 }}>
            ✕
          </button>
        </div>

        {/* Shift type chips */}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>סוג משמרת</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SHIFT_STATUSES.map(st => {
              const active = form.status === st;
              const s = STATUS_STYLE[st];
              return (
                <button key={st} onClick={() => set("status", st)} style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "Heebo, sans-serif", transition: "all 0.15s",
                  border: `1.5px solid ${active ? s.border : "var(--border)"}`,
                  background: active ? s.bg : "var(--card-bg)",
                  color: active ? s.text : "var(--text-muted)",
                }}>
                  {st}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time range — only for עבודה / כוננות */}
        {showTimes && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <label style={lbl}>שעת התחלה</label>
              <input type="time" style={inp} value={form.start_time}
                onChange={e => set("start_time", e.target.value)}
                onFocus={e => (e.target.style.borderColor = "var(--gold)")}
                onBlur={e  => (e.target.style.borderColor = "var(--border)")} />
            </div>
            <div>
              <label style={lbl}>שעת סיום</label>
              <input type="time" style={inp} value={form.end_time}
                onChange={e => set("end_time", e.target.value)}
                onFocus={e => (e.target.style.borderColor = "var(--gold)")}
                onBlur={e  => (e.target.style.borderColor = "var(--border)")} />
            </div>
          </div>
        )}

        {/* Station */}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>תחנה / עמדה</label>
          <input style={inp} placeholder="קבלה, בריכה, ספא..." value={form.station}
            onChange={e => set("station", e.target.value)}
            onFocus={e => (e.target.style.borderColor = "var(--gold)")}
            onBlur={e  => (e.target.style.borderColor = "var(--border)")} />
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>הערות</label>
          <input style={inp} placeholder="הערה אופציונלית" value={form.notes}
            onChange={e => set("notes", e.target.value)}
            onFocus={e => (e.target.style.borderColor = "var(--gold)")}
            onBlur={e  => (e.target.style.borderColor = "var(--border)")} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ marginBottom: 14, padding: "9px 12px", borderRadius: 8,
            background: "#FCEBEB", color: "#A32D2D", fontSize: 13, fontWeight: 600 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Save / Cancel */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 14, fontWeight: 600,
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
              border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)" }}>
            ביטול
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 2, padding: "11px 0", borderRadius: 10, fontSize: 14, fontWeight: 800,
              cursor: saving ? "not-allowed" : "pointer", fontFamily: "Heebo, sans-serif",
              border: "none", background: "var(--gold)", color: "#412402", opacity: saving ? 0.7 : 1 }}>
            {saving ? "⏳ שומר..." : isEdit ? "💾 שמור" : "➕ הוסף"}
          </button>
        </div>

        {/* Delete zone — admin+ only, edit mode only */}
        {isEdit && canDelete && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px dashed var(--border)" }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  width: "100%", padding: "9px 0", borderRadius: 10,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Heebo, sans-serif",
                  border: "1.5px solid #E24B4A", background: "transparent", color: "#E24B4A",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.target.style.background = "#FCEBEB")}
                onMouseLeave={e => (e.target.style.background = "transparent")}
              >
                🗑️ מחק משמרת
              </button>
            ) : (
              <div style={{ background: "#FCEBEB", borderRadius: 8, padding: "12px 14px", border: "1px solid #E24B4A" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#A32D2D", marginBottom: 10 }}>
                  ⚠️ למחוק את המשמרת לצמיתות?
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setConfirmDelete(false)}
                    style={{ flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12,
                      cursor: "pointer", fontFamily: "Heebo, sans-serif",
                      border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)" }}>
                    ביטול
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    style={{ flex: 2, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 800,
                      cursor: deleting ? "not-allowed" : "pointer", fontFamily: "Heebo, sans-serif",
                      border: "none", background: "#E24B4A", color: "#fff", opacity: deleting ? 0.7 : 1 }}>
                    {deleting ? "⏳..." : "✓ כן, מחק"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
