// src/components/ManageEmployeeModal.js
// Add / Edit / Delete employee modal — Dream Island XOS Sprint 2.
// Props:
//   mode        "add" | "edit"
//   employee    object (required when mode="edit")
//   user        current auth user (for RBAC + created_by)
//   departments string[] from loadDepartments()
//   onClose()   cancel / dismiss
//   onSaved(action)  called after success; action = "add" | "edit" | "delete"

import { useState } from "react";
import { supabase } from "../supabaseClient";
import { canPerform } from "../utils/auth";

const STATUS_OPTIONS = ["פעיל", "לא פעיל"];

const inputStyle = {
  width: "100%", padding: "11px 14px",
  border: "1.5px solid var(--border)", borderRadius: 8,
  fontFamily: "Heebo, sans-serif", fontSize: 14,
  color: "var(--black)", background: "var(--card-bg)",
  direction: "rtl", outline: "none", boxSizing: "border-box",
  transition: "border-color 0.2s",
};

const labelStyle = {
  display: "block", fontSize: 12, fontWeight: 700,
  color: "var(--text-muted)", marginBottom: 5, letterSpacing: 0.3,
};

export default function ManageEmployeeModal({
  mode, employee, user, departments, onClose, onSaved,
}) {
  const isEdit    = mode === "edit";
  const canDelete = canPerform("delete_employee", user);

  const [form, setForm] = useState({
    name:       employee?.name       ?? "",
    department: employee?.department ?? (departments[0] ?? ""),
    role:       employee?.role       ?? "",
    phone:      employee?.phone      ?? "",
    status:     employee?.status     ?? "פעיל",
  });

  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error,         setError]         = useState(null);

  const set = (k, v) => { setError(null); setForm(prev => ({ ...prev, [k]: v })); };

  // ── Save (insert or update) ───────────────────────────────────────────────
  async function handleSave() {
    if (!form.name.trim()) return setError("שם העובד הוא שדה חובה");
    if (!supabase) return setError("Supabase לא מחובר");
    setSaving(true);
    setError(null);

    let err;
    if (isEdit) {
      ({ error: err } = await supabase
        .from("employees")
        .update({ ...form, name: form.name.trim() })
        .eq("id", employee.id));
    } else {
      ({ error: err } = await supabase
        .from("employees")
        .insert({ ...form, name: form.name.trim(), created_by: user?.id ?? null }));
    }

    if (err) {
      setError("שגיאה בשמירה: " + err.message);
      setSaving(false);
    } else {
      onSaved(isEdit ? "edit" : "add");
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!isEdit || !employee?.id || !supabase) return;
    setDeleting(true);
    setError(null);
    const { error: err } = await supabase
      .from("employees")
      .delete()
      .eq("id", employee.id);
    if (err) {
      setError("שגיאה במחיקה: " + err.message);
      setDeleting(false);
    } else {
      onSaved("delete");
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      onClick={() => { setConfirmDelete(false); onClose(); }}
    >
      <div
        style={{
          background: "var(--card-bg)", borderRadius: 18, padding: 32,
          width: "100%", maxWidth: 500, direction: "rtl",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          maxHeight: "90vh", overflowY: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--black)" }}>
            {isEdit ? "✏️ עריכת עובד" : "➕ הוסף עובד חדש"}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", fontSize: 20,
              cursor: "pointer", color: "var(--text-muted)", lineHeight: 1, padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Form fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Name */}
          <div>
            <label style={labelStyle}>שם מלא *</label>
            <input
              style={inputStyle}
              placeholder="שם פרטי + משפחה"
              value={form.name}
              onChange={e => set("name", e.target.value)}
              onFocus={e => (e.target.style.borderColor = "var(--gold)")}
              onBlur={e  => (e.target.style.borderColor = "var(--border)")}
              autoFocus
            />
          </div>

          {/* Department + Role */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>מחלקה</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.department}
                onChange={e => set("department", e.target.value)}
              >
                {departments.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>תפקיד</label>
              <input
                style={inputStyle}
                placeholder="לדוגמה: מנהל משמרת"
                value={form.role}
                onChange={e => set("role", e.target.value)}
                onFocus={e => (e.target.style.borderColor = "var(--gold)")}
                onBlur={e  => (e.target.style.borderColor = "var(--border)")}
              />
            </div>
          </div>

          {/* Phone + Status */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>טלפון</label>
              <input
                style={inputStyle}
                placeholder="05X-XXXXXXX"
                value={form.phone}
                onChange={e => set("phone", e.target.value)}
                onFocus={e => (e.target.style.borderColor = "var(--gold)")}
                onBlur={e  => (e.target.style.borderColor = "var(--border)")}
              />
            </div>
            <div>
              <label style={labelStyle}>סטטוס</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.status}
                onChange={e => set("status", e.target.value)}
              >
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            marginTop: 14, padding: "10px 14px", borderRadius: 8,
            background: "#FCEBEB", color: "#A32D2D", fontSize: 13, fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Save / Cancel */}
        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 600,
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
              border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)",
            }}
          >
            ביטול
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 800,
              cursor: saving ? "not-allowed" : "pointer", fontFamily: "Heebo, sans-serif",
              border: "none", background: "var(--gold)", color: "#412402",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "⏳ שומר..." : isEdit ? "💾 שמור שינויים" : "➕ הוסף עובד"}
          </button>
        </div>

        {/* ── Delete zone — admin+ only, edit mode only ─────────────────── */}
        {isEdit && canDelete && (
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px dashed var(--border)" }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  width: "100%", padding: "10px 0", borderRadius: 10,
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                  fontFamily: "Heebo, sans-serif",
                  border: "1.5px solid #E24B4A", background: "transparent", color: "#E24B4A",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.target.style.background = "#FCEBEB")}
                onMouseLeave={e => (e.target.style.background = "transparent")}
              >
                🗑️ מחק עובד
              </button>
            ) : (
              <div style={{
                background: "#FCEBEB", borderRadius: 10, padding: "14px 16px",
                border: "1px solid #E24B4A",
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#A32D2D", marginBottom: 12 }}>
                  ⚠️ פעולה זו בלתי הפיכה. למחוק את <strong>{employee?.name}</strong>?
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    style={{
                      flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 600,
                      cursor: "pointer", fontFamily: "Heebo, sans-serif",
                      border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)",
                    }}
                  >
                    ביטול
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{
                      flex: 2, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 800,
                      cursor: deleting ? "not-allowed" : "pointer", fontFamily: "Heebo, sans-serif",
                      border: "none", background: "#E24B4A", color: "#fff",
                      opacity: deleting ? 0.7 : 1,
                    }}
                  >
                    {deleting ? "⏳ מוחק..." : "✓ כן, מחק לצמיתות"}
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
