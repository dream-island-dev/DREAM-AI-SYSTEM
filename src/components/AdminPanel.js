// src/components/AdminPanel.js
// Admin-only management interface. Owner: tzalamnadlan@gmail.com (super_admin).
// Features: system stats, departments CRUD, all chat history, user list.
import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { loadDepartments, saveDepartments, DEFAULT_DEPARTMENTS } from "../utils/admin";

const T = {
  gold: "var(--gold)", goldDark: "var(--gold-dark)",
  black: "var(--black)", muted: "var(--text-muted)",
  border: "var(--border)", card: "var(--card-bg)", ivory: "var(--ivory)",
};

const TABS = [
  { id: "stats",   icon: "📊", label: "סטטיסטיקות" },
  { id: "depts",   icon: "🏢", label: "מחלקות" },
  { id: "chats",   icon: "💬", label: "שיחות" },
  { id: "users",   icon: "👥", label: "משתמשים" },
];

// ── Stats tab ─────────────────────────────────────────────────────────────────

function StatsTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      if (!supabase) { setLoading(false); return; }
      try {
        const [msgs, agents, sessions] = await Promise.all([
          supabase.from("chat_history").select("id", { count: "exact", head: true }),
          supabase.from("agent_profiles").select("id", { count: "exact", head: true }),
          supabase.from("chat_history").select("session_id"),
        ]);
        const uniqueSessions = new Set((sessions.data ?? []).map((r) => r.session_id)).size;
        setStats({
          totalMessages: msgs.count ?? 0,
          totalAgents:   agents.count ?? 0,
          totalSessions: uniqueSessions,
        });
      } catch { setStats(null); }
      setLoading(false);
    }
    fetchStats();
  }, []);

  if (loading) return <div style={{ color: T.muted, padding: 20 }}>טוען נתונים...</div>;
  if (!supabase) return (
    <div style={{ color: T.muted, padding: 20 }}>
      Supabase לא מחובר — נתונים אינם זמינים.
    </div>
  );

  const cards = [
    { icon: "💬", value: stats?.totalMessages ?? "—", label: "הודעות בסה״כ" },
    { icon: "🔑", value: stats?.totalSessions ?? "—", label: "שיחות פעילות" },
    { icon: "🤖", value: stats?.totalAgents ?? "—",   label: "פרופילי סוכן" },
    { icon: "🏝️", value: loadDepartments().length,    label: "מחלקות פעילות" },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 24 }}>
        {cards.map((c) => (
          <div key={c.label} className="stat-card">
            <div className="stat-icon">{c.icon}</div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title">🔧 מידע מערכת</div></div>
        <div style={{ padding: 20, fontSize: 13, color: T.muted, lineHeight: 2 }}>
          <div>🟢 Supabase: מחובר</div>
          <div>🟢 Edge Function: <code>chat</code></div>
          <div>👑 בעלים (Super-Admin): tzalamnadlan@gmail.com</div>
          <div>📧 אדמין: promote7il@gmail.com</div>
          <div>📦 גרסת DB Schema: 004</div>
        </div>
      </div>
    </div>
  );
}

// ── Departments tab ───────────────────────────────────────────────────────────

function DeptsTab() {
  const [depts, setDepts] = useState(loadDepartments());
  const [newDept, setNewDept] = useState("");
  const [saved, setSaved] = useState(false);

  const add = () => {
    const trimmed = newDept.trim();
    if (!trimmed || depts.includes(trimmed)) return;
    const updated = [...depts, trimmed];
    setDepts(updated);
    saveDepartments(updated);
    setNewDept("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const remove = (dept) => {
    if (!window.confirm(`למחוק את מחלקת "${dept}"?`)) return;
    const updated = depts.filter((d) => d !== dept);
    setDepts(updated);
    saveDepartments(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const reset = () => {
    if (!window.confirm("לאפס לרשימת ברירת המחדל?")) return;
    saveDepartments(DEFAULT_DEPARTMENTS);
    setDepts([...DEFAULT_DEPARTMENTS]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const DEPT_COLORS = {
    קבלה: "#3498db", ניקיון: "#2ecc71", מסעדה: "#e67e22",
    תחזוקה: "#e74c3c", ביטחון: "#9b59b6", ספא: "#1abc9c",
  };

  return (
    <div>
      {saved && (
        <div style={{ background: "#E8F5EF", border: "1px solid #1A7A4A", borderRadius: 8, padding: "10px 16px", marginBottom: 16, color: "#1A7A4A", fontSize: 13 }}>
          ✓ השינויים נשמרו — יכנסו לתוקף בטעינה הבאה של הדף
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">מחלקות פעילות ({depts.length})</div>
          <button className="btn btn-ghost btn-sm" onClick={reset}>↺ אפס</button>
        </div>
        <div className="card-body">
          {depts.map((dept) => (
            <div key={dept} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: DEPT_COLORS[dept] || T.gold }} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>{dept}</span>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => remove(dept)}>✕ מחק</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ padding: 20 }}>
          <div className="card-title" style={{ marginBottom: 16 }}>➕ הוסף מחלקה חדשה</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="שם המחלקה החדשה..."
              style={{ flex: 1, padding: "12px 14px", border: `1.5px solid ${T.border}`, borderRadius: 8, fontFamily: "Heebo, sans-serif", fontSize: 14, outline: "none" }}
            />
            <button className="btn btn-primary" onClick={add} disabled={!newDept.trim()}>הוסף</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chats tab ─────────────────────────────────────────────────────────────────

function ChatsTab() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase
      .from("chat_history")
      .select("session_id, manager_id, agent_id, role, content, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => { setRows(data ?? []); setLoading(false); });
  }, []);

  if (loading) return <div style={{ color: T.muted, padding: 20 }}>טוען שיחות...</div>;
  if (!supabase) return <div style={{ color: T.muted, padding: 20 }}>Supabase לא מחובר.</div>;

  // Group by session
  const sessions = rows.reduce((acc, r) => {
    if (!acc[r.session_id]) acc[r.session_id] = { session_id: r.session_id, manager_id: r.manager_id, msgs: [], last_at: r.created_at };
    acc[r.session_id].msgs.push(r);
    return acc;
  }, {});

  const sessionList = Object.values(sessions).sort((a, b) => b.last_at.localeCompare(a.last_at));

  return (
    <div>
      <div style={{ fontSize: 13, color: T.muted, marginBottom: 16 }}>
        {sessionList.length} שיחות | {rows.length} הודעות סה"כ
      </div>
      {sessionList.map((s) => (
        <div key={s.session_id} className="card" style={{ marginBottom: 12 }}>
          <div
            className="card-header"
            style={{ cursor: "pointer" }}
            onClick={() => setExpanded(expanded === s.session_id ? null : s.session_id)}
          >
            <div>
              <div className="card-title" style={{ fontSize: 13 }}>
                🔑 {s.session_id.slice(-12)}
              </div>
              <div style={{ fontSize: 11, color: T.muted }}>
                {s.msgs.length} הודעות · מנהל: {s.manager_id?.slice(0, 12) ?? "—"} · {new Date(s.last_at).toLocaleString("he-IL")}
              </div>
            </div>
            <span style={{ color: T.muted }}>{expanded === s.session_id ? "▲" : "▼"}</span>
          </div>
          {expanded === s.session_id && (
            <div style={{ padding: "12px 20px", background: T.ivory, maxHeight: 320, overflowY: "auto" }}>
              {s.msgs.slice().reverse().map((m, i) => (
                <div key={i} style={{ marginBottom: 10, textAlign: m.role === "user" ? "right" : "left" }}>
                  <div style={{
                    display: "inline-block", maxWidth: "80%", padding: "8px 12px",
                    borderRadius: 10, fontSize: 13, lineHeight: 1.5,
                    background: m.role === "user" ? "linear-gradient(135deg, var(--gold), var(--gold-dark))" : "#fff",
                    color: m.role === "user" ? "#0F0F0F" : T.black,
                    border: m.role === "user" ? "none" : `1px solid ${T.border}`,
                  }}>
                    {m.content}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                    {new Date(m.created_at).toLocaleTimeString("he-IL")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {sessionList.length === 0 && (
        <div style={{ textAlign: "center", color: T.muted, padding: 40 }}>אין שיחות עדיין</div>
      )}
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ mockUsers }) {
  const [dbUsers, setDbUsers] = useState([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("profiles").select("*").order("created_at")
      .then(({ data }) => setDbUsers(data ?? []));
  }, []);

  const roleBadge = (role) => (
    <span className={`badge ${role === "admin" ? "badge-gold" : "badge-blue"}`}>
      {role === "admin" ? "👑 Admin" : "מנהל"}
    </span>
  );

  return (
    <div>
      {dbUsers.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">👥 משתמשי Supabase ({dbUsers.length})</div></div>
          <table className="table">
            <thead><tr><th>שם</th><th>אימייל</th><th>מחלקה</th><th>תפקיד</th><th>נרשם</th></tr></thead>
            <tbody>
              {dbUsers.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td style={{ direction: "ltr" }}>{u.email}</td>
                  <td>{u.department || "—"}</td>
                  <td>{roleBadge(u.role)}</td>
                  <td style={{ fontSize: 11, color: T.muted }}>{new Date(u.created_at).toLocaleDateString("he-IL")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-header"><div className="card-title">🎭 משתמשי דמו (Mock)</div></div>
        <table className="table">
          <thead><tr><th>שם</th><th>אימייל</th><th>מחלקה</th><th>תפקיד</th></tr></thead>
          <tbody>
            {mockUsers.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.name}</td>
                <td style={{ direction: "ltr", fontSize: 12 }}>{u.email}</td>
                <td>{u.department || "—"}</td>
                <td>{roleBadge(u.role)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main AdminPanel ───────────────────────────────────────────────────────────

export default function AdminPanel({ user, mockUsers }) {
  const [tab, setTab] = useState("stats");

  return (
    <div>
      {/* Admin identity badge */}
      <div style={{
        background: "linear-gradient(135deg, rgba(201,169,110,0.15), rgba(201,169,110,0.05))",
        border: "1px solid rgba(201,169,110,0.4)",
        borderRadius: 12, padding: "12px 20px", marginBottom: 24,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ fontSize: 22 }}>👑</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: T.black }}>לוח ניהול מערכת</div>
          <div style={{ fontSize: 12, color: T.muted }}>מחובר כ: {user?.name} · {user?.email}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: `1px solid ${T.border}`, paddingBottom: 0 }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "10px 18px", border: "none", cursor: "pointer",
              fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              background: "none",
              color: tab === t.id ? "var(--gold-dark)" : T.muted,
              borderBottom: tab === t.id ? "2px solid var(--gold)" : "2px solid transparent",
              transition: "all 0.2s",
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "stats" && <StatsTab />}
      {tab === "depts" && <DeptsTab />}
      {tab === "chats" && <ChatsTab />}
      {tab === "users" && <UsersTab mockUsers={mockUsers ?? []} />}
    </div>
  );
}
