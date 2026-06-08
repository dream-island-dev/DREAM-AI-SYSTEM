// src/components/GuestDashboard.js  v2
// EZGO Guest Pipeline Dashboard — daily tactical view.
//
// Tabs:   כולם | 🏊 בילוי יומי | 👑 לינה
// CRUD:   הוסף אורח ידנית | מחק אורח
// WA:     כפתור "💬" ליד כל טלפון → שלח הודעה ספציפית לאורח
//         כפתור "🏨 חדר מוכן" → EZGO pipeline (לינה בלבד)
//
// room_type logic:
//   day_guest  = בילוי יומי (ללא מספר חדר — נגזר אוטומטית מהאקסל)
//   standard   = חדר רגיל
//   suite      = סוויטה / VIP
//
// Auth: RLS — tactical manager sees own rows; GM/super_admin see all.

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Date helpers (local time) ─────────────────────────────────────────────────
function localISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

// ── Phone normalizer (mirrors DataUpload sanitizePhone) ───────────────────────
function fmtPhone(raw) {
  if (!raw) return null;
  const c = String(raw).replace(/[^\d+]/g, "");
  if (!c) return null;
  if (c.startsWith("+"))            return c.length >= 10 ? c : null;
  if (/^5\d{8}$/.test(c))          return `+972${c}`;
  if (/^05\d{8}$/.test(c))         return `+972${c.slice(1)}`;
  if (c.startsWith("972") && c.length >= 11) return `+${c}`;
  return c.length >= 9 ? c : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ArrivalBadge({ date }) {
  const base = {
    display: "inline-flex", alignItems: "center",
    padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
  };
  if (date === localISO(0))
    return <span style={{ ...base, background: "#FFF3CD", color: "#856404" }}>היום ⚡</span>;
  if (date === localISO(1))
    return <span style={{ ...base, background: "#E8F0FE", color: "#1A56DB" }}>מחר</span>;
  return <span style={{ ...base, background: "var(--ivory)", color: "var(--text-muted)" }}>{date}</span>;
}

function PipelineStage({ label, done }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 600,
      color: done ? "#1A7A4A" : "var(--text-muted)",
    }}>
      {done ? "✅" : "○"} {label}
    </span>
  );
}

function RoomTypeBadge({ type }) {
  if (type === "day_guest") return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      background: "rgba(37,99,235,0.08)", color: "#1D4ED8", border: "1px solid #BFDBFE",
    }}>🏊 בילוי יומי</span>
  );
  const isSuite = /suite|סוויט|vip|penthouse/i.test(type ?? "");
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      background: isSuite ? "rgba(201,169,110,0.15)" : "var(--ivory)",
      color:      isSuite ? "var(--gold-dark)"        : "var(--text-muted)",
      border:     `1px solid ${isSuite ? "var(--gold)" : "var(--border)"}`,
    }}>
      {isSuite ? "👑 " : ""}{type || "standard"}
    </span>
  );
}

// ── WA compose modal ──────────────────────────────────────────────────────────
function WAModal({ guest, onClose, onSend, isSending }) {
  const [msg, setMsg] = useState(
    `שלום ${guest.name}! 👋\nכאן Dream Island — `
  );
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998,
      background: "rgba(0,0,0,0.45)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "var(--card-bg)", borderRadius: 16, padding: 24,
        width: "100%", maxWidth: 420, boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
        direction: "rtl",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
          💬 הודעה ל{guest.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
          {guest.phone}
        </div>
        <textarea
          autoFocus
          rows={5}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          style={{
            width: "100%", borderRadius: 10, border: "1px solid var(--border)",
            padding: "10px 12px", fontSize: 14, fontFamily: "Heebo, sans-serif",
            direction: "rtl", resize: "vertical", boxSizing: "border-box",
            background: "var(--ivory)",
          }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo, sans-serif",
              fontSize: 14, color: "var(--text-muted)",
            }}
          >ביטול</button>
          <button
            onClick={() => onSend(msg)}
            disabled={isSending || !msg.trim()}
            style={{
              padding: "10px 24px", borderRadius: 8, border: "none",
              background: isSending ? "#ccc" : "linear-gradient(135deg, var(--gold), var(--gold-dark))",
              color: "#fff", fontFamily: "Heebo, sans-serif", fontWeight: 700,
              fontSize: 14, cursor: isSending ? "default" : "pointer",
            }}
          >
            {isSending ? "⏳ שולח..." : "📤 שלח"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Guest inline form ─────────────────────────────────────────────────────
function AddGuestForm({ onSave, onCancel, busy }) {
  const [form, setForm] = useState({
    name: "", phone: "", room: "", room_type: "day_guest",
    arrival_date: localISO(0),
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Auto-switch type when room is entered/cleared
  const handleRoom = (v) => {
    setForm((f) => ({
      ...f, room: v,
      room_type: v ? (f.room_type === "day_guest" ? "standard" : f.room_type) : "day_guest",
    }));
  };

  return (
    <div className="card" style={{ marginBottom: 20, borderColor: "var(--gold)" }}>
      <div className="card-header">
        <div className="card-title">➕ הוסף אורח ידנית</div>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>ביטול ✕</button>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>שם מלא *</label>
            <input
              type="text" value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="ישראל ישראלי"
            />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>טלפון</label>
            <input
              type="tel" value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="05X-XXXXXXX"
              style={{ direction: "ltr" }}
            />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>מספר חדר (ריק = בילוי יומי)</label>
            <input
              type="text" value={form.room}
              onChange={(e) => handleRoom(e.target.value)}
              placeholder="ללא → בילוי יומי"
            />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>סוג</label>
            <select
              value={form.room_type}
              onChange={(e) => set("room_type", e.target.value)}
              disabled={!form.room}
            >
              <option value="day_guest">🏊 בילוי יומי</option>
              <option value="standard">🏨 חדר רגיל</option>
              <option value="suite">👑 סוויטה</option>
            </select>
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>תאריך הגעה</label>
            <input
              type="date" value={form.arrival_date}
              onChange={(e) => set("arrival_date", e.target.value)}
            />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn btn-primary"
            disabled={busy || !form.name.trim()}
            onClick={() => onSave(form)}
            style={{ minWidth: 160 }}
          >
            {busy ? "⏳ שומר..." : "✅ שמור אורח"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GuestDashboard({ user }) {
  const [guests,      setGuests]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);
  const [loadingId,   setLoadingId]   = useState(null);  // room_ready pipeline
  const [sendingWAId, setSendingWAId] = useState(null);  // individual WA
  const [deletingId,  setDeletingId]  = useState(null);  // delete
  const [addBusy,     setAddBusy]     = useState(false);

  const [activeTab,   setActiveTab]   = useState("all"); // all | day_guest | suite
  const [showAdd,     setShowAdd]     = useState(false);
  const [waModal,     setWaModal]     = useState(null);  // guest object or null
  const [selected,    setSelected]    = useState(new Set()); // checked guest IDs

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchGuests = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("guests")
      .select(
        "id, name, phone, room, room_type, arrival_date, status, " +
        "msg_pre_arrival_sent, msg_room_ready_sent, msg_post_checkin_sent"
      )
      .in("arrival_date", [localISO(0), localISO(1)])
      .order("arrival_date", { ascending: true })
      .order("name",         { ascending: true });
    if (error) showToast("err", "שגיאה בטעינת אורחים: " + error.message);
    else setGuests(data ?? []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);
  // Clear selection when tab or data changes
  useEffect(() => { setSelected(new Set()); }, [activeTab]);

  // ── Mark Room Ready (EZGO pipeline — hotel guests only) ───────────────────
  const markRoomReady = useCallback(async (guest) => {
    if (guest.msg_room_ready_sent || loadingId) return;
    setLoadingId(guest.id);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "room_ready", guestId: guest.id },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "שליחת ההודעה נכשלה");
      setGuests((prev) =>
        prev.map((g) => g.id === guest.id ? { ...g, msg_room_ready_sent: true } : g)
      );
      showToast("ok", `✅ הודעת חדר מוכן נשלחה ל${guest.name}${data.simulation ? " (סימולציה)" : ""}`);
    } catch (err) {
      showToast("err", "שגיאה בשליחה: " + (err?.message ?? String(err)));
    } finally {
      setLoadingId(null);
    }
  }, [loadingId, showToast]);

  // ── Send WA to a specific guest (broadcast trigger) ───────────────────────
  const sendWAToGuest = useCallback(async (guest, message) => {
    if (!message?.trim()) return showToast("err", "נא להזין הודעה");
    setSendingWAId(guest.id);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "broadcast", guestId: guest.id, messageTemplate: message },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "שגיאה בשליחה");
      showToast("ok", `✅ הודעה נשלחה ל${guest.name}${data.simulation ? " (סימולציה)" : ""}`);
      setWaModal(null);
    } catch (err) {
      showToast("err", "שגיאה: " + (err?.message ?? String(err)));
    } finally {
      setSendingWAId(null);
    }
  }, [showToast]);

  // ── Delete guest ──────────────────────────────────────────────────────────
  const deleteGuest = useCallback(async (guest) => {
    if (!window.confirm(`מחק את "${guest.name}"?`)) return;
    setDeletingId(guest.id);
    const { error } = await supabase.from("guests").delete().eq("id", guest.id);
    if (error) showToast("err", "שגיאה במחיקה: " + error.message);
    else {
      setGuests((prev) => prev.filter((g) => g.id !== guest.id));
      showToast("ok", `🗑️ ${guest.name} נמחק`);
    }
    setDeletingId(null);
  }, [showToast]);

  // ── Add guest ─────────────────────────────────────────────────────────────
  const handleAddGuest = useCallback(async (form) => {
    if (!form.name.trim()) return showToast("err", "שם חובה");
    setAddBusy(true);
    const phone = fmtPhone(form.phone);
    const payload = {
      name:         form.name.trim(),
      phone:        phone,
      room:         form.room || null,
      room_type:    form.room ? form.room_type : "day_guest",
      arrival_date: form.arrival_date || localISO(0),
      status:       "expected",
    };
    const { data, error } = await supabase
      .from("guests").insert([payload]).select().single();
    if (error) {
      showToast("err", "שגיאה: " + error.message);
    } else {
      setGuests((prev) => [...prev, data].sort((a, b) => {
        if (a.arrival_date !== b.arrival_date)
          return a.arrival_date < b.arrival_date ? -1 : 1;
        return a.name.localeCompare(b.name, "he");
      }));
      setShowAdd(false);
      showToast("ok", `✅ ${data.name} נוסף בהצלחה`);
    }
    setAddBusy(false);
  }, [showToast]);

  // ── Selection + bulk delete ───────────────────────────────────────────────
  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const deleteSelected = useCallback(async () => {
    if (!selected.size) return;
    if (!window.confirm(`מחק ${selected.size} אורחים? פעולה זו לא ניתנת לביטול.`)) return;
    const ids = [...selected];
    const { error } = await supabase.from("guests").delete().in("id", ids);
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setGuests((prev) => prev.filter((g) => !ids.includes(g.id)));
    setSelected(new Set());
    showToast("ok", `🗑️ נמחקו ${ids.length} אורחים בהצלחה`);
  }, [selected, showToast]);

  // ── Tab filtering ─────────────────────────────────────────────────────────
  const dayGuests   = guests.filter((g) => g.room_type === "day_guest");
  const hotelGuests = guests.filter((g) => g.room_type !== "day_guest");
  const tabGuests   = activeTab === "day_guest" ? dayGuests
                    : activeTab === "suite"     ? hotelGuests
                    :                              guests;

  // ── Stats ─────────────────────────────────────────────────────────────────
  const todayCount     = guests.filter((g) => g.arrival_date === localISO(0)).length;
  const tomorrowCount  = guests.filter((g) => g.arrival_date === localISO(1)).length;
  const roomReadyCount = guests.filter((g) => g.msg_room_ready_sent).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A"  : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* WA compose modal */}
      {waModal && (
        <WAModal
          guest={waModal}
          isSending={sendingWAId === waModal.id}
          onClose={() => setWaModal(null)}
          onSend={(msg) => sendWAToGuest(waModal, msg)}
        />
      )}

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "היום",        value: todayCount,     color: "#856404", bg: "#FFF3CD" },
          { label: "מחר",         value: tomorrowCount,  color: "#1A56DB", bg: "#E8F0FE" },
          { label: "חדרים מוכנים", value: roomReadyCount, color: "#1A7A4A", bg: "#E8F5EF" },
          { label: "🏊 בילוי יומי", value: dayGuests.length,   color: "#1D4ED8", bg: "rgba(37,99,235,0.07)" },
          { label: "👑 לינה",      value: hotelGuests.length,  color: "var(--gold-dark)", bg: "rgba(201,169,110,0.1)" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{
            flex: "1 1 80px", padding: "12px 16px", borderRadius: 12,
            background: bg, textAlign: "center",
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 11, color, fontWeight: 600, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Header row: tabs + add + refresh */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, flex: 1 }}>
          {[
            { key: "all",       label: `כולם (${guests.length})` },
            { key: "day_guest", label: `🏊 יומי (${dayGuests.length})` },
            { key: "suite",     label: `👑 לינה (${hotelGuests.length})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "7px 14px", borderRadius: 20, cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
                border: `2px solid ${activeTab === key ? "var(--gold)" : "var(--border)"}`,
                background: activeTab === key ? "rgba(201,169,110,0.12)" : "var(--card-bg)",
                color: activeTab === key ? "var(--gold-dark)" : "var(--text-muted)",
                transition: "all 0.15s",
              }}
            >{label}</button>
          ))}
        </div>
        {/* Select all checkbox */}
        {tabGuests.length > 0 && (
          <label style={{
            display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            color: "var(--text-muted)", userSelect: "none",
          }}>
            <input
              type="checkbox"
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#C0392B" }}
              checked={tabGuests.length > 0 && selected.size === tabGuests.length}
              onChange={() =>
                setSelected(
                  selected.size === tabGuests.length
                    ? new Set()
                    : new Set(tabGuests.map((g) => g.id))
                )
              }
            />
            בחר הכל
          </label>
        )}

        {/* Bulk delete — appears only when selection is active */}
        {selected.size > 0 && (
          <button
            onClick={deleteSelected}
            style={{
              padding: "7px 16px", borderRadius: 20, cursor: "pointer",
              fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              border: "2px solid #DC2626", background: "#FEF2F2", color: "#DC2626",
              animation: "pulse 1s ease-in-out infinite",
            }}
          >
            🗑️ מחק נבחרים ({selected.size})
          </button>
        )}

        {/* Add + Refresh */}
        <button
          onClick={() => setShowAdd((s) => !s)}
          style={{
            padding: "7px 16px", borderRadius: 20, cursor: "pointer",
            fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
            border: "2px solid var(--gold)",
            background: showAdd ? "rgba(201,169,110,0.15)" : "var(--card-bg)",
            color: "var(--gold-dark)",
          }}
        >
          {showAdd ? "✕ סגור" : "➕ הוסף אורח"}
        </button>
        <button
          onClick={fetchGuests}
          disabled={loading}
          style={{
            padding: "7px 14px", borderRadius: 20, cursor: loading ? "default" : "pointer",
            border: "1px solid var(--border)", background: "var(--card-bg)",
            fontSize: 13, fontFamily: "Heebo, sans-serif", color: "var(--text-muted)",
          }}
        >
          {loading ? "⏳" : "🔄"}
        </button>
      </div>

      {/* Add guest form */}
      {showAdd && (
        <AddGuestForm
          busy={addBusy}
          onSave={handleAddGuest}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Guest list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 56, color: "var(--text-muted)", fontSize: 14 }}>
          ⏳ טוען אורחים...
        </div>
      ) : tabGuests.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          border: "1px dashed var(--border)", borderRadius: 14,
          color: "var(--text-muted)", fontSize: 14, lineHeight: 2,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛎️</div>
          אין הגעות בטאב זה להיום ולמחר.
          <br />
          <span style={{ fontSize: 12 }}>ייבא דוח EZGO דרך "העלאת נתונים" או הוסף אורח ידנית.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tabGuests.map((guest) => {
            const isDayGuest = guest.room_type === "day_guest";
            const isDeleting = deletingId === guest.id;
            const isLoadingPipeline = loadingId === guest.id;
            const isDone = guest.msg_room_ready_sent;

            return (
              <div
                key={guest.id}
                style={{
                  padding: "14px 16px", borderRadius: 14,
                  border: `1px solid ${
                    selected.has(guest.id) ? "#DC2626"
                    : isDayGuest ? "#BFDBFE"
                    : "var(--border)"
                  }`,
                  background: selected.has(guest.id)
                    ? "#FEF2F2"
                    : isDayGuest ? "rgba(37,99,235,0.03)"
                    : "var(--card-bg)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                  opacity: isDeleting ? 0.5 : 1,
                  transition: "border-color 0.15s, background 0.15s, opacity 0.2s",
                }}
              >
                {/* Row 1: Checkbox + Name + arrival badge + delete */}
                <div style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", marginBottom: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(guest.id)}
                      onChange={() => toggleSelect(guest.id)}
                      style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#DC2626" }}
                    />
                    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--black)" }}>
                      {guest.name}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <ArrivalBadge date={guest.arrival_date} />
                    <button
                      onClick={() => deleteGuest(guest)}
                      disabled={isDeleting}
                      title="מחק אורח"
                      style={{
                        width: 28, height: 28, borderRadius: "50%",
                        border: "1px solid #FECACA", background: "#FFF5F5",
                        cursor: "pointer", fontSize: 13, color: "#DC2626",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 0,
                      }}
                    >🗑️</button>
                  </div>
                </div>  {/* end row-1 */}

                {/* Row 2: Phone + WA button + room + type badge */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  marginBottom: isDayGuest ? 0 : 10, flexWrap: "wrap",
                }}>
                  {guest.phone ? (
                    <>
                      <a
                        href={`tel:${guest.phone}`}
                        style={{ fontSize: 14, color: "#2563EB", fontWeight: 600, textDecoration: "none" }}
                      >
                        📞 {guest.phone}
                      </a>
                      {/* Individual WA send button */}
                      <button
                        onClick={() => setWaModal(guest)}
                        disabled={sendingWAId === guest.id}
                        title="שלח הודעת WhatsApp"
                        style={{
                          padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: "1px solid #22C55E", background: "#F0FDF4",
                          color: "#15803D", cursor: "pointer",
                        }}
                      >
                        {sendingWAId === guest.id ? "⏳" : "💬 WA"}
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: "#C0392B" }}>ללא טלפון</span>
                  )}
                  {guest.room && (
                    <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                      חדר {guest.room}
                    </span>
                  )}
                  <RoomTypeBadge type={guest.room_type} />
                </div>

                {/* Hotel guests only: EZGO pipeline + room ready button */}
                {!isDayGuest && (
                  <>
                    <div style={{ display: "flex", gap: 14, marginBottom: 12, marginTop: 10, flexWrap: "wrap" }}>
                      <PipelineStage label="הודעה מקדימה" done={guest.msg_pre_arrival_sent}  />
                      <PipelineStage label="חדר מוכן"     done={guest.msg_room_ready_sent}   />
                      <PipelineStage label="פולו-אפ"       done={guest.msg_post_checkin_sent} />
                    </div>
                    <button
                      onClick={() => markRoomReady(guest)}
                      disabled={isDone || isLoadingPipeline || (!!loadingId && !isLoadingPipeline)}
                      style={{
                        width: "100%", padding: "12px 0", borderRadius: 10,
                        fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 700,
                        border: "none", transition: "opacity 0.2s, background 0.2s",
                        cursor: (isDone || isLoadingPipeline) ? "default" : "pointer",
                        opacity: (!!loadingId && !isLoadingPipeline && !isDone) ? 0.45 : 1,
                        background: isDone
                          ? "#E8F5EF"
                          : isLoadingPipeline
                          ? "#F0F0F0"
                          : "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                        color: isDone ? "#1A7A4A" : isLoadingPipeline ? "var(--text-muted)" : "#fff",
                      }}
                    >
                      {isDone ? "✅ נשלח ✓" : isLoadingPipeline ? "⏳ שולח..." : "🏨 סמן חדר מוכן"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
