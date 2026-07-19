// src/components/EmployeesPage.js
// Employee management — Dream Island XOS Sprint 2/3.
// Self-contained: fetches from Supabase directly, no App.js state dependency.
// RBAC: uses canPerform() from utils/auth.js.

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { canPerform } from "../utils/auth";
import { loadDepartments } from "../utils/admin";
import { DEPARTMENT_COLORS, normalizeDepartmentLabel } from "../data/hotelDepartments";
import ManageEmployeeModal from "./ManageEmployeeModal";
import ShiftScheduleTab from "./ShiftScheduleTab";

function deptBadgeStyle(dept) {
  const label = normalizeDepartmentLabel(dept);
  const c = DEPARTMENT_COLORS[dept] ?? DEPARTMENT_COLORS[label] ?? "#888780";
  return {
    display: "inline-block", fontSize: 11, fontWeight: 700,
    padding: "3px 9px", borderRadius: 20,
    background: c + "18", color: c, border: `1px solid ${c}40`,
  };
}

function Initials({ name }) {
  const letters = (name ?? "?")
    .split(" ")
    .map(p => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div style={{
      width: 46, height: 46, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, var(--gold-light, #E8C98A), var(--gold, #C9A96E))",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 15, fontWeight: 800, color: "#412402",
    }}>
      {letters}
    </div>
  );
}

function tabBtnStyle(active) {
  return {
    padding: "8px 20px", borderRadius: 8, fontSize: 14, fontWeight: active ? 700 : 400,
    cursor: "pointer", fontFamily: "Heebo, sans-serif", transition: "all 0.15s",
    border: "none",
    background: active ? "var(--gold)" : "transparent",
    color:      active ? "#412402"     : "var(--text-muted)",
  };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EmployeesPage({ user, onNavigate }) {
  const [employees,   setEmployees]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [modal,       setModal]       = useState(null); // null | { mode, employee? }
  const [toast,       setToast]       = useState(null);
  const [departments, setDepartments] = useState([]);
  const [filterDept,  setFilterDept]  = useState("הכל");
  const [activeTab,   setActiveTab]   = useState("employees");

  const canAdd  = canPerform("add_employee",  user);
  const canEdit = canPerform("edit_employee", user);

  useEffect(() => { setDepartments(loadDepartments()); }, []);

  // ── Fetch from Supabase ───────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("name");
    if (!error) setEmployees(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── After modal action ────────────────────────────────────────────────────
  function handleSaved(action) {
    setModal(null);
    fetchEmployees();
    const msgs  = { add: "עובד נוסף בהצלחה ✓", edit: "פרטי העובד עודכנו ✓", delete: "העובד נמחק מהמערכת" };
    const types = { delete: "warn" };
    showToast(msgs[action] ?? "נשמר ✓", types[action] ?? "ok");
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const allDepts  = ["הכל", ...departments];
  const displayed = filterDept === "הכל"
    ? employees
    : employees.filter(e => e.department === filterDept);
  const activeCount = employees.filter(e => e.status === "פעיל").length;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ direction: "rtl", display: "flex", alignItems: "center",
      justifyContent: "center", gap: 12, padding: 48, fontFamily: "Heebo, sans-serif" }}>
      <span style={{ fontSize: 32 }}>👥</span>
      <span style={{ color: "var(--text-muted)" }}>טוען עובדים...</span>
    </div>
  );

  return (
    <div style={{ direction: "rtl", padding: "24px", fontFamily: "Heebo, sans-serif", minHeight: "100%" }}>

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

      {/* Modal */}
      {modal && (
        <ManageEmployeeModal
          mode={modal.mode}
          employee={modal.employee}
          user={user}
          departments={departments}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--black)", marginBottom: 2 }}>
            👥 ניהול עובדים
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {activeCount} פעילים · {employees.length} סה"כ
          </div>
        </div>
        {activeTab === "employees" && canAdd && (
          <button
            className="btn btn-primary"
            onClick={() => setModal({ mode: "add" })}
          >
            ＋ עובד חדש
          </button>
        )}
      </div>

      {/* Tab navigation */}
      <div style={{
        display: "inline-flex", gap: 2, marginBottom: 24,
        padding: 4, borderRadius: 10,
        background: "var(--ivory)", border: "1px solid var(--border)",
      }}>
        <button onClick={() => setActiveTab("employees")} style={tabBtnStyle(activeTab === "employees")}>
          👥 עובדים
        </button>
        <button onClick={() => setActiveTab("shifts")} style={tabBtnStyle(activeTab === "shifts")}>
          📅 לוח משמרות
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "shifts" ? (
        <ShiftScheduleTab user={user} employees={employees} onNavigate={onNavigate} />
      ) : (
        <>
          {/* Department filter chips */}
          {departments.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
              {allDepts.map(d => {
                const active = filterDept === d;
                const count  = d === "הכל"
                  ? employees.length
                  : employees.filter(e => e.department === d).length;
                return (
                  <button
                    key={d}
                    onClick={() => setFilterDept(d)}
                    style={{
                      padding: "6px 14px", borderRadius: 20, fontSize: 13,
                      cursor: "pointer", fontFamily: "inherit",
                      border:     active ? "none" : "1px solid var(--border)",
                      background: active ? "var(--gold)" : "var(--card-bg)",
                      color:      active ? "#412402"     : "var(--text-muted)",
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    {d} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Employee grid */}
          {displayed.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "48px 20px",
              border: "1px dashed var(--border)", borderRadius: 14,
              color: "var(--text-muted)", fontSize: 14, lineHeight: 2,
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>👤</div>
              {employees.length === 0 ? "אין עובדים במערכת עדיין." : "אין עובדים במחלקה זו."}
              {canAdd && employees.length === 0 && (
                <div>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: 12 }}
                    onClick={() => setModal({ mode: "add" })}
                  >
                    ＋ הוסף עובד ראשון
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}>
              {displayed.map(emp => (
                <EmployeeCard
                  key={emp.id}
                  emp={emp}
                  canEdit={canEdit}
                  onEdit={() => setModal({ mode: "edit", employee: emp })}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── EmployeeCard ──────────────────────────────────────────────────────────────
function EmployeeCard({ emp, canEdit, onEdit }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="card"
      style={{
        margin: 0,
        cursor:     canEdit ? "pointer" : "default",
        transition: "box-shadow 0.2s, transform 0.15s",
        boxShadow:  hovered && canEdit ? "0 8px 24px rgba(0,0,0,0.1)" : undefined,
        transform:  hovered && canEdit ? "translateY(-2px)" : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={canEdit ? onEdit : undefined}
    >
      <div style={{ padding: "18px 20px" }}>
        {/* Avatar + name row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <Initials name={emp.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 700, fontSize: 15, color: "var(--black)", marginBottom: 2,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {emp.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {emp.role || "—"}
            </div>
          </div>
          {canEdit && (
            <span style={{
              fontSize: 13,
              color: hovered ? "var(--gold)" : "var(--border)",
              transition: "color 0.2s",
            }}>
              ✏️
            </span>
          )}
        </div>

        {/* Badges */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: emp.phone ? 10 : 0 }}>
          {emp.department && (
            <span style={deptBadgeStyle(emp.department)}>{normalizeDepartmentLabel(emp.department)}</span>
          )}
          <span style={{
            display: "inline-block", fontSize: 11, fontWeight: 700,
            padding: "3px 9px", borderRadius: 20,
            background: emp.status === "פעיל" ? "#EAF3DE" : "#F1EFE8",
            color:      emp.status === "פעיל" ? "#3B6D11" : "#5F5E5A",
          }}>
            {emp.status ?? "פעיל"}
          </span>
        </div>

        {/* Phone — stops click propagation so it doesn't open edit modal */}
        {emp.phone && (
          <div
            style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}
            onClick={e => e.stopPropagation()}
          >
            📞 <a
              href={`tel:${emp.phone}`}
              style={{ color: "var(--text-muted)", textDecoration: "none" }}
            >
              {emp.phone}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
