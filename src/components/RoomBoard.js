// src/components/RoomBoard.js
// Dream Island — Room Status Board
// Reads from: room_status table (operational status) + guests table (occupant info)
// Requires: migration 020_room_status.sql

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";

// ── 26 Dream Island suites — static definitions ──────────────────────────────
const SUITES = [
  // Floor 1 — Garden suites
  { id: "101", type: "סוויטת ג'ספר",    desc: "חצר פרטית + ג'קוזי",      floor: 1 },
  { id: "102", type: "סוויטת ג'ספר",    desc: "חצר פרטית + ג'קוזי",      floor: 1 },
  { id: "103", type: "סוויטת אמרלד",    desc: "חצר + ג'קוזי + סאונה",    floor: 1 },
  { id: "104", type: "סוויטת אמרלד",    desc: "חצר + ג'קוזי + סאונה",    floor: 1 },
  { id: "105", type: "סוויטת אקוומרין", desc: "חצר + בריכה פרטית",       floor: 1 },
  { id: "106", type: "סוויטת אקוומרין", desc: "חצר + בריכה פרטית",       floor: 1 },
  { id: "107", type: "סוויטת אקוומרין", desc: "חצר + בריכה פרטית",       floor: 1 },
  { id: "108", type: "סוויטת ג'ספר",    desc: "חצר פרטית + ג'קוזי",      floor: 1 },
  // Floor 2 — Balcony & panoramic suites
  { id: "201", type: "סוויטת אמטיסט",   desc: "מרפסת + Hot Tub",          floor: 2 },
  { id: "202", type: "סוויטת אמטיסט",   desc: "מרפסת + Hot Tub",          floor: 2 },
  { id: "203", type: "סוויטת אמטיסט",   desc: "מרפסת + Hot Tub",          floor: 2 },
  { id: "204", type: "סוויטת אמטיסט",   desc: "מרפסת + Hot Tub",          floor: 2 },
  { id: "205", type: "סוויטת אוניקס",   desc: "גג פנורמי + ג'קוזי",      floor: 2 },
  { id: "206", type: "סוויטת אוניקס",   desc: "גג פנורמי + ג'קוזי",      floor: 2 },
  { id: "207", type: "סוויטת אוניקס",   desc: "גג פנורמי + ג'קוזי",      floor: 2 },
  { id: "208", type: "סוויטת אוניקס",   desc: "גג פנורמי + ג'קוזי",      floor: 2 },
  // Floor 3 — Penthouse
  { id: "301", type: "סוויטת אמטיסט",   desc: "מרפסת + Hot Tub",          floor: 3 },
  { id: "302", type: "סוויטת אוניקס",   desc: "גג פנורמי + ג'קוזי",      floor: 3 },
  { id: "303", type: "סוויטת רובי",     desc: "חצר מלכותית + בריכה",     floor: 3 },
  { id: "304", type: "סוויטת רובי",     desc: "חצר מלכותית + בריכה",     floor: 3 },
  // Premium Day bungalows
  { id: "P1",  type: "Premium Day",     desc: "בקתה מפנקת יומית",         floor: 0 },
  { id: "P2",  type: "Premium Day",     desc: "בקתה מפנקת יומית",         floor: 0 },
  { id: "P3",  type: "Premium Day",     desc: "בקתה מפנקת יומית",         floor: 0 },
  { id: "P4",  type: "Premium Day",     desc: "בקתה מפנקת יומית",         floor: 0 },
  { id: "P5",  type: "Premium Day",     desc: "בקתה מפנקת יומית",         floor: 0 },
  { id: "P6",  type: "Premium Day",     desc: "בקתה מפנקת יומית",         floor: 0 },
];

const STATUS_META = {
  תפוס:    { border: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D" },
  פנוי:    { border: "#639922", bg: "#EAF3DE", text: "#3B6D11" },
  לניקיון: { border: "#BA7517", bg: "#FAEEDA", text: "#854F0B" },
  בניקיון: { border: "#378ADD", bg: "#E6F1FB", text: "#185FA5" },
  תחזוקה:  { border: "#888780", bg: "#F1EFE8", text: "#5F5E5A" },
};

const FLOOR_LABELS = {
  1: "קומה 1 — סוויטות גן",
  2: "קומה 2 — סוויטות מרפסת ופנורמה",
  3: "קומה 3 — פנטהאוז",
  0: "Premium Day — בקתות יומיות",
};

const NEXT_ACTIONS = {
  תפוס:    [{ label: "→ לניקיון", next: "לניקיון", primary: false }],
  לניקיון: [{ label: "התחל ניקיון", next: "בניקיון", primary: true }],
  בניקיון: [{ label: "✓ פנוי",    next: "פנוי",    primary: true }],
  פנוי:    [
    { label: "צ'ק-אין",  next: "תפוס",    primary: true  },
    { label: "תחזוקה",   next: "תחזוקה",  primary: false },
  ],
  תחזוקה:  [{ label: "✓ פנוי", next: "פנוי", primary: true }],
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

// ── Main component ────────────────────────────────────────────────────────────
export default function RoomBoard() {
  const [statusMap,  setStatusMap]  = useState({});
  const [guests,     setGuests]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState("הכל");
  const [updating,   setUpdating]   = useState(null);
  const [toast,      setToast]      = useState(null);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!supabase) return;
    const [{ data: statuses }, { data: guestRows }] = await Promise.all([
      supabase.from("room_status").select("room_id, status"),
      supabase
        .from("guests")
        .select("id, name, room, arrival_date, departure_date, status, phone")
        .in("status", ["checked_in", "room_ready"]),
    ]);
    if (statuses) {
      const map = {};
      statuses.forEach((r) => (map[r.room_id] = r.status));
      setStatusMap(map);
    }
    setGuests(guestRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Realtime ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("room-board-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_status" }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" },      fetchAll)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchAll]);

  // ── Update room status ──────────────────────────────────────────────────────
  async function updateStatus(roomId, newStatus) {
    if (!supabase) return;
    setUpdating(roomId);
    const { error } = await supabase
      .from("room_status")
      .upsert(
        { room_id: roomId, status: newStatus, updated_at: new Date().toISOString() },
        { onConflict: "room_id" }
      );
    if (error) {
      showToast("שגיאה: " + error.message, "error");
    } else {
      setStatusMap((prev) => ({ ...prev, [roomId]: newStatus }));
      showToast(`חדר ${roomId} → ${newStatus}`);
    }
    setUpdating(null);
  }

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Merge rooms ─────────────────────────────────────────────────────────────
  const rooms = SUITES.map((s) => ({
    ...s,
    status: statusMap[s.id] ?? "פנוי",
    guest:  guests.find((g) => String(g.room ?? "").trim() === String(s.id)) ?? null,
  }));

  const filtered = filter === "הכל" ? rooms : rooms.filter((r) => r.status === filter);

  const countOf = (st) => rooms.filter((r) => r.status === st).length;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const page = {
    direction: "rtl",
    padding: "24px",
    background: "var(--ivory, #F5F0E8)",
    minHeight: "100%",
    fontFamily: "Heebo, sans-serif",
  };

  if (loading) return (
    <div style={{ ...page, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <span style={{ fontSize: 32 }}>🏨</span>
      <span style={{ color: "var(--text-muted, #888)" }}>טוען לוח חדרים...</span>
    </div>
  );

  return (
    <div style={page}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: toast.type === "error" ? "#E24B4A" : "var(--gold, #C9A96E)",
          color: toast.type === "error" ? "#fff" : "#412402",
          borderRadius: 10, padding: "10px 18px",
          fontSize: 14, fontWeight: 700,
          boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--black, #1A1A1A)" }}>
          🏨 לוח חדרים — Dream Island
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted, #888)" }}>
          {countOf("תפוס")}/{rooms.length} תפוסים · {countOf("פנוי")} פנויים
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10, marginBottom: 16,
      }}>
        {["תפוס", "פנוי", "לניקיון", "בניקיון", "תחזוקה"].map((st) => (
          <div
            key={st}
            onClick={() => setFilter(filter === st ? "הכל" : st)}
            style={{
              background: "var(--card-bg, #fff)",
              border: "1px solid var(--border, #E0D5C5)",
              borderTop: `3px solid ${STATUS_META[st].border}`,
              borderRadius: 10, padding: "10px 12px",
              textAlign: "center", cursor: "pointer",
              opacity: filter !== "הכל" && filter !== st ? 0.45 : 1,
              transition: "opacity 0.2s",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 700, color: STATUS_META[st].border, lineHeight: 1.2 }}>
              {countOf(st)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted, #888)", marginTop: 2 }}>{st}</div>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {["הכל", "תפוס", "פנוי", "לניקיון", "בניקיון", "תחזוקה"].map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "5px 14px", borderRadius: 20, fontSize: 13,
                cursor: "pointer", fontFamily: "inherit",
                border: active ? "none" : "1px solid var(--border, #E0D5C5)",
                background: active ? "var(--gold, #C9A96E)" : "var(--card-bg, #fff)",
                color: active ? "#412402" : "var(--text-muted, #666)",
                fontWeight: active ? 700 : 400,
              }}
            >
              {f === "הכל" ? `הכל (${rooms.length})` : `${f} (${countOf(f)})`}
            </button>
          );
        })}
      </div>

      {/* Floors & rooms */}
      {[1, 2, 3, 0].map((floorNum) => {
        const floorRooms = filtered.filter((r) => r.floor === floorNum);
        if (!floorRooms.length) return null;
        return (
          <div key={floorNum}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: "var(--text-muted, #888)",
              margin: "18px 0 10px",
              borderBottom: "1px solid var(--border, #E0D5C5)",
              paddingBottom: 6,
            }}>
              {FLOOR_LABELS[floorNum]}
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 12,
            }}>
              {floorRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  isUpdating={updating === room.id}
                  onUpdate={updateStatus}
                />
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted, #aaa)" }}>
          אין חדרים בסטטוס זה
        </div>
      )}
    </div>
  );
}

// ── RoomCard ──────────────────────────────────────────────────────────────────
function RoomCard({ room, isUpdating, onUpdate }) {
  const [hovered, setHovered] = useState(null);
  const meta = STATUS_META[room.status] ?? STATUS_META["פנוי"];
  const actions = NEXT_ACTIONS[room.status] ?? [];

  return (
    <div
      style={{
        background: "var(--card-bg, #fff)",
        borderRadius: 12,
        border: "1px solid var(--border, #E0D5C5)",
        borderRight: `4px solid ${meta.border}`,
        padding: 14,
        opacity: isUpdating ? 0.6 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* Room number + badge */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--black, #1A1A1A)" }}>
          חדר {room.id}
        </div>
        <span style={{
          display: "inline-block", fontSize: 11, fontWeight: 700,
          padding: "2px 8px", borderRadius: 20,
          background: meta.bg, color: meta.text,
        }}>
          {room.status}
        </span>
      </div>

      {/* Suite type */}
      <div style={{ fontSize: 11, color: "var(--text-muted, #888)", marginBottom: 10 }}>
        {room.type}
      </div>

      {/* Guest info */}
      {room.guest ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--black, #1A1A1A)", marginBottom: 2 }}>
            👤 {room.guest.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted, #888)" }}>
            {fmtDate(room.guest.arrival_date)} — {fmtDate(room.guest.departure_date) ?? "?"}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#bbb", marginBottom: 10, height: 28 }}>
          ממתין להגעה
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        {isUpdating ? (
          <div style={{ fontSize: 12, color: "var(--text-muted, #888)", flex: 1, textAlign: "center" }}>
            מעדכן...
          </div>
        ) : (
          actions.map(({ label, next, primary }) => (
            <button
              key={next}
              onClick={() => onUpdate(room.id, next)}
              onMouseEnter={() => setHovered(next)}
              onMouseLeave={() => setHovered(null)}
              style={{
                flex: 1, padding: "5px 0", borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "Heebo, sans-serif",
                border: primary ? "none" : "1px solid var(--border, #E0D5C5)",
                background: primary
                  ? (hovered === next ? "var(--gold-dark, #A8843A)" : "var(--gold, #C9A96E)")
                  : (hovered === next ? "var(--ivory, #F5F0E8)" : "var(--card-bg, #fff)"),
                color: primary ? "#412402" : "var(--black, #1A1A1A)",
                transition: "background 0.15s",
              }}
            >
              {label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
