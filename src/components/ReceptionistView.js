// src/components/ReceptionistView.js
// Session 30 Sprint 5.4 — streamlined full-screen toolset for user.role===
// "receptionist", mirroring how user.role==="cleaner" gets HousekeepingTabletView
// instead of the full Sidebar (App.js). Exactly two tools, per the sprint's
// explicit scope — no admin/config panels, no full OperationsBoard/WhatsAppInbox:
//   1. 📨 שלח הודעה לאורח — guest search + free-text WhatsApp send (same
//      inbox_reply contract WhatsAppInbox.js's manual reply already uses).
//   2. 🛎️ פתח קריאת שירות — the exact same NewTaskForm component
//      OperationsBoard.js's managers use (exported from there, not forked —
//      CLAUDE.md §0.4 Universal Architecture), so a receptionist-opened
//      ticket gets identical DB writes + Whapi group notification.
import { useState, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { NewTaskForm } from "./OperationsBoard";

function GuestMessagePanel() {
  const [guestSearch,  setGuestSearch]  = useState("");
  const [guestResults, setGuestResults] = useState([]);
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [message,      setMessage]      = useState("");
  const [sending,      setSending]      = useState(false);
  const [toast,        setToast]        = useState(null);

  useEffect(() => {
    if (!guestSearch.trim() || !isSupabaseConfigured || !supabase) { setGuestResults([]); return; }
    const q = guestSearch.trim();
    supabase
      .from("guests")
      .select("id, name, phone, room, status")
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8)
      .then(({ data }) => setGuestResults(data ?? []));
  }, [guestSearch]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 5000);
  }

  async function handleSend() {
    if (!selectedGuest)       return showToast("err", "נא לבחור אורח");
    if (!selectedGuest.phone) return showToast("err", "לאורח זה אין מספר טלפון");
    if (!message.trim())      return showToast("err", "נא לכתוב הודעה");

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "inbox_reply", phone: selectedGuest.phone, message: message.trim() },
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error ?? "שגיאה בשליחה");

      await supabase.from("whatsapp_conversations").insert({
        phone: selectedGuest.phone, direction: "outbound", message: message.trim(), wa_message_id: null,
      });
      showToast("ok", `✅ ההודעה נשלחה ל${selectedGuest.name}`);
      setMessage("");
    } catch (e) {
      showToast("err", e.message ?? "שגיאה בשליחה");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header"><div className="card-title">📨 שלח הודעה לאורח</div></div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {toast && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, fontWeight: 700, fontSize: 13,
            background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
            color:      toast.type === "ok" ? "#1A7A4A"  : "#C0392B",
            border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
          }}>{toast.msg}</div>
        )}

        {selectedGuest ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px",
          }}>
            <div>
              <div style={{ fontWeight: 700 }}>{selectedGuest.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", direction: "ltr" }}>
                {selectedGuest.phone}{selectedGuest.room ? ` · חדר ${selectedGuest.room}` : ""}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedGuest(null); setGuestSearch(""); }}>
              ✕ החלף אורח
            </button>
          </div>
        ) : (
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>חיפוש אורח (שם או טלפון)</label>
            <input
              type="text" value={guestSearch}
              onChange={(e) => setGuestSearch(e.target.value)}
              placeholder="לדוגמה: דניאל / 0501234567"
            />
            {guestResults.length > 0 && (
              <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                {guestResults.map((g) => (
                  <div
                    key={g.id}
                    onClick={() => { setSelectedGuest(g); setGuestResults([]); }}
                    style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--ivory)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ fontWeight: 600 }}>{g.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", direction: "ltr" }}>
                      {g.phone}{g.room ? ` · חדר ${g.room}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="form-field" style={{ marginBottom: 0 }}>
          <label>תוכן ההודעה</label>
          <textarea
            rows={4} value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="כתוב הודעה לאורח..."
            style={{ resize: "vertical", direction: "rtl" }}
          />
        </div>

        <button
          className="btn btn-primary"
          disabled={sending || !selectedGuest || !message.trim()}
          onClick={handleSend}
          style={{ alignSelf: "flex-end", minWidth: 160 }}
        >
          {sending ? "⏳ שולח..." : "📨 שלח הודעה"}
        </button>
      </div>
    </div>
  );
}

export default function ReceptionistView({ user, onLogout }) {
  const [toast, setToast] = useState(null);

  return (
    <div style={{
      direction: "rtl", padding: "20px 24px", fontFamily: "Heebo, sans-serif",
      background: "var(--ivory)", minHeight: "100vh",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--black)" }}>
          🛎️ עמדת קבלה — {user?.name ?? ""}
        </div>
        {onLogout && (
          <button
            onClick={onLogout}
            style={{
              padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
              border: "1.5px solid #E24B4A", background: "#FCEBEB", color: "#A32D2D",
            }}
          >
            יציאה / Exit
          </button>
        )}
      </div>

      <div style={{ maxWidth: 640 }}>
        <GuestMessagePanel />
        <NewTaskForm
          user={user}
          managerDept={user?.department || "קבלה"}
          onCreated={() => {
            setToast({ msg: "✅ קריאת השירות נפתחה ונשלחה לצוות" });
            setTimeout(() => setToast(null), 4000);
          }}
        />
        {toast && (
          <div style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
            background: "#E8F5EF", color: "#1A7A4A", border: "1px solid #1A7A4A",
            boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          }}>{toast.msg}</div>
        )}
      </div>
    </div>
  );
}
