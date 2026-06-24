// src/components/HousekeepingTabletView.js
// Dedicated housekeeping tablet kiosk — three giant fat-finger buttons per
// room (🔴 מלוכלך / 🟡 בניקוי / 🟢 נקי), optimistic writes, zero blocking
// spinners. Built for staff mobile/tablet devices doing rapid room turnover.
//
// Shares `room_status` with RoomBoard.js + AICopilot.js (§0.5 Single Source
// of Truth — no parallel table or status vocabulary). Bucket → underlying
// DB write:
//   🔴 מלוכלך → status "לניקיון"
//   🟡 בניקוי → status "בניקיון"        (stamps cleaning_started_at)
//   🟢 נקי    → status "ממתין לאישור"   — NOT "פנוי" directly. AICopilot.js
//              already owns the "ממתין לאישור" → "פנוי" handoff: a manager
//              taps Approve, which sends the guest's "room ready" WhatsApp
//              message and only then flips the room to פנוי + guest to
//              checked_in. Writing "פנוי" straight from this tablet would
//              silently skip that guest-notification gate. So "נקי" here
//              means "done cleaning, pending sign-off" — instant for the
//              cleaner, and visually identical to "נקי" in this view either
//              way (see the small "🔔 ממתין לאישור מנהל" hint on the card).
//
// Rooms sitting in a status outside this 3-bucket model (תפוס/תחזוקה) are
// still listed — FAIL VISIBLE (§0.3) — with their own neutral badge, rather
// than being hidden or silently forced into one of the three buckets. All
// three buttons stay live on every card regardless (no disabled state —
// the spec calls for zero-click, not "disable, don't hide").

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { SUITE_REGISTRY } from "../data/suiteRegistry";

const BUCKETS = {
  dirty: {
    key: "dirty", label: "מלוכלך", emoji: "🔴", status: "לניקיון",
    border: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D",
  },
  cleaning: {
    key: "cleaning", label: "בניקוי", emoji: "🟡", status: "בניקיון",
    border: "#E8AE0A", bg: "#FDF6DC", text: "#8A6A00",
  },
  clean: {
    key: "clean", label: "נקי", emoji: "🟢", status: "ממתין לאישור",
    border: "#639922", bg: "#EAF3DE", text: "#3B6D11",
  },
};
const BUCKET_ORDER = ["dirty", "cleaning", "clean"];

// Known statuses that exist in room_status but fall outside the 3-button
// model — shown with their own neutral badge instead of "⚠ unknown".
const OTHER_STATUS_META = {
  תפוס:   { emoji: "🔒", label: "תפוס",   border: "#A32D2D", bg: "#FCEBEB", text: "#A32D2D" },
  תחזוקה: { emoji: "🔧", label: "תחזוקה", border: "#5F5E5A", bg: "#F1EFE8", text: "#5F5E5A" },
};

function bucketOf(rawStatus) {
  if (rawStatus === "לניקיון") return "dirty";
  if (rawStatus === "בניקיון") return "cleaning";
  if (rawStatus === "פנוי" || rawStatus === "ממתין לאישור") return "clean";
  return null;
}

// FAIL VISIBLE (§0.3) — a truly unrecognised value still renders, not crash.
function cardMeta(room) {
  if (room.bucket) return BUCKETS[room.bucket];
  return OTHER_STATUS_META[room.rawStatus]
    ?? { emoji: "⚠", label: room.rawStatus, border: "#999", bg: "#F1EFE8", text: "#5F5E5A" };
}

function fmtDuration(sec) {
  if (sec == null || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function HousekeepingTabletView({ isKioskMode = false, onLogout }) {
  const [statusMap, setStatusMap] = useState({});
  const [guests,    setGuests]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState("all"); // all | dirty | cleaning
  const [toast,     setToast]     = useState(null);

  // ── Fetch ───────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!supabase) return;
    const [{ data: statuses }, { data: guestRows }] = await Promise.all([
      supabase
        .from("room_status")
        .select("room_id, status, cleaning_started_at, last_clean_duration_sec"),
      supabase
        .from("guests")
        .select("id, name, room, suite_name, status")
        .in("status", ["checked_in", "room_ready", "pending", "expected"]),
    ]);
    if (statuses) {
      const map = {};
      statuses.forEach(r => {
        map[r.room_id] = {
          status: r.status,
          cleaningStartedAt: r.cleaning_started_at,
          lastDuration: r.last_clean_duration_sec,
        };
      });
      setStatusMap(map);
    }
    setGuests(guestRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Realtime — stays in sync with RoomBoard / AICopilot writes ─────────
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("housekeeping-tablet-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_status" }, fetchAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, fetchAll)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchAll]);

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Sprint 5.2 — single optimistic-write helper shared by all three
  // buttons. UI flips instantly; the DB write happens silently in the
  // background. Only a real failure reverts the card + shows a toast —
  // no spinner, no blocking on the network roundtrip.
  const applyTransition = useCallback(async (roomId, optimisticPatch, dbPayload, successMsg) => {
    if (!supabase) return;
    const prevEntry = statusMap[roomId];
    setStatusMap(prev => ({ ...prev, [roomId]: { ...(prev[roomId] ?? {}), ...optimisticPatch } }));
    const { error } = await supabase.from("room_status").upsert(
      { room_id: roomId, ...dbPayload, updated_at: new Date().toISOString() },
      { onConflict: "room_id" }
    );
    if (error) {
      setStatusMap(prev => ({ ...prev, [roomId]: prevEntry ?? {} }));
      showToast(`⚠️ ${roomId} — העדכון נכשל, בוטל (${error.message})`, "err");
    } else {
      showToast(successMsg);
    }
  }, [statusMap]);

  const setDirty = useCallback((roomId) => {
    applyTransition(roomId, { status: "לניקיון" }, { status: "לניקיון" }, `${roomId} → 🔴 מלוכלך`);
  }, [applyTransition]);

  const startCleaning = useCallback((roomId) => {
    const startedAt = new Date().toISOString();
    applyTransition(
      roomId,
      { status: "בניקיון", cleaningStartedAt: startedAt },
      { status: "בניקיון", cleaning_started_at: startedAt },
      `${roomId} → 🟡 בניקוי`
    );
  }, [applyTransition]);

  const markClean = useCallback((roomId, cleaningStartedAt) => {
    const durationSec = cleaningStartedAt
      ? Math.floor((Date.now() - new Date(cleaningStartedAt).getTime()) / 1000)
      : null;
    applyTransition(
      roomId,
      { status: "ממתין לאישור", cleaningStartedAt: null, lastDuration: durationSec },
      { status: "ממתין לאישור", cleaning_ended_at: new Date().toISOString(), last_clean_duration_sec: durationSec },
      `${roomId} → 🟢 נקי — ממתין לאישור מנהל 🔔`
    );
  }, [applyTransition]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const rooms = useMemo(() => SUITE_REGISTRY.map(id => {
    const entry = statusMap[id] ?? {};
    const rawStatus = entry.status ?? "פנוי";
    const guest = guests.find(g =>
      String(g.suite_name ?? "").trim() === id || String(g.room ?? "").trim() === id
    ) ?? null;
    return {
      id,
      rawStatus,
      bucket: bucketOf(rawStatus),
      cleaningStartedAt: entry.cleaningStartedAt ?? null,
      lastDuration: entry.lastDuration ?? null,
      guest,
    };
  }), [statusMap, guests]);

  const counts = useMemo(() => ({
    total: rooms.length,
    dirty: rooms.filter(r => r.bucket === "dirty").length,
    cleaning: rooms.filter(r => r.bucket === "cleaning").length,
    clean: rooms.filter(r => r.bucket === "clean").length,
  }), [rooms]);

  const filtered = filter === "all" ? rooms : rooms.filter(r => r.bucket === filter);

  if (loading) return (
    <div style={{ direction: "rtl", display: "flex", alignItems: "center", justifyContent: "center",
      gap: 12, padding: 48, fontFamily: "Heebo, sans-serif" }}>
      <span style={{ fontSize: 36 }}>🧹</span>
      <span style={{ color: "var(--text-muted)" }}>טוען לוח ניקיון...</span>
    </div>
  );

  return (
    <div style={{ direction: "rtl", padding: "20px 24px", fontFamily: "Heebo, sans-serif",
      background: "var(--ivory)", minHeight: "100%" }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          background: toast.type === "err" ? "#FCEBEB" : "#EAF3DE",
          color:      toast.type === "err" ? "#A32D2D"  : "#3B6D11",
          border:     `1px solid ${toast.type === "err" ? "#E24B4A" : "#639922"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--black)" }}>
          🧹 לוח ניקיון — טאבלט
        </div>
        {isKioskMode && onLogout && (
          <button
            onClick={onLogout}
            style={{
              padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
              border: "1.5px solid #E24B4A", background: "#FCEBEB", color: "#A32D2D",
            }}
          >
            יציאה
          </button>
        )}
      </div>

      {/* Sprint 5.3 — supervisor stats bar (read-only counters) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <StatTile label='סה"כ חדרים' value={counts.total}    color="var(--gold-dark)" />
        <StatTile label="מלוכלך"     value={counts.dirty}    color={BUCKETS.dirty.border} />
        <StatTile label="בניקוי"     value={counts.cleaning} color={BUCKETS.cleaning.border} />
        <StatTile label="נקי"        value={counts.clean}    color={BUCKETS.clean.border} />
      </div>

      {/* Quick filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {[
          { key: "all",      label: `הצג הכל (${counts.total})` },
          { key: "dirty",    label: `מלוכלך בלבד (${counts.dirty})` },
          { key: "cleaning", label: `בניקוי בלבד (${counts.cleaning})` },
        ].map(f => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: "9px 18px", borderRadius: 22, fontSize: 14,
                cursor: "pointer", fontFamily: "inherit",
                border:     active ? "none" : "1px solid var(--border)",
                background: active ? "var(--gold)" : "var(--card-bg)",
                color:      active ? "#412402"     : "var(--text-muted)",
                fontWeight: active ? 800 : 500,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Room grid — flat, no floor sections (kept deliberately simple for
          a tablet scan-and-tap workflow; RoomBoard.js still owns the
          sectioned manager view). */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 16,
      }}>
        {filtered.map(room => (
          <RoomTabletCard
            key={room.id}
            room={room}
            onSetDirty={setDirty}
            onStartCleaning={startCleaning}
            onMarkClean={markClean}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          אין חדרים בסטטוס זה
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, color }) {
  return (
    <div style={{
      background: "var(--card-bg)", border: "1px solid var(--border)",
      borderTop: `3px solid ${color}`, borderRadius: 10,
      padding: "12px 8px", textAlign: "center",
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function RoomTabletCard({ room, onSetDirty, onStartCleaning, onMarkClean }) {
  const [timerSec, setTimerSec] = useState(0);
  const meta = cardMeta(room);

  // Per-card live cleaning timer — only while this room is mid-clean.
  useEffect(() => {
    if (room.bucket !== "cleaning" || !room.cleaningStartedAt) {
      setTimerSec(0);
      return;
    }
    const compute = () =>
      Math.max(0, Math.floor((Date.now() - new Date(room.cleaningStartedAt).getTime()) / 1000));
    setTimerSec(compute());
    const id = setInterval(() => setTimerSec(compute()), 1000);
    return () => clearInterval(id);
  }, [room.bucket, room.cleaningStartedAt]);

  return (
    <div style={{
      background: "var(--card-bg)", borderRadius: 16,
      border: "1px solid var(--border)",
      borderRight: `5px solid ${meta.border}`,
      padding: "16px 16px 18px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Room id + status badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--black)" }}>{room.id}</div>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
          background: meta.bg, color: meta.text,
        }}>
          {meta.emoji} {meta.label}
        </span>
      </div>

      {/* Guest occupancy — minimal, just for cleaner awareness before entry */}
      {room.guest && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          👤 {room.guest.name}{room.guest.status === "checked_in" ? " (באתר)" : ""}
        </div>
      )}

      {/* Live cleaning timer */}
      {room.bucket === "cleaning" && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
          background: BUCKETS.cleaning.bg, borderRadius: 8, padding: "5px 10px",
          fontSize: 14, fontWeight: 800, color: BUCKETS.cleaning.text,
        }}>
          ⏱️ {fmtDuration(timerSec)}
        </div>
      )}

      {/* Last-clean duration badge — only once a manager has fully approved
          (raw status פנוי), matching RoomBoard's own display rule. */}
      {room.rawStatus === "פנוי" && room.lastDuration != null && (
        <div style={{ fontSize: 12, color: "#639922", fontWeight: 600 }}>
          ✓ נוקתה ב-{fmtDuration(room.lastDuration)}
        </div>
      )}

      {/* Transparency hint — "נקי" looks done here, but a manager still
          needs to tap Approve in AICopilot before the guest is notified. */}
      {room.rawStatus === "ממתין לאישור" && (
        <div style={{ fontSize: 12, color: "#8A6A00", fontWeight: 600 }}>
          🔔 ממתין לאישור מנהל
        </div>
      )}

      {/* Three giant fat-finger buttons — always live, never disabled */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        {BUCKET_ORDER.map(key => {
          const b = BUCKETS[key];
          const active = room.bucket === key;
          return (
            <button
              key={key}
              onClick={() => {
                if (key === "dirty")    onSetDirty(room.id);
                if (key === "cleaning") onStartCleaning(room.id);
                if (key === "clean")    onMarkClean(room.id, room.cleaningStartedAt);
              }}
              style={{
                width: "100%", minHeight: 60, borderRadius: 12,
                fontSize: 16, fontWeight: 800, cursor: "pointer",
                fontFamily: "Heebo, sans-serif", lineHeight: 1.3,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                border: active ? `2.5px solid ${b.border}` : "1.5px solid var(--border)",
                background: active ? b.bg : "var(--card-bg)",
                color: active ? b.text : "var(--black)",
                boxShadow: active ? `0 2px 10px ${b.border}33` : "none",
                transition: "background 0.12s, border-color 0.12s",
              }}
            >
              <span style={{ fontSize: 20 }}>{b.emoji}</span>
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
