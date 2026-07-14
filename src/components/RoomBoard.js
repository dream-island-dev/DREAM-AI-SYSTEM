// src/components/RoomBoard.js
// Sprint 1 — Tablet-Optimized Housekeeping Kiosk
// • Bilingual HE/EN toggle (no npm deps)
// • Live cleaning timer (mm:ss) per room, self-contained in each card
// • Confirmation modal before marking a room "פנוי"
// • Auto-notifies arriving guest via room-clean-notify Edge Function

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../supabaseClient";
import { SUITE_REGISTRY, SUITE_SECTIONS } from "../data/suiteRegistry";
import {
  performSuiteCheckIn,
  skipApprovalAndCheckIn,
  releaseApprovalGateOnly,
} from "../utils/suiteCheckinSync";
import { israelTodayStr, israelDateOffsetStr } from "../utils/guestTiming";
import { isPreArrivalTodayGuest } from "../utils/guestCheckinMatrix";
import {
  buildRoomGuestMap,
  isGuestInStay,
  isArrivalTodayGuest,
  isArrivalTomorrowGuest,
} from "../utils/roomBoardGuestResolve";
import {
  detectRoomSyncMismatch,
  planRoomBoardReconcile,
  applyRoomBoardReconcile,
  resolveEffectiveRoomStatus,
} from "../utils/roomBoardSync";

// ── Suite definitions — driven by the physical registry (26 suites) ───────
const SUITES = SUITE_REGISTRY.map(name => {
  const brand   = name.replace(/\s+\d+$/, "").trim();          // "ג׳ספר 1" → "ג׳ספר"
  const secEntry = SUITE_SECTIONS.find(sec => sec.prefix.some(p => name.startsWith(p)));
  return {
    id:      name,                          // used as room_status.room_id in DB
    type:    `סוויטת ${brand}`,
    section: secEntry?.label ?? "אחר",
  };
});

const STATUS_META = {
  תפוס:           { border: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D" },
  פנוי:           { border: "#639922", bg: "#EAF3DE", text: "#3B6D11" },
  לניקיון:        { border: "#BA7517", bg: "#FAEEDA", text: "#854F0B" },
  בניקיון:        { border: "#378ADD", bg: "#E6F1FB", text: "#185FA5" },
  "ממתין לג'קוזי": { border: "#22A8C9", bg: "#E8F7FC", text: "#0E7490" },
  "מוכן לפיניש":   { border: "#7C5CBF", bg: "#F3EEFC", text: "#5B3FA0" },
  "ממתין לאישור": { border: "#E8AE0A", bg: "#FDF6DC", text: "#8A6A00" },
  תחזוקה:         { border: "#888780", bg: "#F1EFE8", text: "#5F5E5A" },
};

// fn: "update" | "start_clean" | "confirm_clean"
const STATUS_ACTIONS = {
  תפוס:           [{ labelKey: "toClean",    next: "לניקיון", primary: false, fn: "update"        }],
  לניקיון:        [{ labelKey: "startClean", next: "בניקיון", primary: true,  fn: "start_clean"   }],
  בניקיון:        [{ labelKey: "markReady",  next: "פנוי",    primary: true,  fn: "confirm_clean" }],
  "ממתין לג'קוזי": [],
  "מוכן לפיניש":   [],
  "ממתין לאישור": [
    { labelKey: "checkinNoMsg", next: "תפוס", primary: true,  fn: "skip_check_in" },
    { labelKey: "releaseGate",  next: "פנוי", primary: false, fn: "release_gate"  },
  ],
  פנוי: [
    { labelKey: "checkin", next: "תפוס",   primary: true,  fn: "check_in"      },
    { labelKey: "maint",   next: "תחזוקה", primary: false, fn: "update" },
  ],
  תחזוקה: [{ labelKey: "doneReady", next: "פנוי", primary: true, fn: "update" }],
};

// ── Translations ──────────────────────────────────────────────────────────
const TR = {
  he: {
    header:          "🏨 לוח סוויטות",
    loading:         "טוען לוח סוויטות...",
    all:             "הכל",
    toggleLang:      "EN",
    updating:        "מעדכן...",
    awaitingArrival: "ממתין להגעה",
    noRooms:         "אין חדרים בסטטוס זה",
    occupiedOf:      (n, total) => `${n}/${total} תפוסים`,
    availLabel:      (n) => `${n} פנויים`,
    statusLabels:    { תפוס: "תפוס", פנוי: "פנוי", לניקיון: "לניקיון", בניקיון: "בניקיון", "ממתין לג'קוזי": "ממתין לג'קוזי", "מוכן לפיניש": "מוכן לפיניש", "ממתין לאישור": "ממתין לאישור", תחזוקה: "תחזוקה" },
    actions: {
      toClean:    "→ לניקיון",
      startClean: "▶ התחל ניקיון",
      markReady:  "✓ סיים",
      checkin:    "צ'ק-אין",
      checkinNoMsg: "צ'ק-אין בלי הודעה",
      releaseGate: "סגור שער",
      maint:      "תחזוקה",
      doneReady:  "✓ פנוי",
    },
    confirmTitle:    (id) => `סוויטה ${id} — סיום ניקיון`,
    confirmMsg:      "הסוויטה נקייה ומוכנה לאורח?",
    confirmYes:      "✓ אישור — שלח לאישור מנהל",
    confirmNo:       "ביטול",
    cleanedIn:       (dur) => `נוקתה ב-${dur}`,
    toastUpdate:     (id, st) => `סוויטה ${id} → ${st}`,
    toastCleanStart: (id) => `סוויטה ${id} — ניקיון התחיל`,
    toastCheckIn:    (id) => `סוויטה ${id} — צ'ק-אין מסונכרן ✓`,
    toastCheckInWarn:(id) => `סוויטה ${id} → תפוס (אין אורח משויך — קבלה לא עודכנה)`,
    toastSkipGate:   (id) => `סוויטה ${id} — צ'ק-אין בלי הודעה ✓`,
    toastReleaseGate:(id) => `סוויטה ${id} — שער אישור נסגר`,
    toastCleanDone:  (id) => `סוויטה ${id} — ממתין לאישור מנהל 🔔`,
    arrivalsToday:   "הגעות היום",
    arrivalToday:    "🟡 הגעה היום",
    arrivalTomorrow: "🔵 הגעה מחר",
    arrivalUpcoming: "🔵 הגעה קרובה",
  },
  en: {
    header:          "🏨 Room Board",
    loading:         "Loading room board...",
    all:             "All",
    toggleLang:      "עב",
    updating:        "Updating...",
    awaitingArrival: "Awaiting arrival",
    noRooms:         "No rooms with this status",
    occupiedOf:      (n, total) => `${n}/${total} occupied`,
    availLabel:      (n) => `${n} available`,
    statusLabels:    { תפוס: "Occupied", פנוי: "Available", לניקיון: "For Cleaning", בניקיון: "Cleaning", "ממתין לג'קוזי": "Waiting Jacuzzi", "מוכן לפיניש": "Ready Finish", "ממתין לאישור": "Pending Approval", תחזוקה: "Maintenance" },
    actions: {
      toClean:    "→ For Cleaning",
      startClean: "▶ Start Cleaning",
      markReady:  "✓ Mark Ready",
      checkin:    "Check-in",
      checkinNoMsg: "Check-in (no msg)",
      releaseGate: "Close gate",
      maint:      "Maintenance",
      doneReady:  "✓ Available",
    },
    confirmTitle:    (id) => `Room ${id} — Confirm Clean`,
    confirmMsg:      "Is the suite clean and ready for the guest?",
    confirmYes:      "✓ Confirm — Mark Ready",
    confirmNo:       "Cancel",
    cleanedIn:       (dur) => `Cleaned in ${dur}`,
    toastUpdate:     (id, st) => `Room ${id} → ${st}`,
    toastCleanStart: (id) => `Room ${id} — Cleaning started`,
    toastCheckIn:    (id) => `Room ${id} — synced check-in ✓`,
    toastCheckInWarn:(id) => `Room ${id} → occupied (no guest linked)`,
    toastSkipGate:   (id) => `Room ${id} — check-in without message ✓`,
    toastReleaseGate:(id) => `Room ${id} — approval gate closed`,
    toastCleanDone:  (id) => `Room ${id} — Ready for guest ✓`,
    arrivalsToday:   "Today's arrivals",
    arrivalToday:    "🟡 Arriving today",
    arrivalTomorrow: "🔵 Arriving tomorrow",
    arrivalUpcoming: "🔵 Upcoming arrival",
  },
};

function fmtDuration(sec) {
  if (sec == null || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const STATUSES = ["תפוס", "פנוי", "לניקיון", "בניקיון", "ממתין לג'קוזי", "מוכן לפיניש", "ממתין לאישור", "תחזוקה"];

// ── Main component ────────────────────────────────────────────────────────
export default function RoomBoard({ isKioskMode = false, onLogout }) {
  const [statusMap,   setStatusMap]   = useState({});
  const [guests,      setGuests]      = useState([]);
  const [suiteRows,   setSuiteRows]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState(isKioskMode ? "לניקיון" : "הכל");
  const [updating,    setUpdating]    = useState(null);
  const [toast,       setToast]       = useState(null);
  const [lang,        setLang]        = useState("he");
  const [confirmRoom, setConfirmRoom] = useState(null);
  // WA notification state per room: "sending" | "sent" | "failed"
  const [notifyState, setNotifyState] = useState({});

  const t = TR[lang];
  const syncLock = useRef(false);

  // ── Fetch + auto-reconcile room_status ↔ guests (no manual button) ─────
  const syncBoard = useCallback(async () => {
    if (!supabase || syncLock.current) return;
    syncLock.current = true;
    try {
      const today = israelTodayStr();
      const weekAhead = israelDateOffsetStr(7, today);
      const [{ data: statuses }, { data: guestRows }, { data: suiteRoomRows }] = await Promise.all([
        supabase
          .from("room_status")
          .select("room_id, status, cleaning_started_at, last_clean_duration_sec"),
        supabase
          .from("guests")
          .select("id, name, room, suite_name, arrival_date, departure_date, status, phone, spa_time")
          .neq("status", "cancelled")
          .or(`status.eq.checked_in,and(arrival_date.gte.${today},arrival_date.lte.${weekAhead})`)
          .in("status", ["checked_in", "room_ready", "pending", "expected"]),
        supabase
          .from("suite_rooms")
          .select("guest_id, room_display, room_name, suite_type, arrival_date")
          .not("guest_id", "is", null)
          .gte("arrival_date", today)
          .lte("arrival_date", weekAhead),
      ]);

      const guestList = guestRows ?? [];
      const suiteList = suiteRoomRows ?? [];
      const guestByRoom = buildRoomGuestMap(SUITE_REGISTRY, guestList, suiteList, today);

      const map = {};
      (statuses ?? []).forEach((r) => {
        map[r.room_id] = {
          status:            r.status,
          cleaningStartedAt: r.cleaning_started_at,
          lastDuration:      r.last_clean_duration_sec,
        };
      });

      const snapshot = SUITES.map((s) => {
        const guest = guestByRoom[s.id] ?? null;
        const dbStatus = map[s.id]?.status ?? "פנוי";
        return {
          id: s.id,
          status: dbStatus,
          guest,
          syncMismatch: detectRoomSyncMismatch(dbStatus, guest, today),
        };
      });

      const fixes = planRoomBoardReconcile(snapshot);
      if (fixes.length) {
        await applyRoomBoardReconcile(supabase, fixes);
        const now = new Date().toISOString();
        for (const fix of fixes) {
          map[fix.roomId] = { ...(map[fix.roomId] ?? {}), status: fix.to, updatedAt: now };
        }
      }

      setStatusMap(map);
      setGuests(guestList);
      setSuiteRows(suiteList);
    } finally {
      syncLock.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { syncBoard(); }, [syncBoard]);

  // ── Realtime ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("room-board-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_status" }, syncBoard)
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, syncBoard)
      .on("postgres_changes", { event: "*", schema: "public", table: "suite_rooms" }, syncBoard)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [syncBoard]);

  // ── Toast ───────────────────────────────────────────────────────────────
  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── WA notify helper (shared by confirm + retry) ───────────────────────
  function fireNotify(roomId) {
    setNotifyState(prev => ({ ...prev, [roomId]: "sending" }));
    supabase.functions
      .invoke("room-clean-notify", { body: { room_id: roomId } })
      .then(({ data, error: waErr }) => {
        const ok = !waErr && data?.notified !== false;
        setNotifyState(prev => ({ ...prev, [roomId]: ok ? "sent" : "failed" }));
        if (ok) setTimeout(() => setNotifyState(prev => {
          const s = { ...prev }; delete s[roomId]; return s;
        }), 6000);
      })
      .catch(() => setNotifyState(prev => ({ ...prev, [roomId]: "failed" })));
  }

  // ── Regular status transition — optimistic ──────────────────────────────
  async function updateStatus(roomId, nextStatus) {
    if (!supabase) return;
    const prevEntry = statusMap[roomId];
    // Optimistic: update UI immediately
    setStatusMap(prev => ({ ...prev, [roomId]: { ...(prev[roomId] ?? {}), status: nextStatus } }));
    setUpdating(roomId);
    const { error } = await supabase.from("room_status").upsert(
      { room_id: roomId, status: nextStatus, updated_at: new Date().toISOString() },
      { onConflict: "room_id" }
    );
    if (error) {
      setStatusMap(prev => ({ ...prev, [roomId]: prevEntry ?? {} })); // revert
      showToast("שגיאה: " + error.message, "err");
    } else {
      showToast(t.toastUpdate(roomId, t.statusLabels[nextStatus] ?? nextStatus));
    }
    setUpdating(null);
  }

  // ── Synced check-in (guests + room_status) ─────────────────────────────
  async function handleCheckIn(room, { skipMessage = false } = {}) {
    if (!supabase) return;
    const roomId = room.id;
    const prevEntry = statusMap[roomId];
    setUpdating(roomId);

    if (room.guest?.id) {
      const result = skipMessage
        ? await skipApprovalAndCheckIn(supabase, room.guest, roomId)
        : await performSuiteCheckIn(supabase, room.guest, { roomId });

      if (!result.ok) {
        showToast("שגיאה: " + result.error, "err");
        setUpdating(null);
        return;
      }

      setStatusMap(prev => ({
        ...prev,
        [roomId]: { ...(prev[roomId] ?? {}), status: "תפוס" },
      }));
      setGuests(prev => prev.map(g =>
        g.id === room.guest.id ? { ...g, ...result.guestPatch } : g
      ));
      showToast(skipMessage ? t.toastSkipGate(roomId) : t.toastCheckIn(roomId));
    } else if (skipMessage) {
      showToast("אין אורח משויך — לא ניתן לבצע צ'ק-אין", "err");
    } else {
      setStatusMap(prev => ({
        ...prev,
        [roomId]: { ...(prev[roomId] ?? {}), status: "תפוס" },
      }));
      const { error } = await supabase.from("room_status").upsert(
        { room_id: roomId, status: "תפוס", updated_at: new Date().toISOString() },
        { onConflict: "room_id" },
      );
      if (error) {
        setStatusMap(prev => ({ ...prev, [roomId]: prevEntry ?? {} }));
        showToast("שגיאה: " + error.message, "err");
      } else {
        showToast(t.toastCheckInWarn(roomId), "err");
      }
    }
    setUpdating(null);
  }

  async function handleReleaseGate(roomId) {
    if (!supabase) return;
    const prevEntry = statusMap[roomId];
    setStatusMap(prev => ({
      ...prev,
      [roomId]: { ...(prev[roomId] ?? {}), status: "פנוי" },
    }));
    setUpdating(roomId);

    const result = await releaseApprovalGateOnly(supabase, roomId);
    if (!result.ok) {
      setStatusMap(prev => ({ ...prev, [roomId]: prevEntry ?? {} }));
      showToast("שגיאה: " + result.error, "err");
    } else {
      showToast(t.toastReleaseGate(roomId));
    }
    setUpdating(null);
  }

  // ── Start cleaning — optimistic, stamps cleaning_started_at ────────────
  async function handleCleanStart(roomId) {
    if (!supabase) return;
    const prevEntry = statusMap[roomId];
    const startedAt = new Date().toISOString();
    // Optimistic
    setStatusMap(prev => ({ ...prev, [roomId]: { ...(prev[roomId] ?? {}), status: "בניקיון", cleaningStartedAt: startedAt } }));
    setUpdating(roomId);
    const { error } = await supabase.from("room_status").upsert(
      { room_id: roomId, status: "בניקיון", cleaning_started_at: startedAt, updated_at: startedAt },
      { onConflict: "room_id" }
    );
    if (error) {
      setStatusMap(prev => ({ ...prev, [roomId]: prevEntry ?? {} })); // revert
      showToast("שגיאה: " + error.message, "err");
    } else {
      showToast(t.toastCleanStart(roomId));
    }
    setUpdating(null);
  }

  // ── Open confirmation modal ─────────────────────────────────────────────
  function handleCleanDoneRequest(room) {
    setConfirmRoom({
      id:                room.id,
      cleaningStartedAt: room.cleaningStartedAt,
      guestName:         room.guest?.name ?? null,
    });
  }

  // ── Confirm → write duration, mark ממתין לאישור — optimistic ───────────
  async function handleCleanConfirm() {
    if (!confirmRoom || !supabase) return;
    const { id: roomId, cleaningStartedAt } = confirmRoom;
    setConfirmRoom(null);

    const prevEntry   = statusMap[roomId];
    const endedAt     = new Date().toISOString();
    const durationSec = cleaningStartedAt
      ? Math.floor((Date.now() - new Date(cleaningStartedAt).getTime()) / 1000)
      : null;

    // Optimistic: show pending approval so cleaner sees instant feedback
    setStatusMap(prev => ({
      ...prev,
      [roomId]: { ...(prev[roomId] ?? {}), status: "ממתין לאישור", cleaningStartedAt: null, lastDuration: durationSec },
    }));
    setUpdating(roomId);

    const { error } = await supabase.from("room_status").upsert(
      { room_id: roomId, status: "ממתין לאישור", cleaning_ended_at: endedAt, last_clean_duration_sec: durationSec, updated_at: endedAt },
      { onConflict: "room_id" }
    );

    if (error) {
      setStatusMap(prev => ({ ...prev, [roomId]: prevEntry ?? {} })); // revert
      showToast("שגיאה: " + error.message, "err");
    } else {
      showToast(t.toastCleanDone(roomId));
    }
    setUpdating(null);
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  const todayIL = israelTodayStr();
  const guestByRoom = useMemo(
    () => buildRoomGuestMap(SUITE_REGISTRY, guests, suiteRows, todayIL),
    [guests, suiteRows, todayIL],
  );

  const rooms = useMemo(() =>
    SUITES.map(s => {
      const guest = guestByRoom[s.id] ?? null;
      const dbStatus = statusMap[s.id]?.status ?? "פנוי";
      const status = resolveEffectiveRoomStatus(dbStatus, guest, todayIL);
      return {
        ...s,
        status,
        dbStatus,
        cleaningStartedAt: statusMap[s.id]?.cleaningStartedAt ?? null,
        lastDuration:      statusMap[s.id]?.lastDuration      ?? null,
        guest,
        syncMismatch: detectRoomSyncMismatch(dbStatus, guest, todayIL),
        isArrivalToday: isArrivalTodayGuest(guest, todayIL) || isPreArrivalTodayGuest(guest, todayIL),
      };
    }),
    [statusMap, guestByRoom, todayIL],
  );

  const todayArrivalCount = rooms.filter(r => r.isArrivalToday).length;

  const filtered = useMemo(() => {
    if (filter === "הגעות היום") {
      return rooms.filter(r => r.isArrivalToday || isGuestInStay(r.guest, todayIL));
    }
    if (filter === "הכל") return rooms;
    return rooms.filter(r => r.status === filter);
  }, [rooms, filter, todayIL]);

  const countOf  = (st) => rooms.filter(r => r.status === st).length;

  if (loading) return (
    <div style={{ direction: "rtl", display: "flex", alignItems: "center", justifyContent: "center",
      gap: 12, padding: 48, fontFamily: "Heebo, sans-serif" }}>
      <span style={{ fontSize: 36 }}>🏨</span>
      <span style={{ color: "var(--text-muted)" }}>{t.loading}</span>
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

      {/* Confirmation Modal */}
      {confirmRoom && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setConfirmRoom(null)}
        >
          <div
            style={{ background: "var(--card-bg)", borderRadius: 20, padding: 36,
              maxWidth: 440, width: "100%", textAlign: "center",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 52, marginBottom: 14 }}>🛏️</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--black)", marginBottom: 10 }}>
              {t.confirmTitle(confirmRoom.id)}
            </div>
            {confirmRoom.guestName && (
              <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 6 }}>
                👤 {confirmRoom.guestName}
              </div>
            )}
            {confirmRoom.cleaningStartedAt && (
              <div style={{ fontSize: 14, color: "#185FA5", fontWeight: 700, marginBottom: 16 }}>
                ⏱️ {fmtDuration(Math.floor((Date.now() - new Date(confirmRoom.cleaningStartedAt).getTime()) / 1000))}
              </div>
            )}
            <div style={{ fontSize: 15, color: "var(--black)", marginBottom: 28, lineHeight: 1.7 }}>
              {t.confirmMsg}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => setConfirmRoom(null)}
                style={{
                  flex: 1, padding: "15px 0", borderRadius: 12, fontSize: 15, fontWeight: 600,
                  cursor: "pointer", fontFamily: "Heebo, sans-serif",
                  border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)",
                }}
              >
                {t.confirmNo}
              </button>
              <button
                onClick={handleCleanConfirm}
                style={{
                  flex: 2, padding: "15px 0", borderRadius: 12, fontSize: 15, fontWeight: 800,
                  cursor: "pointer", fontFamily: "Heebo, sans-serif",
                  border: "none", background: "#639922", color: "#fff",
                  boxShadow: "0 4px 16px rgba(99,153,34,0.4)",
                }}
              >
                {t.confirmYes}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--black)" }}>
          {t.header}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {t.occupiedOf(countOf("תפוס"), rooms.length)} · {t.availLabel(countOf("פנוי"))}
          </div>
          <button
            onClick={() => setLang(l => l === "he" ? "en" : "he")}
            style={{
              padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
              border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)",
            }}
          >
            {t.toggleLang}
          </button>
          {isKioskMode && onLogout && (
            <button
              onClick={onLogout}
              style={{
                padding: "5px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "Heebo, sans-serif",
                border: "1.5px solid #E24B4A", background: "#FCEBEB", color: "#A32D2D",
              }}
            >
              יציאה
            </button>
          )}
        </div>
      </div>

      {/* Stats bar — click to filter. auto-fit/minmax (not a fixed column count) so it
          reflows on tablet widths instead of clipping — also fixes the 6-status/5-column
          mismatch that left the 6th tile wrapping alone even on desktop. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}>
        {STATUSES.map(st => (
          <div
            key={st}
            onClick={() => setFilter(filter === st ? "הכל" : st)}
            style={{
              background: "var(--card-bg)",
              border:     "1px solid var(--border)",
              borderTop:  `3px solid ${STATUS_META[st].border}`,
              borderRadius: 10, padding: "10px 8px",
              textAlign: "center", cursor: "pointer",
              opacity: filter !== "הכל" && filter !== st ? 0.4 : 1,
              transition: "opacity 0.2s",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: STATUS_META[st].border, lineHeight: 1.2 }}>
              {countOf(st)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {t.statusLabels[st]}
            </div>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {["הכל", "הגעות היום", ...STATUSES].map(f => {
          const active = filter === f;
          const label  = f === "הכל"
            ? `${t.all} (${rooms.length})`
            : f === "הגעות היום"
            ? `${t.arrivalsToday} (${todayArrivalCount})`
            : `${t.statusLabels[f]} (${countOf(f)})`;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "7px 16px", borderRadius: 20, fontSize: 13,
                cursor: "pointer", fontFamily: "inherit",
                background: active ? "var(--gold)" : "var(--card-bg)",
                color:      active ? "#412402"     : (f === "הגעות היום" ? "#185FA5" : "var(--text-muted)"),
                fontWeight: active ? 700 : (f === "הגעות היום" ? 600 : 400),
                border: active
                  ? "none"
                  : (f === "הגעות היום" ? "1px solid #378ADD" : "1px solid var(--border)"),
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Floors & cards */}
      {SUITE_SECTIONS.map(sec => {
        const secRooms = filtered.filter(r => r.section === sec.label);
        if (!secRooms.length) return null;
        return (
          <div key={sec.label}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: "var(--text-muted)",
              margin: "20px 0 10px", borderBottom: "1px solid var(--border)", paddingBottom: 6,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span>{sec.icon}</span>
              <span>{sec.label}</span>
              <span style={{ fontSize: 11, opacity: 0.55, marginRight: "auto" }}>
                {secRooms.length} סוויטות
              </span>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 14,
            }}>
              {secRooms.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  lang={lang}
                  isUpdating={updating === room.id}
                  t={t}
                  onUpdate={updateStatus}
                  onCheckIn={handleCheckIn}
                  onReleaseGate={handleReleaseGate}
                  onCleanStart={handleCleanStart}
                  onCleanDone={handleCleanDoneRequest}
                  waState={notifyState[room.id] ?? null}
                  onRetryNotify={fireNotify}
                />
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
          {t.noRooms}
        </div>
      )}
    </div>
  );
}

// ── RoomCard — self-contained timer, 52px touch buttons ──────────────────
function RoomCard({ room, isUpdating, t, lang, onUpdate, onCheckIn, onReleaseGate, onCleanStart, onCleanDone, waState, onRetryNotify }) {
  const [hovered,  setHovered]  = useState(null);
  const [timerSec, setTimerSec] = useState(0);

  const meta    = STATUS_META[room.status] ?? STATUS_META["פנוי"];
  const actions = STATUS_ACTIONS[room.status] ?? [];
  const todayIL = israelTodayStr();

  function arrivalLabel(guest) {
    if (!guest || guest.status === "checked_in") return null;
    if (isArrivalTodayGuest(guest, todayIL) || isPreArrivalTodayGuest(guest, todayIL)) {
      return t.arrivalToday;
    }
    if (isArrivalTomorrowGuest(guest, todayIL)) return t.arrivalTomorrow;
    return t.arrivalUpcoming;
  }

  // Per-card cleaning timer — only runs when this room is being cleaned
  useEffect(() => {
    if (room.status !== "בניקיון" || !room.cleaningStartedAt) {
      setTimerSec(0);
      return;
    }
    const compute = () =>
      Math.max(0, Math.floor((Date.now() - new Date(room.cleaningStartedAt).getTime()) / 1000));
    setTimerSec(compute());
    const id = setInterval(() => setTimerSec(compute()), 1000);
    return () => clearInterval(id);
  }, [room.status, room.cleaningStartedAt]);

  function handleAction(action) {
    if (action.fn === "start_clean")   return onCleanStart(room.id);
    if (action.fn === "confirm_clean") return onCleanDone(room);
    if (action.fn === "check_in")      return onCheckIn(room);
    if (action.fn === "skip_check_in") return onCheckIn(room, { skipMessage: true });
    if (action.fn === "release_gate")  return onReleaseGate(room.id);
    onUpdate(room.id, action.next);
  }

  return (
    <div style={{
      background: "var(--card-bg)", borderRadius: 14,
      border: "1px solid var(--border)",
      borderRight: `4px solid ${meta.border}`,
      padding: "16px 14px", minHeight: 210,
      display: "flex", flexDirection: "column",
      opacity: isUpdating ? 0.5 : 1, transition: "opacity 0.15s",
    }}>
      {/* Room number + status badge */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: "var(--black)" }}>
          {room.id}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
          background: meta.bg, color: meta.text,
        }}>
          {t.statusLabels[room.status] ?? room.status}
        </span>
      </div>

      {/* Suite type */}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        {room.type}
      </div>

      {/* Body: guest / timer / last-clean badge */}
      <div style={{ flex: 1 }}>
        {room.guest ? (
          room.guest.status === "checked_in" && isGuestInStay(room.guest, todayIL) ? (
            <div style={{
              display: "inline-flex", flexDirection: "column", gap: 2,
              background: "#EAF3DE", border: "1px solid #639922", borderRadius: 8,
              padding: "6px 10px", marginBottom: 4,
            }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#3B6D11" }}>🟢 אורח נוכחי</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--black)" }}>👤 {room.guest.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                עזיבה: {fmtDate(room.guest.departure_date) ?? "?"}
              </span>
            </div>
          ) : (
            <div style={{
              display: "inline-flex", flexDirection: "column", gap: 2,
              background: isArrivalTodayGuest(room.guest, todayIL) ? "#FDF6DC" : "#E6F1FB",
              border: `1px solid ${isArrivalTodayGuest(room.guest, todayIL) ? "#E8AE0A" : "#378ADD"}`,
              borderRadius: 8,
              padding: "6px 10px", marginBottom: 4,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 800,
                color: isArrivalTodayGuest(room.guest, todayIL) ? "#8A6A00" : "#185FA5",
              }}>
                {arrivalLabel(room.guest)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--black)" }}>👤 {room.guest.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                צפי הגעה: {fmtDate(room.guest.arrival_date) ?? "?"}
              </span>
              {room.guest.spa_time && (
                <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700 }}>
                  💆 ספא {room.guest.spa_time}
                </span>
              )}
            </div>
          )
        ) : (
          <div style={{ fontSize: 11, color: "#ccc" }}>{t.awaitingArrival}</div>
        )}

        {room.status === "בניקיון" && (
          <div style={{
            marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6,
            background: "#E6F1FB", borderRadius: 8, padding: "5px 10px",
            fontSize: 14, fontWeight: 800, color: "#185FA5",
          }}>
            ⏱️ {fmtDuration(timerSec)}
          </div>
        )}

        {room.status === "פנוי" && room.lastDuration != null && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#639922", fontWeight: 600 }}>
            ✓ {t.cleanedIn(fmtDuration(room.lastDuration))}
          </div>
        )}

        {/* WA notification status indicator */}
        {waState === "sending" && (
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5,
            background: "#EEF5FD", border: "1px solid #BFDBFE", borderRadius: 7, padding: "4px 9px",
            fontSize: 11, fontWeight: 700, color: "#1e40af" }}>
            <div style={{ width: 10, height: 10, border: "2px solid #93c5fd", borderTop: "2px solid #1e40af",
              borderRadius: "50%", animation: "di-spin 0.8s linear infinite", flexShrink: 0 }} />
            שולח WhatsApp...
          </div>
        )}
        {waState === "sent" && (
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5,
            background: "#EAF3DE", border: "1px solid #86efac", borderRadius: 7, padding: "4px 9px",
            fontSize: 11, fontWeight: 700, color: "#15803d" }}>
            📱 ✓ הודעה נשלחה
          </div>
        )}
        {waState === "failed" && (
          <button
            onClick={() => onRetryNotify(room.id)}
            style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5,
              background: "#FCEBEB", border: "1px solid #E24B4A", borderRadius: 7, padding: "4px 9px",
              fontSize: 11, fontWeight: 700, color: "#A32D2D", cursor: "pointer",
              fontFamily: "Heebo, sans-serif" }}>
            🔄 שלח שוב
          </button>
        )}
      </div>

      {/* Action buttons — min 52px tall for touch */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {isUpdating ? (
          <div style={{ flex: 1, textAlign: "center", fontSize: 12, color: "var(--text-muted)", padding: "14px 0" }}>
            {t.updating}
          </div>
        ) : (
          actions.map(action => (
            <button
              key={action.next}
              onClick={() => handleAction(action)}
              onMouseEnter={() => setHovered(action.next)}
              onMouseLeave={() => setHovered(null)}
              style={{
                flex: 1, minHeight: 52, padding: "10px 6px", borderRadius: 10,
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                fontFamily: "Heebo, sans-serif", lineHeight: 1.3,
                border: action.primary ? "none" : "1.5px solid var(--border)",
                background: action.primary
                  ? (hovered === action.next ? "var(--gold-dark)" : "var(--gold)")
                  : (hovered === action.next ? "var(--ivory)"     : "var(--card-bg)"),
                color: action.primary ? "#412402" : "var(--black)",
                transition: "background 0.15s",
              }}
            >
              {t.actions[action.labelKey]}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
