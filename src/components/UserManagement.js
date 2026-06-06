// src/components/UserManagement.js
// Full RBAC user management — responsive: cards on mobile, table on desktop.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { isSuperAdmin } from "../utils/admin";

// ── Component-scoped CSS ──────────────────────────────────────────────────────
const CSS = `
  /* ── Mobile card grid ─────────────────────────────── */
  .um-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .um-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 20px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.05);
    transition: box-shadow 0.2s;
  }
  .um-card.suspended { opacity: 0.6; }

  .um-card-top {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-bottom: 18px;
    text-align: center;
  }

  .um-avatar {
    width: 52px; height: 52px; border-radius: 50%;
    background: linear-gradient(135deg, var(--gold), var(--gold-dark));
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 800; color: #0F0F0F;
    overflow: hidden; flex-shrink: 0;
  }
  .um-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .um-name  { font-size: 15px; font-weight: 700; color: var(--black); }
  .um-email { font-size: 12px; color: var(--text-muted); direction: ltr; }
  .um-self  { font-size: 10px; color: var(--gold-dark); font-weight: 700; }

  .um-fields { display: flex; flex-direction: column; gap: 10px; }

  .um-field-label {
    font-size: 10px; font-weight: 700; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;
  }

  .um-select {
    width: 100%; padding: 12px 14px;
    border: 1.5px solid var(--border); border-radius: 8px;
    font-family: 'Heebo', sans-serif; font-size: 14px;
    cursor: pointer; outline: none; font-weight: 600;
    -webkit-appearance: none; appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238A7A6A' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: left 12px center;
    padding-left: 36px;
  }
  .um-select:focus { border-color: var(--gold); }
  .um-select:disabled { opacity: 0.55; cursor: not-allowed; }

  .um-action-btn {
    width: 100%; padding: 13px;
    border-radius: 8px; border: none;
    font-family: 'Heebo', sans-serif; font-size: 14px; font-weight: 700;
    cursor: pointer; transition: all 0.2s;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .um-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Desktop table (768px+) ──────────────────────────── */
  @media (min-width: 768px) {
    .um-grid {
      display: none; /* hide cards */
    }
    .um-table-wrap {
      display: block; /* show table */
      overflow-x: auto;
    }
    .um-avatar {
      width: 36px; height: 36px; font-size: 13px;
    }
  }

  @media (max-width: 767px) {
    .um-table-wrap {
      display: none; /* hide table */
    }
    .um-grid {
      display: grid; /* show cards */
    }
    /* Larger touch targets on mobile */
    .um-select { min-height: 48px; }
    .um-action-btn { min-height: 48px; }
  }

  /* Saving spinner shimmer */
  @keyframes um-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  .um-saving { animation: um-pulse 1s ease-in-out infinite; }
`;

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLES = [
  { value: "super_admin", label: "👑 Super Admin" },
  { value: "admin",       label: "🔧 Admin" },
  { value: "manager",     label: "🏢 מנהל" },
  { value: "staff",       label: "👤 עובד" },
];

const ROLE_STYLE = {
  super_admin: { bg: "rgba(201,169,110,0.18)", color: "var(--gold-dark)" },
  admin:       { bg: "#F3F0FF",               color: "#5B21B6" },
  manager:     { bg: "#EEF4FF",               color: "#2952A3" },
  staff:       { bg: "var(--ivory)",           color: "var(--text-muted)" },
};

const ROLE_LABEL = {
  super_admin: "👑 Super Admin",
  admin:       "🔧 Admin",
  manager:     "🏢 מנהל",
  staff:       "👤 עובד",
};

const STATUS_STYLE = {
  active:    { bg: "#E8F5EF", color: "#1A7A4A" },
  suspended: { bg: "#FFF0EE", color: "#C0392B" },
  pending:   { bg: "#FFF5E8", color: "#B5600A" },
};
const STATUS_LABEL = { active: "פעיל", suspended: "מושעה", pending: "ממתין" };

const DEPARTMENTS = [
  "Management", "Reception", "Maintenance", "Finance",
  "Restaurant", "Cleaning", "Security", "Spa",
  "קבלה", "ניקיון", "מסעדה", "תחזוקה", "ביטחון", "ספא",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function Avatar({ user, size = 36 }) {
  return (
    <div className="um-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {user.avatar
        ? <img src={user.avatar} alt={user.name} />
        : (user.avatar_text ?? (user.name ?? "?")[0]?.toUpperCase())}
    </div>
  );
}

function RoleBadge({ role }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.staff;
  return (
    <span style={{
      padding: "4px 10px", borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color,
    }}>
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.active;
  return (
    <span style={{
      padding: "4px 10px", borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function UserCard({ u, isSelf, isSaving, canEdit, onUpdate, onToggleSuspend }) {
  return (
    <div className={`um-card ${u.status === "suspended" ? "suspended" : ""}`}>

      {/* Top: avatar + name + email */}
      <div className="um-card-top">
        <Avatar user={u} size={52} />
        <div>
          <div className="um-name">{u.name ?? "—"}</div>
          <div className="um-email">{u.email ?? "—"}</div>
          {isSelf && <div className="um-self">אתה</div>}
        </div>
        <StatusBadge status={u.status} />
      </div>

      {/* Fields */}
      <div className="um-fields">

        {/* Role */}
        <div>
          <div className="um-field-label">תפקיד</div>
          {canEdit && !isSelf ? (
            <select
              className={`um-select ${isSaving === "role" ? "um-saving" : ""}`}
              value={u.role ?? "manager"}
              onChange={(e) => onUpdate(u.id, "role", e.target.value)}
              disabled={Boolean(isSaving)}
              style={{
                background: (ROLE_STYLE[u.role] ?? ROLE_STYLE.staff).bg,
                color:      (ROLE_STYLE[u.role] ?? ROLE_STYLE.staff).color,
              }}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          ) : (
            <div style={{ padding: "10px 0" }}><RoleBadge role={u.role} /></div>
          )}
        </div>

        {/* Department */}
        <div>
          <div className="um-field-label">מחלקה</div>
          {canEdit ? (
            <select
              className={`um-select ${isSaving === "department" ? "um-saving" : ""}`}
              value={u.department ?? ""}
              onChange={(e) => onUpdate(u.id, "department", e.target.value || null)}
              disabled={Boolean(isSaving)}
              style={{ background: "var(--card-bg)", color: "var(--text-main)" }}
            >
              <option value="">— ללא מחלקה —</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <div style={{ padding: "10px 0", fontSize: 14, color: "var(--text-muted)" }}>
              {u.department ?? "—"}
            </div>
          )}
        </div>

        {/* Suspend / Activate */}
        {canEdit && !isSelf && (
          <button
            className="um-action-btn"
            onClick={() => onToggleSuspend(u)}
            disabled={Boolean(isSaving)}
            style={{
              background: u.status === "suspended" ? "#E8F5EF" : "#FFF0EE",
              color:      u.status === "suspended" ? "#1A7A4A" : "#C0392B",
              marginTop: 4,
            }}
          >
            {isSaving === "status"
              ? "שומר..."
              : u.status === "suspended" ? "✓ הפעל מחדש" : "⊘ השעה משתמש"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UserManagement({ currentUser }) {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState({});    // { [userId]: fieldName | null }
  const [toast, setToast]     = useState(null);  // { type, msg }
  const [search, setSearch]   = useState("");

  const canEdit = isSuperAdmin(currentUser);

  // ── Data ───────────────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    if (!supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) showToast("err", `שגיאה: ${error.message}`);
    else setUsers(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // ── Actions ────────────────────────────────────────────────────────────────

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  async function updateField(userId, field, value) {
    if (!canEdit) return showToast("err", "נדרשות הרשאות super_admin");
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
      showToast("ok", "עודכן ✓");
    }
    setSaving((s) => ({ ...s, [userId]: null }));
  }

  const toggleSuspend = (user) =>
    updateField(user.id, "status", user.status === "suspended" ? "active" : "suspended");

  // ── Filter ─────────────────────────────────────────────────────────────────

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
    <>
      {/* Inject component CSS once */}
      <style>{CSS}</style>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{
        display: "flex", flexWrap: "wrap",
        alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {users.length} משתמשים
          {!canEdit && (
            <span style={{ marginRight: 8, color: "#C0392B" }}>· צפייה בלבד</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: 1, justifyContent: "flex-end" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש..."
            style={{
              padding: "10px 14px",
              border: "1.5px solid var(--border)", borderRadius: 8,
              fontFamily: "Heebo, sans-serif", fontSize: 13,
              minWidth: 0, flex: "1 1 180px", maxWidth: 280,
              outline: "none", background: "var(--card-bg)",
            }}
          />
          <button className="btn btn-ghost" onClick={fetchUsers} disabled={loading} style={{ flexShrink: 0 }}>
            {loading ? "..." : "↺ רענן"}
          </button>
        </div>
      </div>

      {!supabase && (
        <div style={{
          background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10,
          padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00",
        }}>
          Supabase לא מחובר — לא ניתן לטעון משתמשים.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          טוען משתמשים...
        </div>
      ) : (
        <>
          {/* ── MOBILE: card grid ──────────────────────────── */}
          <div className="um-grid">
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                אין תוצאות
              </div>
            ) : (
              filtered.map((u) => (
                <UserCard
                  key={u.id}
                  u={u}
                  isSelf={u.id === currentUser?.id}
                  isSaving={saving[u.id]}
                  canEdit={canEdit}
                  onUpdate={updateField}
                  onToggleSuspend={toggleSuspend}
                />
              ))
            )}
          </div>

          {/* ── DESKTOP: table ──────────────────────────────── */}
          <div className="um-table-wrap">
            <div className="card">
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ minWidth: 780 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 48 }}></th>
                      <th>שם</th>
                      <th>אימייל</th>
                      <th style={{ width: 165 }}>תפקיד</th>
                      <th style={{ width: 165 }}>מחלקה</th>
                      <th style={{ width: 80 }}>סטטוס</th>
                      <th style={{ width: 110 }}>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                          אין תוצאות
                        </td>
                      </tr>
                    )}
                    {filtered.map((u) => {
                      const isSelf    = u.id === currentUser?.id;
                      const isSaving  = saving[u.id];
                      const rs        = ROLE_STYLE[u.role]   ?? ROLE_STYLE.staff;
                      const ss        = STATUS_STYLE[u.status] ?? STATUS_STYLE.active;

                      return (
                        <tr key={u.id} style={{ opacity: u.status === "suspended" ? 0.55 : 1 }}>

                          <td><Avatar user={u} size={36} /></td>

                          <td>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name ?? "—"}</div>
                            {isSelf && (
                              <div style={{ fontSize: 10, color: "var(--gold-dark)", fontWeight: 700 }}>אתה</div>
                            )}
                          </td>

                          <td>
                            <span style={{ fontSize: 13, direction: "ltr", display: "inline-block", color: "var(--text-muted)" }}>
                              {u.email ?? "—"}
                            </span>
                          </td>

                          <td>
                            {canEdit && !isSelf ? (
                              <select
                                className={`um-select ${isSaving === "role" ? "um-saving" : ""}`}
                                value={u.role ?? "manager"}
                                onChange={(e) => updateField(u.id, "role", e.target.value)}
                                disabled={Boolean(isSaving)}
                                style={{ background: rs.bg, color: rs.color, width: "100%" }}
                              >
                                {ROLES.map((r) => (
                                  <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                              </select>
                            ) : (
                              <RoleBadge role={u.role} />
                            )}
                          </td>

                          <td>
                            {canEdit ? (
                              <select
                                className={`um-select ${isSaving === "department" ? "um-saving" : ""}`}
                                value={u.department ?? ""}
                                onChange={(e) => updateField(u.id, "department", e.target.value || null)}
                                disabled={Boolean(isSaving)}
                                style={{ background: "var(--card-bg)", color: "var(--text-main)", width: "100%" }}
                              >
                                <option value="">— ללא —</option>
                                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                              </select>
                            ) : (
                              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                                {u.department ?? "—"}
                              </span>
                            )}
                          </td>

                          <td>
                            <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: ss.bg, color: ss.color }}>
                              {STATUS_LABEL[u.status] ?? u.status}
                            </span>
                          </td>

                          <td>
                            {canEdit && !isSelf && (
                              <button
                                onClick={() => toggleSuspend(u)}
                                disabled={Boolean(isSaving)}
                                className="btn btn-sm"
                                style={{
                                  background: u.status === "suspended" ? "#E8F5EF" : "#FFF0EE",
                                  color:      u.status === "suspended" ? "#1A7A4A" : "#C0392B",
                                  minWidth: 90,
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
            </div>
          </div>
        </>
      )}

      {/* Stats footer */}
      {!loading && users.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 12,
          marginTop: 14, fontSize: 12, color: "var(--text-muted)",
        }}>
          {Object.entries(
            users.reduce((acc, u) => {
              acc[u.role] = (acc[u.role] ?? 0) + 1;
              return acc;
            }, {})
          ).map(([role, count]) => (
            <span key={role}>{ROLE_LABEL[role] ?? role}: <strong>{count}</strong></span>
          ))}
          <span style={{ marginRight: "auto" }}>
            מושעים: <strong>{users.filter((u) => u.status === "suspended").length}</strong>
          </span>
        </div>
      )}
    </>
  );
}
