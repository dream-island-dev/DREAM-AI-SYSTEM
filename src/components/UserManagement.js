// src/components/UserManagement.js
// Full RBAC user management — visible to super_admin only.
// Inline role/department dropdowns update Supabase directly.
// Suspend button toggles status between 'active' ↔ 'suspended'.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { isSuperAdmin } from "../utils/admin";

// ── Constants ────────────────────────────────────────────────────────────────

const ROLES = [
  { value: "super_admin", label: "👑 Super Admin" },
  { value: "admin",       label: "🔧 Admin" },
  { value: "manager",     label: "🏢 מנהל" },
  { value: "staff",       label: "👤 עובד" },
];

const ROLE_BADGE = {
  super_admin: { bg: "rgba(201,169,110,0.2)", color: "var(--gold-dark)", text: "👑 Super Admin" },
  admin:       { bg: "#F3F0FF",               color: "#5B21B6",          text: "🔧 Admin" },
  manager:     { bg: "#EEF4FF",               color: "#2952A3",          text: "🏢 מנהל" },
  staff:       { bg: "var(--ivory)",           color: "var(--text-muted)",text: "👤 עובד" },
};

const STATUS_BADGE = {
  active:    { bg: "#E8F5EF", color: "#1A7A4A", text: "פעיל" },
  suspended: { bg: "#FFF0EE", color: "#C0392B", text: "מושעה" },
  pending:   { bg: "#FFF5E8", color: "#B5600A", text: "ממתין" },
};

const DEPARTMENTS = [
  "Management", "Reception", "Maintenance", "Finance",
  "Restaurant", "Cleaning", "Security", "Spa",
  "קבלה", "ניקיון", "מסעדה", "תחזוקה", "ביטחון", "ספא",
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function UserManagement({ currentUser }) {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState({});   // { [userId]: field | null }
  const [toast, setToast]     = useState(null); // { type: 'ok'|'err', msg }
  const [search, setSearch]   = useState("");

  const canEdit = isSuperAdmin(currentUser);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    if (!supabase) { setLoading(false); return; }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) showToast("err", `שגיאה בטעינה: ${error.message}`);
    else setUsers(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  async function updateField(userId, field, value) {
    if (!canEdit) return showToast("err", "אין לך הרשאות לשנות נתונים");
    if (!supabase) return showToast("err", "Supabase לא מחובר");

    setSaving((s) => ({ ...s, [userId]: field }));

    const { error } = await supabase
      .from("profiles")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) {
      showToast("err", `שגיאה: ${error.message}`);
    } else {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, [field]: value } : u))
      );
      showToast("ok", "עודכן בהצלחה ✓");
    }
    setSaving((s) => ({ ...s, [userId]: null }));
  }

  async function toggleSuspend(user) {
    const next = user.status === "suspended" ? "active" : "suspended";
    await updateField(user.id, "status", next);
  }

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (u.name  ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.role  ?? "").toLowerCase().includes(q) ||
      (u.department ?? "").toLowerCase().includes(q)
    );
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10, fontWeight: 700,
          fontSize: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
          transition: "all 0.2s",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {users.length} משתמשים במערכת
            {!canEdit && (
              <span style={{ marginRight: 8, color: "#C0392B" }}>
                (צפייה בלבד — נדרש super_admin לעריכה)
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם / אימייל / תפקיד..."
            style={{
              padding: "10px 14px", border: "1.5px solid var(--border)",
              borderRadius: 8, fontFamily: "Heebo, sans-serif", fontSize: 13,
              width: 260, outline: "none", background: "var(--card-bg)",
            }}
          />
          <button className="btn btn-ghost" onClick={fetchUsers} disabled={loading}>
            {loading ? "..." : "↺ רענן"}
          </button>
        </div>
      </div>

      {/* No Supabase warning */}
      {!supabase && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון משתמשים אמיתיים.
        </div>
      )}

      {/* Table */}
      <div className="card">
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            טוען משתמשים...
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ width: 48 }}></th>
                  <th>שם</th>
                  <th>אימייל</th>
                  <th style={{ width: 170 }}>תפקיד</th>
                  <th style={{ width: 170 }}>מחלקה</th>
                  <th style={{ width: 90 }}>סטטוס</th>
                  <th style={{ width: 110 }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>אין תוצאות</td></tr>
                )}

                {filtered.map((u) => {
                  const isSelf    = u.id === currentUser?.id;
                  const isSaving  = saving[u.id];
                  const roleMeta  = ROLE_BADGE[u.role]  ?? ROLE_BADGE.staff;
                  const statMeta  = STATUS_BADGE[u.status] ?? STATUS_BADGE.active;

                  return (
                    <tr key={u.id} style={{ opacity: u.status === "suspended" ? 0.55 : 1 }}>

                      {/* Avatar */}
                      <td>
                        <div style={{
                          width: 36, height: 36, borderRadius: "50%",
                          background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 800, color: "#0F0F0F",
                          overflow: "hidden", flexShrink: 0,
                        }}>
                          {u.avatar
                            ? <img src={u.avatar} alt={u.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : (u.avatar_text ?? (u.name ?? "?")[0]?.toUpperCase())
                          }
                        </div>
                      </td>

                      {/* Name */}
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name ?? "—"}</div>
                        {isSelf && (
                          <div style={{ fontSize: 10, color: "var(--gold-dark)", fontWeight: 600 }}>אתה</div>
                        )}
                      </td>

                      {/* Email */}
                      <td>
                        <span style={{ fontSize: 13, direction: "ltr", display: "inline-block", color: "var(--text-muted)" }}>
                          {u.email ?? "—"}
                        </span>
                      </td>

                      {/* Role dropdown */}
                      <td>
                        {canEdit && !isSelf ? (
                          <div style={{ position: "relative" }}>
                            <select
                              value={u.role ?? "manager"}
                              onChange={(e) => updateField(u.id, "role", e.target.value)}
                              disabled={Boolean(isSaving)}
                              style={{
                                width: "100%", padding: "7px 10px",
                                border: "1.5px solid var(--border)", borderRadius: 7,
                                fontFamily: "Heebo, sans-serif", fontSize: 13,
                                background: roleMeta.bg, color: roleMeta.color,
                                cursor: "pointer", fontWeight: 700, outline: "none",
                              }}
                            >
                              {ROLES.map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                              ))}
                            </select>
                            {isSaving === "role" && (
                              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--text-muted)" }}>
                                שומר...
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: roleMeta.bg, color: roleMeta.color }}>
                            {roleMeta.text}
                          </span>
                        )}
                      </td>

                      {/* Department dropdown */}
                      <td>
                        {canEdit ? (
                          <select
                            value={u.department ?? ""}
                            onChange={(e) => updateField(u.id, "department", e.target.value || null)}
                            disabled={Boolean(isSaving)}
                            style={{
                              width: "100%", padding: "7px 10px",
                              border: "1.5px solid var(--border)", borderRadius: 7,
                              fontFamily: "Heebo, sans-serif", fontSize: 13,
                              background: "var(--card-bg)", cursor: "pointer", outline: "none",
                            }}
                          >
                            <option value="">— ללא מחלקה —</option>
                            {DEPARTMENTS.map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                            {u.department ?? "—"}
                          </span>
                        )}
                      </td>

                      {/* Status badge */}
                      <td>
                        <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: statMeta.bg, color: statMeta.color }}>
                          {statMeta.text}
                        </span>
                      </td>

                      {/* Actions */}
                      <td>
                        {canEdit && !isSelf && (
                          <button
                            onClick={() => toggleSuspend(u)}
                            disabled={Boolean(isSaving)}
                            className="btn btn-sm"
                            style={{
                              background: u.status === "suspended" ? "#E8F5EF" : "#FFF0EE",
                              color:      u.status === "suspended" ? "#1A7A4A" : "#C0392B",
                              minWidth: 88,
                            }}
                          >
                            {isSaving === "status"
                              ? "..."
                              : u.status === "suspended" ? "✓ הפעל" : "⊘ השעה"}
                          </button>
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

      {/* Stats footer */}
      {!loading && users.length > 0 && (
        <div style={{ display: "flex", gap: 20, marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>
          {Object.entries(
            users.reduce((acc, u) => { acc[u.role] = (acc[u.role] ?? 0) + 1; return acc; }, {})
          ).map(([role, count]) => (
            <span key={role}>
              {ROLE_BADGE[role]?.text ?? role}: <strong>{count}</strong>
            </span>
          ))}
          <span style={{ marginRight: "auto" }}>
            מושעים: <strong>{users.filter((u) => u.status === "suspended").length}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
