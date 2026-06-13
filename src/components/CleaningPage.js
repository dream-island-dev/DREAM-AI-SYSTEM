import { useState, useEffect } from "react";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

const DEFAULT_TASKS = [
  "פינוי מגבות ופריטים",
  "החלפת מצעים ושמיכות",
  "ניקוי חדר רחצה",
  "ריחוף ושאיבת רצפות",
  "מילוי צרכי רחצה",
  "ניקוי מטבחון / מיני בר",
  "בדיקה כללית",
];

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export default function CleaningPage({ roomId }) {
  const [room, setRoom]           = useState(null);
  const [tasks, setTasks]         = useState([]);
  const [checked, setChecked]     = useState({});
  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus]       = useState("idle"); // idle | cleaning | done | issue
  const [issueNote, setIssueNote] = useState("");
  const [showIssue, setShowIssue] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  useEffect(() => {
    async function load() {
      if (!SUPABASE_URL || !roomId) {
        setRoom({ name: "אמטיסט", type: "סוויטת VIP" });
        setTasks(DEFAULT_TASKS.map((label, i) => ({ id: String(i), label })));
        setLoading(false);
        return;
      }
      try {
        const [roomData] = await sbFetch(`rooms?id=eq.${roomId}&select=id,name,type`);
        if (!roomData) { setError("חדר לא נמצא"); setLoading(false); return; }
        setRoom(roomData);

        const taskData = await sbFetch(
          `cleaning_tasks?room_id=eq.${roomId}&is_active=eq.true&order=sort_order.asc`
        );
        setTasks(taskData.length ? taskData : DEFAULT_TASKS.map((label, i) => ({ id: String(i), label })));
      } catch {
        setRoom({ name: "חדר", type: "" });
        setTasks(DEFAULT_TASKS.map((label, i) => ({ id: String(i), label })));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [roomId]);

  async function startCleaning() {
    setStatus("cleaning");
    if (!SUPABASE_URL) return;
    try {
      await sbFetch(`rooms?id=eq.${roomId}`, { method: "PATCH", body: JSON.stringify({ status: "cleaning" }) });
      const [session] = await sbFetch("cleaning_sessions", {
        method: "POST",
        body: JSON.stringify({ room_id: roomId, status: "in_progress" }),
      });
      if (session) setSessionId(session.id);
    } catch {}
  }

  async function finishCleaning() {
    const completedIds = Object.keys(checked).filter(k => checked[k]);
    setStatus("done");
    if (!SUPABASE_URL) return;
    try {
      await sbFetch(`rooms?id=eq.${roomId}`, { method: "PATCH", body: JSON.stringify({ status: "free", current_guest: null, checkout_date: null }) });
      if (sessionId) {
        await sbFetch(`cleaning_sessions?id=eq.${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "done", completed_at: new Date().toISOString(), completed_tasks: completedIds }),
        });
      }
    } catch {}
  }

  async function reportIssue() {
    if (!issueNote.trim()) return;
    setStatus("issue");
    setShowIssue(false);
    if (!SUPABASE_URL) return;
    try {
      await sbFetch(`rooms?id=eq.${roomId}`, { method: "PATCH", body: JSON.stringify({ status: "maintenance" }) });
      if (sessionId) {
        await sbFetch(`cleaning_sessions?id=eq.${sessionId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "issue", issue_note: issueNote, completed_at: new Date().toISOString() }),
        });
      }
    } catch {}
  }

  const doneCount  = Object.values(checked).filter(Boolean).length;
  const totalCount = tasks.length;
  const pct        = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  if (loading) return (
    <div style={styles.fullPage}>
      <div style={{ color: "#fff", fontSize: 16 }}>טוען...</div>
    </div>
  );

  if (error) return (
    <div style={styles.fullPage}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>❌</div>
        <div style={{ fontSize: 16, color: "#374151" }}>{error}</div>
      </div>
    </div>
  );

  // ── DONE screen ────────────────────────────────────────────────────────────
  if (status === "done") return (
    <div style={styles.fullPage}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
          <h2 style={{ color: "#0F6E56", fontSize: 22, margin: "0 0 8px" }}>הניקיון הושלם!</h2>
          <p style={{ color: "#6b7280", fontSize: 14 }}>סוויטת {room?.name} מוכנה לאורחים</p>
          <div style={{ marginTop: 20, padding: "10px 20px", background: "rgba(29,158,117,.1)", borderRadius: 10, fontSize: 13, color: "#0F6E56" }}>
            הלוח עודכן אוטומטית ✓
          </div>
        </div>
      </div>
    </div>
  );

  // ── ISSUE screen ──────────────────────────────────────────────────────────
  if (status === "issue") return (
    <div style={styles.fullPage}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ color: "#854F0B", fontSize: 20, margin: "0 0 8px" }}>הבעיה דווחה</h2>
          <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>המנהל קיבל התראה</p>
          <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>החדר סומן לתחזוקה</p>
        </div>
      </div>
    </div>
  );

  // ── MAIN cleaning screen ──────────────────────────────────────────────────
  return (
    <div style={styles.fullPage}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", marginBottom: 4 }}>Dream Island</div>
        <div style={{ display: "inline-block", background: "rgba(201,162,90,.2)", color: "#C9A25A", fontSize: 12, padding: "3px 12px", borderRadius: 20, marginBottom: 8 }}>
          {room?.type}
        </div>
        <h1 style={{ color: "#fff", fontSize: 24, margin: "0 0 4px", fontWeight: 500 }}>סוויטת {room?.name}</h1>
        <p style={{ color: "rgba(255,255,255,.6)", fontSize: 13, margin: 0 }}>
          {status === "idle" ? "לחץ 'התחל' לפתיחת ניקיון" : `${doneCount} / ${totalCount} משימות`}
        </p>
      </div>

      <div style={styles.body}>
        {/* Progress bar */}
        {status === "cleaning" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>התקדמות</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#1B3A32" }}>{pct}%</span>
            </div>
            <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: pct + "%", background: "#1D9E75", borderRadius: 3, transition: "width .3s" }} />
            </div>
          </div>
        )}

        {/* Task list */}
        {status !== "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {tasks.map(task => (
              <div key={task.id} onClick={() => setChecked(p => ({ ...p, [task.id]: !p[task.id] }))}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "#fff", borderRadius: 10, padding: "12px 14px",
                  border: "0.5px solid " + (checked[task.id] ? "#1D9E75" : "#e5e7eb"),
                  cursor: "pointer",
                }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                  background: checked[task.id] ? "#1D9E75" : "transparent",
                  border: "2px solid " + (checked[task.id] ? "#1D9E75" : "#d1d5db"),
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {checked[task.id] && <span style={{ color: "#fff", fontSize: 13, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontSize: 14, color: checked[task.id] ? "#9ca3af" : "#374151", textDecoration: checked[task.id] ? "line-through" : "none" }}>
                  {task.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Issue form */}
        {showIssue && (
          <div style={{ background: "#fffbeb", border: "0.5px solid #fcd34d", borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: "#92400e" }}>תאר את הבעיה:</div>
            <textarea value={issueNote} onChange={e => setIssueNote(e.target.value)}
              placeholder="לדוגמה: ברז שבור, מזגן לא עובד..."
              style={{ width: "100%", fontSize: 13, padding: 10, borderRadius: 8, border: "0.5px solid #d1d5db", resize: "none", height: 70 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={reportIssue} style={styles.btnWarning}>שלח דיווח</button>
              <button onClick={() => setShowIssue(false)} style={styles.btnGhost}>ביטול</button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {status === "idle" && (
          <button onClick={startCleaning} style={styles.btnPrimary}>🧹 התחל ניקיון</button>
        )}
        {status === "cleaning" && (
          <>
            <button onClick={finishCleaning} style={{ ...styles.btnPrimary, background: "#1D9E75", marginBottom: 10 }}>
              ✅ סיימתי — החדר מוכן
            </button>
            {!showIssue && (
              <button onClick={() => setShowIssue(true)} style={styles.btnGhost}>⚠️ דווח על בעיה</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  fullPage: {
    minHeight: "100vh", background: "#1B3A32",
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "flex-start", padding: "0 0 2rem",
  },
  header: {
    width: "100%", maxWidth: 420, textAlign: "center",
    padding: "2rem 1.5rem 1.5rem", direction: "rtl",
  },
  card: {
    width: "100%", maxWidth: 380, background: "#fff",
    borderRadius: 20, margin: "auto", overflow: "hidden",
  },
  body: {
    width: "100%", maxWidth: 420, background: "#f9fafb",
    borderRadius: "20px 20px 0 0", flex: 1, padding: "1.25rem",
    direction: "rtl",
  },
  btnPrimary: {
    width: "100%", padding: 14, borderRadius: 12,
    border: "none", background: "#1B3A32", color: "#fff",
    fontSize: 15, fontWeight: 500, cursor: "pointer",
  },
  btnWarning: {
    flex: 1, padding: "8px 14px", borderRadius: 8,
    border: "none", background: "#92400e", color: "#fff",
    fontSize: 13, cursor: "pointer",
  },
  btnGhost: {
    flex: 1, padding: "8px 14px", borderRadius: 8,
    border: "0.5px solid #e5e7eb", background: "transparent",
    fontSize: 13, cursor: "pointer", color: "#6b7280",
  },
};
