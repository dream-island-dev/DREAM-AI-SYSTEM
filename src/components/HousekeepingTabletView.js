// src/components/HousekeepingTabletView.js
// Dedicated housekeeping tablet kiosk — three giant fat-finger buttons per
// room (🔴 מלוכלך/Dirty · 🟡 בניקוי/Cleaning · 🟢 נקי/Clean) plus a jacuzzi
// toggle, optimistic writes, zero blocking spinners. Built for staff
// mobile/tablet devices doing rapid room turnover, and bilingual HE/EN
// throughout so foreign staff can use it without translation help.
//
// Shares `room_status` with RoomBoard.js + AICopilot.js (§0.5 Single Source
// of Truth — no parallel table or status vocabulary). Bucket → underlying
// DB write:
//   🔴 Dirty    → status "לניקיון" (+ resets room_clean_status/jacuzzi_status
//                 to "dirty" — a fresh turnover cycle starting over)
//   🟡 Cleaning → status "בניקיון"        (stamps cleaning_started_at)
//   🟢 Clean    → room_clean_status "clean" — does NOT write status directly.
//
// Sprint 5.3 — Smart Ready-Alert Gate: the room only advances `status` to
// 'ממתין לאישור' once BOTH room_clean_status AND jacuzzi_status are "clean".
// AICopilot.js already owns the "ממתין לאישור" → "פנוי" handoff: a manager
// taps Approve there, which sends the guest's dedicated room-ready WhatsApp
// template and only then flips the room to פנוי + guest to checked_in.
// Writing "פנוי" (or even "ממתין לאישור") straight from a single tap here —
// before the jacuzzi is actually done — would let a half-finished suite
// reach the manager's approval queue. So tapping 🟢 alone (jacuzzi still
// dirty) just records "room side done" and shows a "waiting on jacuzzi"
// hint; the gate fires from whichever of the two actions completes the pair.
//
// Rooms sitting in a status outside this 3-bucket model (תפוס/תחזוקה) are
// still listed — FAIL VISIBLE (§0.3) — with their own neutral badge, rather
// than being hidden or silently forced into one of the three buckets. All
// buttons stay live on every card regardless (no disabled state — the spec
// calls for zero-click, not "disable, don't hide").

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { SUITE_REGISTRY } from "../data/suiteRegistry";

const BUCKETS = {
  dirty: {
    key: "dirty", label: "מלוכלך / Dirty", emoji: "🔴", status: "לניקיון",
    border: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D",
  },
  cleaning: {
    key: "cleaning", label: "בניקוי / Cleaning", emoji: "🟡", status: "בניקיון",
    border: "#E8AE0A", bg: "#FDF6DC", text: "#8A6A00",
  },
  clean: {
    key: "clean", label: "נקי / Clean", emoji: "🟢", status: "ממתין לאישור",
    border: "#639922", bg: "#EAF3DE", text: "#3B6D11",
  },
};
const BUCKET_ORDER = ["dirty", "cleaning", "clean"];

// Known statuses that exist in room_status but fall outside the 3-button
// model — shown with their own neutral badge instead of "⚠ unknown".
const OTHER_STATUS_META = {
  תפוס:   { emoji: "🔒", label: "תפוס / Occupied",    border: "#A32D2D", bg: "#FCEBEB", text: "#A32D2D" },
  תחזוקה: { emoji: "🔧", label: "תחזוקה / Maintenance", border: "#5F5E5A", bg: "#F1EFE8", text: "#5F5E5A" },
};

// Bucket is derived from `room_clean_status` for the "clean" end-state (not
// directly from `status`) — see header comment: the room can sit at
// status="בניקיון" in the DB while room_clean_status is already "clean",
// pending the jacuzzi. That in-between moment must still show 🟢 highlighted.
function bucketOf(rawStatus, roomCleanStatus) {
  if (roomCleanStatus === "clean" || rawStatus === "ממתין לאישור" || rawStatus === "פנוי") return "clean";
  if (rawStatus === "בניקיון") return "cleaning";
  if (rawStatus === "לניקיון") return "dirty";
  return null;
}

// FAIL VISIBLE (§0.3) — a truly unrecognised value still renders, not crash.
function cardMeta(room) {
  if (room.bucket) return BUCKETS[room.bucket];
  return OTHER_STATUS_META[room.rawStatus]
    ?? { emoji: "⚠", label: `${room.rawStatus} / Unknown`, border: "#999", bg: "#F1EFE8", text: "#5F5E5A" };
}

function fmtDuration(sec) {
  if (sec == null || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function HousekeepingTabletView({ isKioskMode = false, onLogout }) {
  const [statusMap, setStatusMap] = useState({});
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState("all"); // all | dirty | cleaning
  const [toast,     setToast]     = useState(null);

  // ── Fetch ───────────────────────────────────────────────────────────────
  // No `guests` read here (session "RESTRICTED CLEANER ROLE" — migration 087
  // blocks the cleaner role from the guests table entirely, customer PII).
  // Occupancy awareness ("don't walk in on a guest") now comes purely from
  // room_status.status === "תפוס" — the same column this view already reads,
  // zero extra query, zero guest name/PII exposed.
  const fetchAll = useCallback(async () => {
    if (!supabase) return;
    const { data: statuses } = await supabase
      .from("room_status")
      .select("room_id, status, cleaning_started_at, last_clean_duration_sec, jacuzzi_status, room_clean_status");
    if (statuses) {
      const map = {};
      statuses.forEach(r => {
        map[r.room_id] = {
          status: r.status,
          cleaningStartedAt: r.cleaning_started_at,
          lastDuration: r.last_clean_duration_sec,
          jacuzziStatus: r.jacuzzi_status ?? "dirty",
          roomCleanStatus: r.room_clean_status ?? "dirty",
        };
      });
      setStatusMap(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Realtime — stays in sync with RoomBoard / AICopilot writes ─────────
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("housekeeping-tablet-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_status" }, fetchAll)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchAll]);

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Sprint 5.2 — single optimistic-write helper shared by every button.
  // UI flips instantly; the DB write happens silently in the background.
  // Only a real failure reverts the card + shows a toast — no spinner, no
  // blocking on the network roundtrip.
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
      showToast(`⚠️ ${roomId} — העדכון נכשל, בוטל / update failed, reverted (${error.message})`, "err");
    } else {
      showToast(successMsg);
    }
  }, [statusMap]);

  const setDirty = useCallback((roomId) => {
    applyTransition(
      roomId,
      { status: "לניקיון", roomCleanStatus: "dirty", jacuzziStatus: "dirty", cleaningStartedAt: null, lastDuration: null },
      { status: "לניקיון", room_clean_status: "dirty", jacuzzi_status: "dirty" },
      `${roomId} → 🔴 מלוכלך / Dirty`
    );
  }, [applyTransition]);

  const startCleaning = useCallback((roomId) => {
    const startedAt = new Date().toISOString();
    applyTransition(
      roomId,
      { status: "בניקיון", cleaningStartedAt: startedAt },
      { status: "בניקיון", cleaning_started_at: startedAt },
      `${roomId} → 🟡 בניקוי / Cleaning`
    );
  }, [applyTransition]);

  // Sprint 5.3 — gated: only advances `status` to "ממתין לאישור" once the
  // jacuzzi is also already clean. Otherwise just records the room-side tap.
  const markClean = useCallback((roomId, cleaningStartedAt, jacuzziStatus) => {
    const durationSec = cleaningStartedAt
      ? Math.floor((Date.now() - new Date(cleaningStartedAt).getTime()) / 1000)
      : null;
    const bothClean = jacuzziStatus === "clean";
    applyTransition(
      roomId,
      {
        roomCleanStatus: "clean", cleaningStartedAt: null, lastDuration: durationSec,
        ...(bothClean ? { status: "ממתין לאישור" } : {}),
      },
      {
        room_clean_status: "clean", cleaning_ended_at: new Date().toISOString(), last_clean_duration_sec: durationSec,
        ...(bothClean ? { status: "ממתין לאישור" } : {}),
      },
      bothClean
        ? `${roomId} → 🟢 נקי — ממתין לאישור מנהל 🔔 / Pending approval`
        : `${roomId} → 🟢 חדר נקי, מחכה לג'קוזי 🛁 / Room clean, jacuzzi pending`
    );
  }, [applyTransition]);

  // Sprint 5.3 — wide jacuzzi toggle. Fires the same gate from the other
  // direction when this is the second of the pair to become "clean".
  const toggleJacuzzi = useCallback((roomId, jacuzziStatus, roomCleanStatus) => {
    const next = jacuzziStatus === "clean" ? "dirty" : "clean";
    const bothClean = next === "clean" && roomCleanStatus === "clean";
    applyTransition(
      roomId,
      { jacuzziStatus: next, ...(bothClean ? { status: "ממתין לאישור" } : {}) },
      { jacuzzi_status: next, ...(bothClean ? { status: "ממתין לאישור" } : {}) },
      bothClean
        ? `${roomId} → 🛁✓ ממתין לאישור מנהל 🔔 / Pending approval`
        : next === "clean"
          ? `${roomId} → ✨ ג'קוזי נקי / Jacuzzi clean`
          : `${roomId} → 🛁 ג'קוזי מלוכלך / Jacuzzi dirty`
    );
  }, [applyTransition]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const rooms = useMemo(() => SUITE_REGISTRY.map(id => {
    const entry = statusMap[id] ?? {};
    const rawStatus = entry.status ?? "פנוי";
    const roomCleanStatus = entry.roomCleanStatus ?? "dirty";
    const jacuzziStatus = entry.jacuzziStatus ?? "dirty";
    return {
      id,
      rawStatus,
      roomCleanStatus,
      jacuzziStatus,
      bucket: bucketOf(rawStatus, roomCleanStatus),
      cleaningStartedAt: entry.cleaningStartedAt ?? null,
      lastDuration: entry.lastDuration ?? null,
      occupied: rawStatus === "תפוס",
    };
  }), [statusMap]);

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
      <span style={{ color: "var(--text-muted)" }}>טוען לוח ניקיון... / Loading...</span>
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
          🧹 לוח ניקיון — טאבלט / Housekeeping Board
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
            יציאה / Exit
          </button>
        )}
      </div>

      {/* Sprint 5.3 — supervisor stats bar (read-only counters).
          auto-fit/minmax (not a fixed 4-column count) so the bilingual labels
          don't clip on a real tablet viewport — reflows to 2 columns instead. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        <StatTile label='סה"כ חדרים / Total' value={counts.total}    color="var(--gold-dark)" />
        <StatTile label="מלוכלך / Dirty"     value={counts.dirty}    color={BUCKETS.dirty.border} />
        <StatTile label="בניקוי / Cleaning"  value={counts.cleaning} color={BUCKETS.cleaning.border} />
        <StatTile label="נקי / Clean"        value={counts.clean}    color={BUCKETS.clean.border} />
      </div>

      {/* Quick filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {[
          { key: "all",      label: `הצג הכל / Show All (${counts.total})` },
          { key: "dirty",    label: `מלוכלך בלבד / Dirty Only (${counts.dirty})` },
          { key: "cleaning", label: `בניקוי בלבד / Cleaning Only (${counts.cleaning})` },
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
            onToggleJacuzzi={toggleJacuzzi}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          אין חדרים בסטטוס זה / No rooms in this status
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

function RoomTabletCard({ room, onSetDirty, onStartCleaning, onMarkClean, onToggleJacuzzi }) {
  const [timerSec, setTimerSec] = useState(0);
  const meta = cardMeta(room);
  const jacuzziClean = room.jacuzziStatus === "clean";

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
          fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
          background: meta.bg, color: meta.text, textAlign: "center",
        }}>
          {meta.emoji} {meta.label}
        </span>
      </div>

      {/* Occupancy — name-free by design (cleaner role has no guests access,
          migration 087); room_status itself already says "תפוס" when a
          guest is on-site, which is all the "knock before entering" signal
          this card needs. */}
      {room.occupied && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          🔒 תפוס — יש אורח בחדר / Occupied
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
          ✓ נוקתה ב-{fmtDuration(room.lastDuration)} / Cleaned in {fmtDuration(room.lastDuration)}
        </div>
      )}

      {/* Smart Ready-Alert Gate transparency hints (§0.3 FAIL VISIBLE) */}
      {room.rawStatus === "ממתין לאישור" && (
        <div style={{ fontSize: 12, color: "#8A6A00", fontWeight: 600 }}>
          🔔 ממתין לאישור מנהל / Pending manager approval
        </div>
      )}
      {room.roomCleanStatus === "clean" && !jacuzziClean && room.rawStatus !== "ממתין לאישור" && (
        <div style={{ fontSize: 12, color: "#8A6A00", fontWeight: 600 }}>
          ✓ חדר נקי — מחכה לג'קוזי 🛁 / Room clean — waiting on jacuzzi
        </div>
      )}
      {jacuzziClean && room.roomCleanStatus !== "clean" && (
        <div style={{ fontSize: 12, color: "#8A6A00", fontWeight: 600 }}>
          ✓ ג'קוזי נקי — מחכה לחדר 🧹 / Jacuzzi clean — waiting on room
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
                if (key === "clean")    onMarkClean(room.id, room.cleaningStartedAt, room.jacuzziStatus);
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

        {/* Sprint 5.2 — dedicated jacuzzi toggle, independent mini-pipeline */}
        <button
          onClick={() => onToggleJacuzzi(room.id, room.jacuzziStatus, room.roomCleanStatus)}
          style={{
            width: "100%", minHeight: 60, borderRadius: 12, marginTop: 2,
            fontSize: 15, fontWeight: 800, cursor: "pointer",
            fontFamily: "Heebo, sans-serif", lineHeight: 1.3,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            border: jacuzziClean ? "2.5px solid #0F9C8E" : "2.5px solid #E24B4A",
            background: jacuzziClean ? "#E3FAF5" : "#FCEBEB",
            color: jacuzziClean ? "#0F766E" : "#A32D2D",
            boxShadow: jacuzziClean ? "0 2px 10px #0F9C8E33" : "0 2px 10px #E24B4A33",
            transition: "background 0.12s, border-color 0.12s",
          }}
        >
          {jacuzziClean ? (
            <>✨ ג'קוזי נקי ✅ / Jacuzzi Clean ✅</>
          ) : (
            <>🛁 ג'קוזי מלוכלך / Jacuzzi Dirty</>
          )}
        </button>
      </div>
    </div>
  );
}
