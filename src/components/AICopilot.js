// src/components/AICopilot.js
// Floating realtime widget: detects suites in "ממתין לאישור" status,
// lets the manager approve → sends personalised WhatsApp + marks suite ready.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { israelTodayStr, isArrivalToday } from "../utils/guestTiming";
import QuietHoursGate from "./QuietHoursGate";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";
import {
  markGuestRoomReadyAfterNotify,
  skipApprovalAndCheckIn,
  releaseApprovalGateOnly,
} from "../utils/suiteCheckinSync";
import { guestRoomMatchesSuiteId } from "../data/suiteRegistry";

const FAB = 56;                  // bell diameter (px) — used for drag clamping
const MARGIN = 8;                // min inset from viewport edges while dragging
const POS_KEY = "aiCopilotPos";  // localStorage key for the dragged position ({ left, bottom })
const Z_INDEX = 10400;           // above sidebar/mobile chrome; below modal overlays (~9999+)

function clampPos(p) {
  const maxLeft = window.innerWidth - FAB - MARGIN;
  const maxBottom = window.innerHeight - FAB - MARGIN;
  return {
    left: Math.max(MARGIN, Math.min(maxLeft, p.left)),
    bottom: Math.max(MARGIN, Math.min(maxBottom, p.bottom)),
  };
}

function isPosInBounds(p) {
  if (!p || typeof p.left !== "number" || typeof p.bottom !== "number") return false;
  const maxLeft = window.innerWidth - FAB - MARGIN;
  const maxBottom = window.innerHeight - FAB - MARGIN;
  return p.left >= MARGIN && p.left <= maxLeft && p.bottom >= MARGIN && p.bottom <= maxBottom;
}

function clearSavedPos() {
  try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ }
}

export default function AICopilot({ user }) {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const [alerts,     setAlerts]     = useState([]);
  const [isOpen,     setIsOpen]     = useState(false);
  const [processing, setProcessing] = useState(null);
  const [toast,      setToast]      = useState(null);
  const [newAlertId, setNewAlertId] = useState(null); // flashes the bell + that card briefly

  // ── Draggable position (Sprint 5.3) — same pointer-events pattern as
  // RequestsAlertWidget.js, mirrored for a left-anchored widget. Persists to
  // localStorage so managers can move the bell clear of any touch target.
  const [pos, setPos] = useState(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (saved && typeof saved.left === "number" && typeof saved.bottom === "number") {
        if (isPosInBounds(saved)) {
          setPos(saved);
        } else {
          clearSavedPos();
        }
      }
    } catch {
      clearSavedPos();
    }
  }, []);
  const drag = useRef({ dragging: false, moved: false, startX: 0, startY: 0 });

  // Default placement only — clears App.js's mobile-bar (.mobile-bar, shown
  // <=768px, ~70px tall incl. padding) so the bell doesn't sit on top of the
  // bottom nav on a phone/narrow tablet. A user-dragged `pos` is left exactly
  // as they placed it — they already moved it clear of whatever mattered to them.
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 768
  );
  useEffect(() => {
    const onResize = () => {
      setIsNarrowViewport(window.innerWidth <= 768);
      setPos((cur) => {
        if (!cur) return null;
        if (isPosInBounds(cur)) return cur;
        clearSavedPos();
        return null;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // Enrich a room_status row with its matching guest record.
  const enrichRoom = useCallback(async (roomRow) => {
    const _alertId = crypto.randomUUID();
    if (!supabase) return { ...roomRow, guest: null, isEligible: false, alreadyNotified: false, _alertId };

    const todayIL = israelTodayStr();
    const { data: guestRows } = await supabase
      .from("guests")
      .select("id, name, phone, spa_time, room, suite_name, status, arrival_date, departure_date, room_ready_notified, msg_room_ready_sent")
      .eq("arrival_date", todayIL)
      .neq("status", "cancelled")
      .in("status", ["pending", "expected", "room_ready"])
      .order("arrival_date", { ascending: false })
      .limit(40);

    const guest =
      (guestRows ?? []).find((g) => guestRoomMatchesSuiteId(g, roomRow.room_id)) ?? null;

    const isEligible = isArrivalToday(guest?.arrival_date);

    let alreadyNotified = false;
    if (guest?.id) {
      const { data: suiteRows } = await supabase
        .from("suite_rooms")
        .select("room_display, room_name, suite_type, room_ready_notified, msg_room_ready_sent")
        .eq("guest_id", guest.id);
      const match = (suiteRows ?? []).find((sr) =>
        guestRoomMatchesSuiteId(
          { room: sr.room_display ?? sr.room_name, suite_name: sr.suite_type },
          roomRow.room_id,
        ),
      );
      if (match) {
        alreadyNotified = !!(match.room_ready_notified || match.msg_room_ready_sent);
      } else if (!(suiteRows ?? []).length) {
        alreadyNotified = !!(guest.room_ready_notified || guest.msg_room_ready_sent);
      }
    }

    // Stale gate — room_ready already sent for this suite from SuitesDashboard / prior approve.
    if (alreadyNotified) {
      await supabase
        .from("room_status")
        .update({ status: "פנוי", updated_at: new Date().toISOString() })
        .eq("room_id", roomRow.room_id)
        .eq("status", "ממתין לאישור");
    }

    return { ...roomRow, guest: guest ?? null, isEligible, alreadyNotified, _alertId };
  }, []);

  // Initial load of any already-pending suites
  const loadPending = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { data } = await supabase
      .from("room_status")
      .select("room_id, status, updated_at")
      .eq("status", "ממתין לאישור");
    if (data?.length) {
      const enriched = await Promise.all(data.map(enrichRoom));
      setAlerts(enriched.filter((a) => !a.alreadyNotified));
    }
  }, [enrichRoom]);

  // Realtime subscription
  useEffect(() => {
    loadPending();
    if (!isSupabaseConfigured || !supabase) return;

    const ch = supabase
      .channel("ai_copilot_room_watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_status" },
        async (payload) => {
          const row = payload.new;
          if (row.status === "ממתין לאישור") {
            const enriched = await enrichRoom(row);
            if (enriched.alreadyNotified) return;
            setAlerts(prev => {
              if (prev.some(a => a.room_id === row.room_id)) return prev;
              return [...prev, enriched];
            });
            setIsOpen(true); // auto-open on new alert
            setNewAlertId(enriched._alertId);
            setTimeout(() => setNewAlertId(id => (id === enriched._alertId ? null : id)), 4000);
          } else {
            // Status moved away — remove alert
            setAlerts(prev => prev.filter(a => a.room_id !== row.room_id));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [loadPending, enrichRoom]);

  // Approve: send dream_room_ready WA → guest room_ready + room פנוי (not checked_in).
  async function handleApprove(alert) {
    if (!supabase) return;
    const { guest } = alert;

    if (!isArrivalToday(guest?.arrival_date)) {
      showToast(
        guest?.arrival_date
          ? `לא ניתן לשלוח — הגעת האורח ב-${guest.arrival_date} (היום: ${israelTodayStr()})`
          : `לא ניתן לשלוח — אין אורח עם הגעה היום לסוויטה ${alert.room_id}`,
        "err"
      );
      return;
    }

    setProcessing(alert._alertId);
    try {
      // Never fail silently: a swallowed WhatsApp error must not let the room/guest
      // state advance as if the guest was actually notified. Same principle applies
      // when NO guest was matched at all (enrichRoom found nothing for this suite) —
      // that must not look identical to "message sent" in the success toast below.
      // Anti-duplication transparency (session 125 P2-F): a skipped/duplicate
      // send must never read as a fresh "הודעה נשלחה" in the final toast.
      let waSkipNote = null;
      if (guest?.id) {
        if (!ensureCanSend()) {
          throw new Error("שליחה חסומה בשעות שקט — סמן את האישור למטה");
        }
        const { data, error: waError } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "room_ready", guestId: guest.id, roomId: alert.room_id },
        });
        if (waError) {
          throw new Error(`שליחת WhatsApp נכשלה (${waError.message}) — הסטטוס לא עודכן, אפשר לנסות שוב`);
        }
        if (data?.ok === false) {
          throw new Error(`שליחת WhatsApp נכשלה (${data.error ?? "שגיאה לא ידועה"}) — הסטטוס לא עודכן, אפשר לנסות שוב`);
        }
        if (data?.skipped && data?.reason === "room_ready_notified") {
          waSkipNote = "ההודעה כבר נשלחה קודם";
        } else if (data?.skipped && data?.status === "duplicate_blocked") {
          waSkipNote = "נחסם כפול — ההודעה כבר נשלחה לאורח בעבר";
        } else if (data?.skipped) {
          waSkipNote = `השליחה דולגה (${data.reason ?? "ללא סיבה"})`;
        }
      }

      // whatsapp-send clears ממתין לאישור → פנוי; mark guest room_ready (not checked_in).
      if (guest?.id) {
        const readyResult = await markGuestRoomReadyAfterNotify(supabase, guest.id);
        if (!readyResult.ok) throw new Error("עדכון סטטוס אורח נכשל: " + readyResult.error);
      } else {
        const { error: roomErr } = await supabase.from("room_status").upsert(
          { room_id: alert.room_id, status: "פנוי", updated_at: new Date().toISOString() },
          { onConflict: "room_id" },
        );
        if (roomErr) throw new Error("עדכון סטטוס חדר נכשל: " + roomErr.message);
      }

      setAlerts(prev => prev.filter(a => a._alertId !== alert._alertId));
      showToast(
        guest?.id
          ? (waSkipNote
              ? `ℹ ${alert.room_id} — ${waSkipNote}; חדר מוכן (ממתין לצ'ק-אין)`
              : `✓ ${alert.room_id} — הודעה נשלחה, חדר מוכן (ממתין לצ'ק-אין)`)
          : `⚠ ${alert.room_id} — שער נסגר, לא נמצא אורח משויך`,
        guest?.id ? "ok" : "err"
      );
    } catch (e) {
      // Keep the alert in the list (don't dismiss) so the manager can retry.
      showToast((e)?.message ?? "שגיאה לא ידועה", "err");
    } finally {
      setProcessing(null);
    }
  }

  async function handleSkipCheckIn(alert) {
    if (!supabase) return;
    if (!alert.guest?.id) {
      showToast(`אין אורח משויך לסוויטה ${alert.room_id} — לא ניתן לבצע צ'ק-אין`, "err");
      return;
    }
    setProcessing(alert._alertId);
    try {
      const result = await skipApprovalAndCheckIn(supabase, alert.guest, alert.room_id);
      if (!result.ok) throw new Error(result.error);
      setAlerts(prev => prev.filter(a => a._alertId !== alert._alertId));
      showToast(`✓ ${alert.room_id} — צ'ק-אין בלי הודעה (מסונכרן)`, "ok");
    } catch (e) {
      showToast((e)?.message ?? "שגיאה לא ידועה", "err");
    } finally {
      setProcessing(null);
    }
  }

  async function handleReleaseGate(alert) {
    if (!supabase) return;
    setProcessing(alert._alertId);
    try {
      const result = await releaseApprovalGateOnly(supabase, alert.room_id);
      if (!result.ok) throw new Error(result.error);
      setAlerts(prev => prev.filter(a => a._alertId !== alert._alertId));
      showToast(`✓ ${alert.room_id} — שער אישור נסגר (ללא צ'ק-אין)`, "ok");
    } catch (e) {
      showToast((e)?.message ?? "שגיאה לא ידועה", "err");
    } finally {
      setProcessing(null);
    }
  }

  // ── Drag handlers (pointer events — touch + mouse, no library) — same
  // tap-vs-drag disambiguation (6px threshold) as RequestsAlertWidget.js.
  const onPointerDown = (e) => {
    drag.current = { dragging: true, moved: false, startX: e.clientX, startY: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d.dragging) return;
    if (!d.moved && (Math.abs(e.clientX - d.startX) > 6 || Math.abs(e.clientY - d.startY) > 6)) {
      d.moved = true;
    }
    if (!d.moved) return;
    setPos(clampPos({
      left: e.clientX - FAB / 2,
      bottom: window.innerHeight - e.clientY - FAB / 2,
    }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    d.dragging = false;
    if (d.moved) {
      setPos((cur) => {
        if (!cur) return cur;
        const clamped = clampPos(cur);
        try { localStorage.setItem(POS_KEY, JSON.stringify(clamped)); } catch { /* ignore */ }
        return clamped;
      });
    }
  };
  const handleBellClick = () => {
    if (drag.current.moved) { drag.current.moved = false; return; }
    setIsOpen(o => !o);
  };

  if (!isSupabaseConfigured) return null;

  const hasPending = alerts.length > 0;
  const hasNewAlert = newAlertId != null;

  // Default anchor: bottom:24/left:24, bumped to bottom:88px under the mobile
  // bottom-nav breakpoint so it doesn't overlap App.js's .mobile-bar. A dragged
  // position always overrides it, at any viewport width.
  const anchor = pos
    ? { left: `${pos.left}px`, bottom: `${pos.bottom}px` }
    : { left: "24px", bottom: isNarrowViewport ? "88px" : "24px" };

  return (
    <div style={{
      position: "fixed",
      ...anchor,
      zIndex: Z_INDEX,
      direction: "rtl",
      touchAction: "none",
    }}>
      <style>{`
        @keyframes ai-copilot-flash {
          0%, 100% { box-shadow: 0 0 0 0 rgba(226,75,74,0); }
          50%       { box-shadow: 0 0 0 8px rgba(226,75,74,0.35); }
        }
      `}</style>
      {/* Toast */}
      {toast && (
        <div style={{
          position:   "absolute",
          bottom:     "72px",
          left:       0,
          right:      0,
          background: toast.type === "err" ? "#FCEBEB" : "#EAF3DE",
          border:     `1px solid ${toast.type === "err" ? "#E24B4A" : "#639922"}`,
          color:      toast.type === "err" ? "#A32D2D" : "#3B6D11",
          borderRadius: "8px",
          padding:    "10px 14px",
          fontSize:   "13px",
          fontWeight: 500,
          whiteSpace: "nowrap",
          boxShadow:  "0 4px 16px rgba(0,0,0,0.12)",
        }}>{toast.msg}</div>
      )}

      {/* Alert panel */}
      {isOpen && hasPending && (
        <div style={{
          background:    "var(--card-bg, #fff)",
          border:        "1px solid var(--border, #E0D5C5)",
          borderRadius:  "12px",
          boxShadow:     "0 8px 32px rgba(0,0,0,0.18)",
          width:         "320px",
          maxHeight:     "480px",
          overflowY:     "auto",
          marginBottom:  "12px",
        }}>
          {/* Header */}
          <div style={{
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            padding:        "14px 16px 10px",
            borderBottom:   "1px solid #E8C98A",
            background:     "#FDF6DC",
            borderRadius:   "12px 12px 0 0",
          }}>
            <span style={{ fontWeight: 700, fontSize: "15px", color: "#8A6A00" }}>
              🔔 ממתין לאישורך
            </span>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "#8A6A00", lineHeight: 1 }}
            >✕</button>
          </div>

          {quietActive && (
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border, #E0D5C5)" }}>
              <QuietHoursGate
                active={quietActive}
                checked={overrideChecked}
                onChange={setOverrideChecked}
                compact
              />
            </div>
          )}

          {/* Alert cards */}
          {alerts.map(alert => (
            <div key={alert._alertId} style={{
              borderBottom: "1px solid var(--border, #E0D5C5)",
              padding:      "14px 16px",
              borderRadius: alert._alertId === newAlertId ? "8px" : 0,
              animation:    alert._alertId === newAlertId ? "ai-copilot-flash 0.9s ease-in-out 3" : "none",
            }}>
              <div style={{ fontWeight: 700, fontSize: "15px", color: "var(--black, #1A1A1A)", marginBottom: "8px", lineHeight: 1.5 }}>
                🏨 סוויטה {alert.room_id} מוכנה עבור {alert.guest?.name ?? "אורח לא ידוע"} — לחץ לאישור שליחת הודעה
              </div>

              {alert.guest?.spa_time && (
                <div style={{ fontSize: "13px", color: "#A8843A", marginBottom: "10px" }}>
                  🧖 ספא · {alert.guest.spa_time}
                </div>
              )}
              {!alert.guest && (
                <div style={{ fontSize: "13px", color: "#888", marginBottom: "10px" }}>
                  לא נמצא אורח משויך לסוויטה זו
                </div>
              )}
              {alert.guest && !alert.isEligible && (
                <div style={{ fontSize: "13px", color: "#A8843A", marginBottom: "10px" }}>
                  ⚠ הגעת האורח ב-{alert.guest.arrival_date} (לא היום) — שליחת הודעה תיחסם
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => handleApprove(alert)}
                    disabled={
                      processing === alert._alertId
                      || (alert.guest?.id && !canSend)
                      || (alert.guest && !alert.isEligible)
                    }
                    title={
                      alert.guest && !alert.isEligible
                        ? `הגעה ב-${alert.guest.arrival_date}, לא היום`
                        : alert.guest?.id && !canSend
                          ? "שליחה חסומה בשעות שקט"
                          : undefined
                    }
                    style={{
                      flex:       1,
                      background: processing === alert._alertId || (alert.guest?.id && !canSend) || (alert.guest && !alert.isEligible) ? "#ccc" : "var(--gold, #C9A96E)",
                      color:      "#fff",
                      border:     "none",
                      borderRadius: "8px",
                      padding:    "8px 0",
                      fontWeight: 700,
                      fontSize:   "13px",
                      cursor:     processing === alert._alertId || (alert.guest?.id && !canSend) || (alert.guest && !alert.isEligible) ? "default" : "pointer",
                      fontFamily: "inherit",
                      transition: "background 0.15s",
                    }}
                  >
                    {processing === alert._alertId ? "שולח..." : "✓ אשר ושלח הודעה"}
                  </button>
                  <button
                    onClick={() => handleSkipCheckIn(alert)}
                    disabled={processing === alert._alertId || !alert.guest?.id}
                    title={!alert.guest?.id ? "אין אורח משויך" : undefined}
                    style={{
                      flex:       1,
                      background: processing === alert._alertId || !alert.guest?.id ? "#eee" : "#EEF4FF",
                      color:      processing === alert._alertId || !alert.guest?.id ? "#aaa" : "#2952A3",
                      border:     "1px solid #BFDBFE",
                      borderRadius: "8px",
                      padding:    "8px 0",
                      fontWeight: 700,
                      fontSize:   "13px",
                      cursor:     processing === alert._alertId || !alert.guest?.id ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    צ'ק-אין בלי הודעה
                  </button>
                </div>
                <button
                  onClick={() => handleReleaseGate(alert)}
                  disabled={processing === alert._alertId}
                  style={{
                    width:        "100%",
                    background:   "none",
                    border:       "1px solid var(--border, #E0D5C5)",
                    borderRadius: "8px",
                    padding:      "7px 12px",
                    fontSize:     "12px",
                    cursor:       processing === alert._alertId ? "default" : "pointer",
                    color:        "#888",
                    fontFamily:   "inherit",
                  }}
                >סגור שער בלבד (ללא צ'ק-אין)</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Floating bell button — drag to move, tap to toggle the panel */}
      <button
        onClick={handleBellClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="אישורי חדרים (אפשר לגרור)"
        style={{
          width:        `${FAB}px`,
          height:       `${FAB}px`,
          borderRadius: "50%",
          background:   hasPending ? "var(--gold, #C9A96E)" : "#E0D5C5",
          border:       "none",
          cursor:       "pointer",
          fontSize:     "24px",
          boxShadow:    hasPending
            ? "0 4px 20px rgba(201,169,110,0.55)"
            : "0 2px 8px rgba(0,0,0,0.12)",
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          position:       "relative",
          transition:     "all 0.2s ease",
          touchAction:    "none",
          animation:      hasNewAlert ? "ai-copilot-flash 0.9s ease-in-out infinite" : "none",
        }}
      >
        🔔
        {hasPending && (
          <span style={{
            position:       "absolute",
            top:            "4px",
            right:          "4px",
            background:     "#E24B4A",
            color:          "#fff",
            borderRadius:   "50%",
            width:          "18px",
            height:         "18px",
            fontSize:       "11px",
            fontWeight:     700,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            lineHeight:     1,
          }}>{alerts.length}</span>
        )}
      </button>
    </div>
  );
}
