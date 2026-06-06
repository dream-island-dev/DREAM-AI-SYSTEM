// src/components/UserManagement.js
// RBAC user management — fully responsive.
// Uses JS-based breakpoint detection (more reliable than injected CSS media queries).
// Mobile (<768px): vertical card per user with full-width controls.
// Desktop (≥768px): classic data table.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { isSuperAdmin } from "../utils/admin";

// ── Responsive hook ───────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, [breakpoint]);
  return mobile;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLES = [
  { value: "super_admin", label: "👑 Super Admin" },
  { value: "admin",       label: "🔧 Admin" },
  { value: "manager",     label: "🏢 מנהל" },
  { value: "staff",       label: "👤 עובד" },
];

const ROLE_META = {
  super_admin: { bg: "rgba(201,169,110,0.2)", color: "var(--gold-dark)", label: "👑 Super Admin" },
  admin:       { bg: "#F3F0FF",               color: "#5B21B6",          label: "🔧 Admin" },
  manager:     { bg: "#EEF4FF",               color: "#2952A3",          label: "🏢 מנהל" },
  staff:       { bg: "var(--ivory)",           color: "var(--text-muted)",label: "👤 עובד" },
};

const STATUS_META = {
  active:    { bg: "#E8F5EF", color: "#1A7A4A", label: "פעיל" },
  suspended: { bg: "#FFF0EE", color: "#C0392B", label: "מושעה" },
  pending:   { bg: "#FFF5E8", color: "#B5600A", label: "ממתין" },
};

const DEPARTMENTS = [
  "Management","Reception","Maintenance","Finance",
  "Restaurant","Cleaning","Security","Spa",
  "קבלה","ניקיון","מסעדה","תחזוקה","ביטחון","ספא",
];

// ── Shared UI atoms ───────────────────────────────────────────────────────────

function Avatar({ user, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.35, fontWeight: 800, color: "#0F0F0F",
      overflow: "hidden",
    }}>
      {user.avatar
        ? <img src={user.avatar} alt={user.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : (user.avatar_text ?? (user.name ?? "?")[0]?.toUpperCase())}
    </div>
  );
}

function RolePill({ role }) {
  const m = ROLE_META[role] ?? ROLE_META.staff;
  return (
    <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

function StatusPill({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.active;
  return (
    <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color }}>
      {m.label}
    </span>
  );
}

// Shared dropdown style builder
function dropdownStyle(bg, color) {
  return {
    width: "100%", padding: "11px 14px",
    border: "1.5px solid var(--border)", borderRadius: 8,
    fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 600,
    cursor: "pointer", outline: "none",
    background: bg ?? "var(--card-bg)",
    color: color ?? "var(--text-main)",
    appearance: "none", WebkitAppearance: "none",
  };
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function UserCard({ u, isSelf, saving, canEdit, onUpdate, onToggle }) {
  const roleMeta   = ROLE_META[u.role]     ?? ROLE_META.staff;
  const statusMeta = STATUS_META[u.status] ?? STATUS_META.active;
  const isSuspended = u.status === "suspended";

  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: 20,
      boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
      opacity: isSuspended ? 0.6 : 1,
      transition: "opacity 0.2s",
    }}>

      {/* ── Top: avatar + info (centered) ── */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 20, textAlign: "center" }}>
        <Avatar user={u} size={56} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--black)" }}>
            {u.name ?? "—"}
            {isSelf && <span style={{ marginRight: 6, fontSize: 11, color: "var(--gold-dark)", fontWeight: 600 }}>אתה</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", direction: "ltr", marginTop: 2 }}>
            {u.email ?? "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <StatusPill status={u.status} />
          {(!canEdit || isSelf) && <RolePill role={u.role} />}
        </div>
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Role dropdown */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            תפקיד
          </div>
          {canEdit && !isSelf ? (
            <div style={{ position: "relative" }}>
              <select
                value={u.role ?? "staff"}
                onChange={(e) => onUpdate(u.id, "role", e.target.value)}
                disabled={Boolean(saving)}
                style={{
                  ...dropdownStyle(roleMeta.bg, roleMeta.color),
                  minHeight: 48,
                  opacity: saving === "role" ? 0.5 : 1,
                }}
              >
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              {saving === "role" && (
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-muted)" }}>
                  שומר...
                </span>
              )}
            </div>
          ) : (
            <div style={{ padding: "10px 0" }}><RolePill role={u.role} /></div>
          )}
        </div>

        {/* Department dropdown */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            מחלקה
          </div>
          {canEdit ? (
            <select
              value={u.department ?? ""}
              onChange={(e) => onUpdate(u.id, "department", e.target.value || null)}
              disabled={Boolean(saving)}
              style={{
                ...dropdownStyle(),
                minHeight: 48,
                opacity: saving === "department" ? 0.5 : 1,
              }}
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
            onClick={() => onToggle(u)}
            disabled={Boolean(saving)}
            style={{
              width: "100%", minHeight: 48, marginTop: 4,
              padding: "0 16px", borderRadius: 8, border: "none",
              fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.5 : 1,
              background: isSuspended ? "#E8F5EF" : "#FFF0EE",
              color:      isSuspended ? "#1A7A4A" : "#C0392B",
              transition: "all 0.2s",
            }}
          >
            {saving === "status"
              ? "שומר..."
              : isSuspended ? "✓ הפעל מחדש" : "⊘ השעה משתמש"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UserManagement({ currentUser }) {
  const isMobile   = useIsMobile();
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState({});   // { [userId]: fieldName | null }
  const [toast, setToast]     = useState(null); // { type: 'ok'|'err', msg }
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
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, [field]: value } : u));
      showToast("ok", "עודכן ✓");
    }
    setSaving((s) => ({ ...s, [userId]: null }));
  }

  const toggleSuspend = (u) =>
    updateField(u.id, "status", u.status === "suspended" ? "active" : "suspended");

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (u.name ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.role ?? "").toLowerCase().includes(q) ||
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
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 14, whiteSpace: "nowrap",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {users.length} משתמשים
          {!canEdit && <span style={{ marginRight: 8, color: "#C0392B" }}>· צפייה בלבד</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flex: 1, justifyContent: "flex-end" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש..."
            style={{
              padding: "10px 14px",
              border: "1.5px solid var(--border)", borderRadius: 8,
              fontFamily: "Heebo, sans-serif", fontSize: 13,
              minWidth: 0, flex: "1 1 140px", maxWidth: 260,
              outline: "none", background: "var(--card-bg)",
            }}
          />
          <button className="btn btn-ghost btn-sm" onClick={fetchUsers} disabled={loading} style={{ flexShrink: 0 }}>
            {loading ? "..." : "↺"}
          </button>
        </div>
      </div>

      {!supabase && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון משתמשים.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          טוען משתמשים...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          אין תוצאות
        </div>
      ) : isMobile ? (

        /* ════════════════════ MOBILE — cards ════════════════════ */
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          {filtered.map((u) => (
            <UserCard
              key={u.id}
              u={u}
              isSelf={u.id === currentUser?.id}
              saving={saving[u.id] ?? null}
              canEdit={canEdit}
              onUpdate={updateField}
              onToggle={toggleSuspend}
            />
          ))}
        </div>

      ) : (

        /* ════════════════════ DESKTOP — table ════════════════════ */
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th style={{ width: 52 }}></th>
                  <th>שם</th>
                  <th>אימייל</th>
                  <th style={{ width: 165 }}>תפקיד</th>
                  <th style={{ width: 165 }}>מחלקה</th>
                  <th style={{ width: 80 }}>סטטוס</th>
                  <th style={{ width: 110 }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isSelf   = u.id === currentUser?.id;
                  const isSaving = saving[u.id];
                  const rm       = ROLE_META[u.role]     ?? ROLE_META.staff;
                  const sm       = STATUS_META[u.status] ?? STATUS_META.active;

                  return (
                    <tr key={u.id} style={{ opacity: u.status === "suspended" ? 0.55 : 1 }}>

                      <td><Avatar user={u} size={36} /></td>

                      <td>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{u.name ?? "—"}</div>
                        {isSelf && <div style={{ fontSize: 10, color: "var(--gold-dark)", fontWeight: 700 }}>אתה</div>}
                      </td>

                      <td>
                        <span style={{ fontSize: 12, direction: "ltr", display: "inline-block", color: "var(--text-muted)" }}>
                          {u.email ?? "—"}
                        </span>
                      </td>

                      {/* Role */}
                      <td>
                        {canEdit && !isSelf ? (
                          <select
                            value={u.role ?? "staff"}
                            onChange={(e) => updateField(u.id, "role", e.target.value)}
                            disabled={Boolean(isSaving)}
                            style={{
                              ...dropdownStyle(rm.bg, rm.color),
                              opacity: isSaving === "role" ? 0.5 : 1,
                            }}
                          >
                            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                        ) : (
                          <RolePill role={u.role} />
                        )}
                      </td>

                      {/* Department */}
                      <td>
                        {canEdit ? (
                          <select
                            value={u.department ?? ""}
                            onChange={(e) => updateField(u.id, "department", e.target.value || null)}
                            disabled={Boolean(isSaving)}
                            style={{
                              ...dropdownStyle(),
                              opacity: isSaving === "department" ? 0.5 : 1,
                            }}
                          >
                            <option value="">— ללא —</option>
                            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{u.department ?? "—"}</span>
                        )}
                      </td>

                      {/* Status */}
                      <td>
                        <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: sm.bg, color: sm.color }}>
                          {sm.label}
                        </span>
                      </td>

                      {/* Action */}
                      <td>
                        {canEdit && !isSelf && (
                          <button
                            onClick={() => toggleSuspend(u)}
                            disabled={Boolean(isSaving)}
                            className="btn btn-sm"
                            style={{
                              minWidth: 90,
                              background: u.status === "suspended" ? "#E8F5EF" : "#FFF0EE",
                              color:      u.status === "suspended" ? "#1A7A4A" : "#C0392B",
                            }}
                          >
                            {isSaving === "status" ? "..." : u.status === "suspended" ? "✓ הפעל" : "⊘ השעה"}
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
      )}

      {/* Footer stats */}
      {!loading && users.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>
          {Object.entries(users.reduce((acc, u) => { acc[u.role] = (acc[u.role] ?? 0) + 1; return acc; }, {}))
            .map(([role, n]) => (
              <span key={role}>{(ROLE_META[role] ?? ROLE_META.staff).label}: <strong>{n}</strong></span>
            ))}
          <span style={{ marginRight: "auto" }}>
            מושעים: <strong>{users.filter((u) => u.status === "suspended").length}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
