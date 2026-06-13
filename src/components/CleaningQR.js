import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const BASE_URL     = window.location.origin;

const STATUS_COLOR = {
  free:        "#1D9E75",
  occupied:    "#E24B4A",
  dirty:       "#EF9F27",
  cleaning:    "#378ADD",
  maintenance: "#888780",
};
const STATUS_LABEL = {
  free:"פנוי", occupied:"תפוס", dirty:"לניקיון", cleaning:"בניקיון", maintenance:"תחזוקה",
};

const DEMO_ROOMS = [
  { id:"1", name:"אמטיסט",   type:"סוויטת VIP",    status:"dirty"   },
  { id:"2", name:"ג'ספר",    type:"סוויטת VIP",    status:"free"    },
  { id:"3", name:"אוניקס",   type:"סוויטת VIP",    status:"cleaning"},
  { id:"4", name:"אקוומרין", type:"סוויטה בוטיק",  status:"dirty"   },
  { id:"5", name:"אמרלד",    type:"סוויטת פרמיום", status:"free"    },
  { id:"6", name:"רובי",     type:"סוויטת VIP",    status:"occupied"},
];
const DEMO_TASKS = {
  "1": [{id:"t1",label:"פינוי מגבות ופריטים",sort_order:1},
        {id:"t2",label:"החלפת מצעים",sort_order:2},
        {id:"t3",label:"ניקוי חדר רחצה",sort_order:3},
        {id:"t4",label:"ריחוף ושאיבה",sort_order:4},
        {id:"t5",label:"מילוי צרכי רחצה",sort_order:5}],
};

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

export default function CleaningQR() {
  const [rooms, setRooms]           = useState([]);
  const [tab, setTab]               = useState("qr");
  const [selectedRoom, setSelected] = useState(null);
  const [tasks, setTasks]           = useState([]);
  const [newTask, setNewTask]       = useState("");
  const [sessions, setSessions]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const supabaseReady = !!(SUPABASE_URL && SUPABASE_KEY);

  const loadRooms = useCallback(async () => {
    if (!supabaseReady) { setRooms(DEMO_ROOMS); setLoading(false); return; }
    try {
      const data = await sbFetch("rooms?is_active=eq.true&order=sort_order.asc&select=id,name,type,status");
      setRooms(data);
    } catch { setRooms(DEMO_ROOMS); }
    finally { setLoading(false); }
  }, [supabaseReady]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  async function loadTasks(roomId) {
    if (!supabaseReady) {
      setTasks(DEMO_TASKS[roomId] || DEMO_TASKS["1"]);
      return;
    }
    try {
      const data = await sbFetch(`cleaning_tasks?room_id=eq.${roomId}&is_active=eq.true&order=sort_order.asc`);
      setTasks(data);
    } catch { setTasks([]); }
  }

  async function loadSessions() {
    if (!supabaseReady) {
      setSessions([
        { id:"s1", room_id:"1", status:"done", started_at: new Date(Date.now()-3600000).toISOString(), completed_at: new Date(Date.now()-1800000).toISOString(), issue_note: null },
        { id:"s2", room_id:"3", status:"in_progress", started_at: new Date(Date.now()-600000).toISOString(), completed_at: null, issue_note: null },
      ]);
      return;
    }
    try {
      const data = await sbFetch("cleaning_sessions?order=started_at.desc&limit=50&select=*,rooms(name)");
      setSessions(data);
    } catch { setSessions([]); }
  }

  function selectRoom(room) {
    setSelected(room);
    loadTasks(room.id);
    setTab("tasks");
  }

  async function addTask() {
    if (!newTask.trim()) return;
    const maxOrder = tasks.reduce((m, t) => Math.max(m, t.sort_order), 0);
    const payload = { room_id: selectedRoom.id, label: newTask.trim(), sort_order: maxOrder + 1, is_active: true };
    if (!supabaseReady) {
      setTasks(prev => [...prev, { ...payload, id: "demo-" + Date.now() }]);
      setNewTask("");
      return;
    }
    setSaving(true);
    try {
      const [created] = await sbFetch("cleaning_tasks", { method: "POST", body: JSON.stringify(payload) });
      setTasks(prev => [...prev, created]);
      setNewTask("");
    } catch (e) { alert("שגיאה: " + e.message); }
    finally { setSaving(false); }
  }

  async function deleteTask(taskId) {
    if (!supabaseReady) { setTasks(prev => prev.filter(t => t.id !== taskId)); return; }
    try {
      await sbFetch(`cleaning_tasks?id=eq.${taskId}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (e) { alert("שגיאה: " + e.message); }
  }

  function printQR(room) {
    const url = `${BASE_URL}/clean/${room.id}`;
    const win = window.open("", "_blank");
    win.document.write(`
      <html dir="rtl"><head><title>QR — ${room.name}</title>
      <style>body{font-family:sans-serif;text-align:center;padding:40px;}h1{color:#1B3A32;}p{color:#6b7280;font-size:14px;}</style>
      </head><body>
      <h1>סוויטת ${room.name}</h1>
      <p>${room.type}</p>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}" width="250" height="250" />
      <p style="font-size:12px;margin-top:16px;">${url}</p>
      <p style="color:#9ca3af;font-size:11px;">סרוק לדיווח ניקיון</p>
      <script>window.print();</script>
      </body></html>`);
    win.document.close();
  }

  function printAll() {
    rooms.forEach(r => printQR(r));
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>טוען...</div>;

  return (
    <div style={{ direction: "rtl", padding: "0 0 2rem" }}>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: 20 }}>
        {[["qr","📱 ניהול QR"],["tasks","📋 משימות לחדר"],["log","📊 לוג ניקיונות"]].map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); if (id === "log") loadSessions(); }} style={{
            padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer",
            fontSize: 13, fontWeight: tab === id ? 500 : 400,
            color: tab === id ? "#1B3A32" : "#6b7280",
            borderBottom: tab === id ? "2px solid #C9A25A" : "2px solid transparent",
            marginBottom: -1,
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={printAll} style={{
          fontSize: 12, padding: "6px 14px", borderRadius: 8, alignSelf: "center",
          border: "0.5px solid #1B3A32", background: "#1B3A32", color: "#fff", cursor: "pointer",
        }}>🖨️ הדפס הכל</button>
      </div>

      {/* ── QR TAB ── */}
      {tab === "qr" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 14 }}>
          {rooms.map(room => {
            const url = `${BASE_URL}/clean/${room.id}`;
            return (
              <div key={room.id} style={{
                background: "#fff", borderRadius: 12, border: "0.5px solid #e5e7eb",
                padding: 16, textAlign: "center",
              }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, padding: 8, background: "#f9fafb", borderRadius: 8 }}>
                  <QRCodeSVG value={url} size={110} bgColor="#f9fafb" fgColor="#1B3A32" />
                </div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 2 }}>{room.name}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{room.type}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 12 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[room.status] }} />
                  <span style={{ fontSize: 11, color: STATUS_COLOR[room.status] }}>{STATUS_LABEL[room.status]}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => selectRoom(room)} style={{
                    flex: 1, fontSize: 11, padding: "5px 0", borderRadius: 6,
                    border: "0.5px solid #e5e7eb", background: "transparent", cursor: "pointer", color: "#374151",
                  }}>📋 משימות</button>
                  <button onClick={() => printQR(room)} style={{
                    flex: 1, fontSize: 11, padding: "5px 0", borderRadius: 6,
                    border: "0.5px solid #1B3A32", background: "#1B3A32", color: "#fff", cursor: "pointer",
                  }}>🖨️ הדפס</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TASKS TAB ── */}
      {tab === "tasks" && (
        <div style={{ maxWidth: 520 }}>
          {!selectedRoom ? (
            <>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>בחר סוויטה לעריכת רשימת משימות:</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rooms.map(room => (
                  <div key={room.id} onClick={() => selectRoom(room)} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8,
                    padding: "12px 14px", cursor: "pointer",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[room.status], flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{room.name}</span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{room.type}</span>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>›</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <button onClick={() => setSelected(null)} style={{
                  fontSize: 12, padding: "5px 10px", borderRadius: 6,
                  border: "0.5px solid #e5e7eb", background: "transparent", cursor: "pointer",
                }}>← חזור</button>
                <span style={{ fontSize: 15, fontWeight: 500 }}>משימות — {selectedRoom.name}</span>
              </div>

              {/* Add task */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input value={newTask} onChange={e => setNewTask(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addTask()}
                  placeholder="הוסף משימה חדשה..."
                  style={{ flex: 1, fontSize: 13, padding: "8px 12px", border: "0.5px solid #d1d5db", borderRadius: 8 }} />
                <button onClick={addTask} disabled={saving} style={{
                  fontSize: 13, padding: "8px 16px", borderRadius: 8,
                  border: "none", background: "#1B3A32", color: "#fff", cursor: "pointer",
                }}>+ הוסף</button>
              </div>

              {/* Task list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tasks.length === 0 && (
                  <div style={{ textAlign: "center", padding: 24, color: "#9ca3af", fontSize: 13 }}>אין משימות — הוסף למעלה</div>
                )}
                {tasks.map((task, i) => (
                  <div key={task.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "10px 14px",
                  }}>
                    <span style={{ fontSize: 12, color: "#9ca3af", width: 20, textAlign: "center" }}>{i + 1}</span>
                    <span style={{ fontSize: 14, flex: 1, color: "#374151" }}>{task.label}</span>
                    <button onClick={() => deleteTask(task.id)} style={{
                      fontSize: 12, padding: "3px 8px", borderRadius: 6,
                      border: "0.5px solid rgba(226,75,74,.3)", background: "transparent",
                      color: "#A32D2D", cursor: "pointer",
                    }}>✕</button>
                  </div>
                ))}
              </div>

              {tasks.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
                  {tasks.length} משימות · גרור לסידור מחדש (בקרוב)
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── LOG TAB ── */}
      {tab === "log" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
            {[
              ["ניקיונות היום", sessions.filter(s => s.started_at?.startsWith(new Date().toISOString().slice(0,10))).length, "#1B3A32"],
              ["הושלמו",        sessions.filter(s => s.status === "done").length,        "#0F6E56"],
              ["בעיות שדווחו",  sessions.filter(s => s.status === "issue").length,       "#A32D2D"],
            ].map(([lbl, val, color]) => (
              <div key={lbl} style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 500, color, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{lbl}</div>
              </div>
            ))}
          </div>

          {sessions.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>אין רשומות עדיין</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sessions.map(s => {
                const room = rooms.find(r => r.id === s.room_id);
                const roomName = room?.name || s.rooms?.name || "—";
                const startTime = new Date(s.started_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
                const statusInfo = { done: ["הושלם","#0F6E56"], in_progress: ["בתהליך","#185FA5"], issue: ["בעיה","#A32D2D"] };
                const [sLabel, sColor] = statusInfo[s.status] || ["—","#6b7280"];
                return (
                  <div key={s.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "10px 14px",
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{roomName}</span>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>{startTime}</span>
                    <span style={{
                      fontSize: 11, padding: "2px 8px", borderRadius: 20,
                      background: sColor + "18", color: sColor,
                    }}>{sLabel}</span>
                    {s.issue_note && (
                      <span title={s.issue_note} style={{ fontSize: 11, color: "#854F0B", cursor: "help" }}>⚠️</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!supabaseReady && (
        <div style={{ marginTop: 16, padding: "8px 12px", background: "#fef3c7", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
          מצב הדגמה — חבר Supabase לשמירת נתונים אמיתיים
        </div>
      )}
    </div>
  );
}
