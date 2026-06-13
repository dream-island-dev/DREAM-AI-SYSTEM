import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

const STATUS_LABELS = {
  free:        "פנוי",
  occupied:    "תפוס",
  dirty:       "לניקיון",
  cleaning:    "בניקיון",
  maintenance: "תחזוקה",
};
const STATUS_CYCLE = ["free", "occupied", "dirty", "cleaning", "maintenance"];
const STATUS_COLOR = {
  free:        "#1D9E75",
  occupied:    "#E24B4A",
  dirty:       "#EF9F27",
  cleaning:    "#378ADD",
  maintenance: "#888780",
};
const STATUS_BG = {
  free:        "rgba(29,158,117,.1)",
  occupied:    "rgba(226,75,74,.1)",
  dirty:       "rgba(239,159,39,.1)",
  cleaning:    "rgba(55,138,221,.1)",
  maintenance: "rgba(136,135,128,.1)",
};
const STATUS_TEXT = {
  free:        "#0F6E56",
  occupied:    "#A32D2D",
  dirty:       "#854F0B",
  cleaning:    "#185FA5",
  maintenance: "#5F5E5A",
};

const ROOM_TYPES = ["סוויטה בוטיק", "סוויטת VIP", "סוויטת פרמיום", "חדר זוגי", "אחר"];

const DEMO_ROOMS = [
  { id: "1", name: "אמטיסט",   type: "סוויטת VIP",    sort_order: 1, status: "occupied",    current_guest: "משפחת לוי",    checkout_date: "2026-06-14", is_active: true },
  { id: "2", name: "ג'ספר",    type: "סוויטת VIP",    sort_order: 2, status: "free",         current_guest: null,           checkout_date: null,         is_active: true },
  { id: "3", name: "אוניקס",   type: "סוויטת VIP",    sort_order: 3, status: "dirty",        current_guest: null,           checkout_date: null,         is_active: true },
  { id: "4", name: "אקוומרין", type: "סוויטה בוטיק",  sort_order: 4, status: "occupied",    current_guest: "דוד וענת כהן", checkout_date: "2026-06-13", is_active: true },
  { id: "5", name: "אמרלד",    type: "סוויטת פרמיום", sort_order: 5, status: "cleaning",     current_guest: null,           checkout_date: null,         is_active: true },
  { id: "6", name: "רובי",     type: "סוויטת VIP",    sort_order: 6, status: "free",         current_guest: null,           checkout_date: null,         is_active: true },
];

const supabaseReady = SUPABASE_URL && SUPABASE_KEY;

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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export default function RoomStatusBoard() {
  const [rooms, setRooms]           = useState([]);
  const [filter, setFilter]         = useState("all");
  const [tab, setTab]               = useState("board");
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(null);
  const [showForm, setShowForm]     = useState(false);
  const [editRoom, setEditRoom]     = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const [form, setForm] = useState({ name: "", type: ROOM_TYPES[0] });

  const loadRooms = useCallback(async () => {
    if (!supabaseReady) { setRooms(DEMO_ROOMS); setLoading(false); return; }
    try {
      const data = await sbFetch("rooms?is_active=eq.true&order=sort_order.asc");
      setRooms(data);
      setLastUpdate(new Date());
    } catch {
      setRooms(DEMO_ROOMS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // רענון אוטומטי כל 60 שניות
  useEffect(() => {
    const t = setInterval(loadRooms, 60000);
    return () => clearInterval(t);
  }, [loadRooms]);

  async function updateStatus(room, newStatus) {
    setSaving(room.id);
    if (!supabaseReady) {
      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, status: newStatus } : r));
      setSaving(null);
      return;
    }
    try {
      await sbFetch(`rooms?id=eq.${room.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, status: newStatus } : r));
    } catch (e) {
      alert("שגיאה בעדכון: " + e.message);
    } finally {
      setSaving(null);
    }
  }

  function cycleStatus(room) {
    const i = STATUS_CYCLE.indexOf(room.status);
    updateStatus(room, STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length]);
  }

  async function saveRoom() {
    if (!form.name.trim()) return;
    const maxOrder = rooms.reduce((m, r) => Math.max(m, r.sort_order), 0);
    const payload = { name: form.name.trim(), type: form.type, sort_order: maxOrder + 1, status: "free", is_active: true };

    if (!supabaseReady) {
      const newRoom = { ...payload, id: String(Date.now()), current_guest: null, checkout_date: null };
      setRooms(prev => [...prev, newRoom]);
      setForm({ name: "", type: ROOM_TYPES[0] });
      setShowForm(false);
      return;
    }
    try {
      const [created] = await sbFetch("rooms", { method: "POST", body: JSON.stringify(payload) });
      setRooms(prev => [...prev, created]);
      setForm({ name: "", type: ROOM_TYPES[0] });
      setShowForm(false);
    } catch (e) { alert("שגיאה: " + e.message); }
  }

  async function saveEdit() {
    if (!editRoom || !editRoom.name.trim()) return;
    const patch = {
      name:          editRoom.name,
      type:          editRoom.type,
      current_guest: editRoom.current_guest  || null,
      checkout_date: editRoom.checkout_date  || null,
    };
    if (!supabaseReady) {
      setRooms(prev => prev.map(r => r.id === editRoom.id ? { ...r, ...patch } : r));
      setEditRoom(null);
      return;
    }
    try {
      await sbFetch(`rooms?id=eq.${editRoom.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setRooms(prev => prev.map(r => r.id === editRoom.id ? { ...r, ...patch } : r));
      setEditRoom(null);
    } catch (e) { alert("שגיאה: " + e.message); }
  }

  async function deleteRoom(room) {
    if (!window.confirm(`למחוק את הסוויטה "${room.name}"?`)) return;
    if (!supabaseReady) { setRooms(prev => prev.filter(r => r.id !== room.id)); return; }
    try {
      await sbFetch(`rooms?id=eq.${room.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false }),
      });
      setRooms(prev => prev.filter(r => r.id !== room.id));
    } catch (e) { alert("שגיאה: " + e.message); }
  }

  const counts = STATUS_CYCLE.reduce((acc, s) => {
    acc[s] = rooms.filter(r => r.status === s).length;
    return acc;
  }, {});

  const visible = filter === "all" ? rooms : rooms.filter(r => r.status === filter);

  const formatDate = (d) => {
    if (!d) return "";
    const parts = d.split("-");
    return `${parts[2]}/${parts[1]}`;
  };

  const timeStr = lastUpdate
    ? lastUpdate.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div style={{ direction: "rtl", padding: "0 0 2rem" }}>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: 20 }}>
        {[["board", "לוח סטטוס"], ["manage", "ניהול סוויטות"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "10px 20px", border: "none", background: "transparent", cursor: "pointer",
            fontSize: 14, fontWeight: tab === id ? 500 : 400,
            color: tab === id ? "#1B3A32" : "#6b7280",
            borderBottom: tab === id ? "2px solid #C9A25A" : "2px solid transparent",
            marginBottom: -1,
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        {lastUpdate && (
          <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center", padding: "0 12px" }}>
            עדכון אחרון: {timeStr}
          </span>
        )}
        <button onClick={loadRooms} style={{
          fontSize: 12, padding: "6px 14px", border: "0.5px solid #d1d5db",
          borderRadius: 8, background: "transparent", cursor: "pointer", alignSelf: "center", marginLeft: 4,
        }}>↺ רענן</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>טוען...</div>
      ) : tab === "board" ? (
        <>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginBottom: 16 }}>
            {[
              ["פנויים",   "free",        "#0F6E56"],
              ["תפוסים",   "occupied",    "#A32D2D"],
              ["לניקיון",  "dirty",       "#854F0B"],
              ["בניקיון",  "cleaning",    "#185FA5"],
              ["תחזוקה",   "maintenance", "#5F5E5A"],
            ].map(([lbl, key, color]) => (
              <div key={key} style={{ background: "#f9fafb", borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 500, color, lineHeight: 1 }}>{counts[key]}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{lbl}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {[["all", "הכל"], ...STATUS_CYCLE.map(s => [s, STATUS_LABELS[s]])].map(([key, lbl]) => (
              <button key={key} onClick={() => setFilter(key)} style={{
                fontSize: 12, padding: "4px 12px", borderRadius: 20,
                border: "0.5px solid",
                borderColor: filter === key ? "#1B3A32" : "#d1d5db",
                background: filter === key ? "#1B3A32" : "transparent",
                color: filter === key ? "#fff" : "#6b7280",
                cursor: "pointer",
              }}>
                {key !== "all" && (
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[key], marginLeft: 5, verticalAlign: 1 }} />
                )}
                {lbl}
              </button>
            ))}
          </div>

          {/* Cards */}
          {visible.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9ca3af" }}>אין סוויטות בסטטוס זה</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))", gap: 10 }}>
              {visible.map(room => (
                <div key={room.id} onClick={() => cycleStatus(room)} style={{
                  background: "#fff", borderRadius: 12,
                  border: `1.5px solid ${STATUS_COLOR[room.status]}40`,
                  padding: 12, cursor: saving === room.id ? "wait" : "pointer",
                  position: "relative", overflow: "hidden",
                  opacity: saving === room.id ? 0.6 : 1,
                  transition: "transform .1s",
                }}>
                  {/* top stripe */}
                  <div style={{ position: "absolute", top: 0, right: 0, left: 0, height: 3, background: STATUS_COLOR[room.status] }} />
                  <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 2, marginTop: 4 }}>{room.name}</div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{room.type}</div>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
                    background: STATUS_BG[room.status], color: STATUS_TEXT[room.status],
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[room.status] }} />
                    {STATUS_LABELS[room.status]}
                  </div>
                  {room.current_guest && (
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>👤 {room.current_guest}</div>
                  )}
                  {room.checkout_date && (
                    <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>יציאה {formatDate(room.checkout_date)}</div>
                  )}
                  {/* Quick buttons */}
                  <div style={{ display: "flex", gap: 3, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                    {["free","dirty","maintenance"].map(s => (
                      <button key={s} onClick={() => updateStatus(room, s)} style={{
                        flex: 1, fontSize: 10, padding: "3px 2px", borderRadius: 5,
                        border: "0.5px solid #e5e7eb", background: room.status === s ? STATUS_BG[s] : "transparent",
                        color: room.status === s ? STATUS_TEXT[s] : "#6b7280", cursor: "pointer",
                      }}>
                        {s === "free" ? "פנוי" : s === "dirty" ? "ניקיון" : "תחזוקה"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!supabaseReady && (
            <div style={{ marginTop: 16, padding: "8px 12px", background: "#fef3c7", borderRadius: 8, fontSize: 12, color: "#92400e" }}>
              מצב הדגמה — חבר Supabase לשמירת שינויים
            </div>
          )}
        </>
      ) : (
        /* ── Management tab ── */
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {rooms.length} סוויטות מוגדרות · לחץ ✏️ לעריכה
            </span>
            <button onClick={() => { setShowForm(!showForm); setEditRoom(null); }} style={{
              fontSize: 13, padding: "7px 16px", borderRadius: 8,
              border: "none", background: "#1B3A32", color: "#fff", cursor: "pointer",
            }}>+ הוסף סוויטה</button>
          </div>

          {/* Add form */}
          {showForm && (
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: 14, marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="שם הסוויטה (למשל: ספיר)" style={{
                  flex: 1, minWidth: 140, fontSize: 13, padding: "7px 10px",
                  border: "0.5px solid #d1d5db", borderRadius: 8, background: "#fff",
                }} />
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} style={{
                flex: 1, minWidth: 140, fontSize: 13, padding: "7px 10px",
                border: "0.5px solid #d1d5db", borderRadius: 8, background: "#fff",
              }}>
                {ROOM_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <button onClick={saveRoom} style={{
                fontSize: 13, padding: "7px 18px", borderRadius: 8,
                border: "none", background: "#1B3A32", color: "#fff", cursor: "pointer", whiteSpace: "nowrap",
              }}>שמור</button>
            </div>
          )}

          {/* Edit form */}
          {editRoom && (
            <div style={{ background: "#fffbeb", border: "0.5px solid #fcd34d", borderRadius: 10, padding: 14, marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <input value={editRoom.name} onChange={e => setEditRoom(p => ({ ...p, name: e.target.value }))}
                placeholder="שם הסוויטה"
                style={{ flex: 1, minWidth: 140, fontSize: 13, padding: "7px 10px", border: "0.5px solid #d1d5db", borderRadius: 8, background: "#fff" }} />
              <select value={editRoom.type} onChange={e => setEditRoom(p => ({ ...p, type: e.target.value }))} style={{
                flex: 1, minWidth: 140, fontSize: 13, padding: "7px 10px", border: "0.5px solid #d1d5db", borderRadius: 8, background: "#fff",
              }}>
                {ROOM_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
              <input value={editRoom.current_guest ?? ""} onChange={e => setEditRoom(p => ({ ...p, current_guest: e.target.value || null }))}
                placeholder="אורח נוכחי (ריק = פנוי)"
                style={{ flex: 1, minWidth: 160, fontSize: 13, padding: "7px 10px", border: "0.5px solid #d1d5db", borderRadius: 8, background: "#fff" }} />
              <input type="date" value={editRoom.checkout_date ?? ""} onChange={e => setEditRoom(p => ({ ...p, checkout_date: e.target.value || null }))}
                title="תאריך יציאה"
                style={{ fontSize: 13, padding: "7px 10px", border: "0.5px solid #d1d5db", borderRadius: 8, background: "#fff" }} />
              <button onClick={saveEdit} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 8, border: "none", background: "#1B3A32", color: "#fff", cursor: "pointer" }}>שמור</button>
              <button onClick={() => setEditRoom(null)} style={{ fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "0.5px solid #d1d5db", background: "transparent", cursor: "pointer" }}>ביטול</button>
            </div>
          )}

          {/* Room list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rooms.map(room => (
              <div key={room.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "10px 14px",
              }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[room.status], flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{room.name}</span>
                <span style={{ fontSize: 12, color: "#6b7280", flex: 1 }}>{room.type}</span>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 20,
                  background: STATUS_BG[room.status], color: STATUS_TEXT[room.status],
                }}>{STATUS_LABELS[room.status]}</span>
                <button onClick={() => { setEditRoom({ ...room }); setShowForm(false); }} style={{
                  fontSize: 12, padding: "4px 10px", borderRadius: 6,
                  border: "0.5px solid #e5e7eb", background: "transparent", cursor: "pointer",
                }}>✏️</button>
                <button onClick={() => deleteRoom(room)} style={{
                  fontSize: 12, padding: "4px 10px", borderRadius: 6,
                  border: "0.5px solid rgba(226,75,74,.3)", background: "transparent",
                  color: "#A32D2D", cursor: "pointer",
                }}>🗑️</button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
            שינויים נשמרים ב-Supabase · נראים לכל הצוות בזמן אמת
          </div>
        </>
      )}
    </div>
  );
}
