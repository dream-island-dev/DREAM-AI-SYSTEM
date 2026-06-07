// src/components/GuestDashboard.js
// EZGO VIP Guest Pipeline Dashboard — Adir's daily tactical view.
//
// Fetches guests whose arrival_date is today or tomorrow.
// Displays: name, phone (tappable), room, room-type badge, arrival badge,
// and a three-stage EZGO pipeline indicator per guest.
//
// "חדר מוכן" button:
//   Phase 3 (current): console.log payload + update msg_room_ready_sent in DB.
//   Phase 4 (next):    will invoke whatsapp-send Edge Function.
//
// Auth: reads via RLS — manager sees only their own rows (manager_id = auth.uid()).
// Super-admin / General Manager see all rows via their tier policies.

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Date helpers (local time, not UTC) ───────────────────────────────────────
// Using local time ensures the date shown to Adir on his phone matches what
// "today" and "tomorrow" mean to him, regardless of server timezone.
function localISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ArrivalBadge({ date }) {
  const base = {
    display: "inline-flex", alignItems: "center",
    padding: "2px 10px", borderRadius: 20,
    fontSize: 11, fontWeight: 700,
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
  const isSuite = /suite|סוויט|vip|penthouse|presidential/i.test(type ?? "");
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

// ── Main component ─────────────────────────────────────────────────────────────

export default function GuestDashboard({ user }) {
  const [guests,  setGuests]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Fetch arrivals for today + tomorrow ──────────────────────────────────
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

    if (error) {
      showToast("err", "שגיאה בטעינת אורחים: " + error.message);
    } else {
      setGuests(data ?? []);
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  // ── Mark Room Ready ──────────────────────────────────────────────────────
  // Phase 3 stub: logs the payload and updates the DB flag.
  // Phase 4 will replace the console.log with a whatsapp-send invoke.
  const markRoomReady = useCallback(async (guest) => {
    if (guest.msg_room_ready_sent) return;

    // ── Phase 4 hook: replace this log with whatsapp-send invoke ──────────
    console.log("[EZGO] 🏨 Room Ready →", {
      name:      guest.name,
      phone:     guest.phone,
      room_type: guest.room_type,
      room:      guest.room,
      arrival:   guest.arrival_date,
    });

    // Optimistic UI update
    setGuests((prev) =>
      prev.map((g) => g.id === guest.id ? { ...g, msg_room_ready_sent: true } : g)
    );

    // Persist to DB (msg_room_ready_sent = true)
    const { error } = await supabase
      .from("guests")
      .update({ msg_room_ready_sent: true })
      .eq("id", guest.id);

    if (error) {
      showToast("err", "שגיאה בעדכון: " + error.message);
      // Roll back the optimistic update
      setGuests((prev) =>
        prev.map((g) => g.id === guest.id ? { ...g, msg_room_ready_sent: false } : g)
      );
    } else {
      showToast("ok", `✅ חדר מוכן סומן עבור ${guest.name}`);
    }
  }, [showToast]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const todayCount     = guests.filter((g) => g.arrival_date === localISO(0)).length;
  const tomorrowCount  = guests.filter((g) => g.arrival_date === localISO(1)).length;
  const roomReadyCount = guests.filter((g) => g.msg_room_ready_sent).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A"  : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { label: "מגיעים היום",   value: todayCount,     color: "#856404", bg: "#FFF3CD" },
          { label: "מגיעים מחר",   value: tomorrowCount,  color: "#1A56DB", bg: "#E8F0FE" },
          { label: "חדרים מוכנים", value: roomReadyCount, color: "#1A7A4A", bg: "#E8F5EF" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{
            flex: "1 1 100px", padding: "14px 18px", borderRadius: 12,
            background: bg, textAlign: "center",
          }}>
            <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 12, color, fontWeight: 600, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Header + Refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--black)" }}>
          הגעות {localISO(0)} — {localISO(1)}
        </div>
        <button
          onClick={fetchGuests}
          disabled={loading}
          style={{
            padding: "7px 14px", borderRadius: 8, cursor: loading ? "default" : "pointer",
            border: "1px solid var(--border)", background: "var(--card-bg)",
            fontSize: 13, fontFamily: "Heebo, sans-serif", color: "var(--text-muted)",
          }}
        >
          {loading ? "⏳" : "🔄"} רענן
        </button>
      </div>

      {/* Guest cards */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 56, color: "var(--text-muted)", fontSize: 14 }}>
          ⏳ טוען אורחים...
        </div>
      ) : guests.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          border: "1px dashed var(--border)", borderRadius: 14,
          color: "var(--text-muted)", fontSize: 14, lineHeight: 2,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛎️</div>
          אין הגעות מתוכננות להיום ולמחר.
          <br />
          <span style={{ fontSize: 12 }}>ייבא דוח EZGO דרך "העלאת נתונים" → EZGO הגעות VIP</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {guests.map((guest) => (
            <div
              key={guest.id}
              style={{
                padding: "16px 18px", borderRadius: 14,
                border: "1px solid var(--border)", background: "var(--card-bg)",
                boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
              }}
            >
              {/* Row 1: Name + arrival badge */}
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: 8,
              }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: "var(--black)" }}>
                  {guest.name}
                </div>
                <ArrivalBadge date={guest.arrival_date} />
              </div>

              {/* Row 2: Phone + room + room-type badge */}
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                marginBottom: 10, flexWrap: "wrap",
              }}>
                {guest.phone && (
                  <a
                    href={`tel:${guest.phone}`}
                    style={{ fontSize: 14, color: "#2563EB", fontWeight: 600, textDecoration: "none" }}
                  >
                    📞 {guest.phone}
                  </a>
                )}
                {guest.room && (
                  <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                    חדר {guest.room}
                  </span>
                )}
                <RoomTypeBadge type={guest.room_type} />
              </div>

              {/* Row 3: EZGO pipeline stages */}
              <div style={{ display: "flex", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
                <PipelineStage label="הודעה מקדימה" done={guest.msg_pre_arrival_sent}  />
                <PipelineStage label="חדר מוכן"     done={guest.msg_room_ready_sent}   />
                <PipelineStage label="פולו-אפ"       done={guest.msg_post_checkin_sent} />
              </div>

              {/* Row 4: Room Ready action button */}
              <button
                onClick={() => markRoomReady(guest)}
                disabled={guest.msg_room_ready_sent}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 10,
                  fontFamily: "Heebo, sans-serif", fontSize: 15, fontWeight: 700,
                  cursor: guest.msg_room_ready_sent ? "default" : "pointer",
                  border: "none",
                  background: guest.msg_room_ready_sent
                    ? "#E8F5EF"
                    : "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                  color: guest.msg_room_ready_sent ? "#1A7A4A" : "#fff",
                  transition: "opacity 0.2s",
                }}
              >
                {guest.msg_room_ready_sent ? "✅ החדר מוכן — סומן" : "🏨 סמן חדר מוכן"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
