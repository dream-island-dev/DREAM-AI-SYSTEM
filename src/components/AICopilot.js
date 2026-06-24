// src/components/AICopilot.js
// Floating realtime widget: detects suites in "ממתין לאישור" status,
// lets the manager approve → sends personalised WhatsApp + marks suite ready.

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const FAB = 56;                  // bell diameter (px) — used for drag clamping
const POS_KEY = "aiCopilotPos";  // localStorage key for the dragged position ({ left, bottom })

export default function AICopilot({ user }) {
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
        setPos(saved);
      }
    } catch { /* ignore malformed storage */ }
  }, []);
  const drag = useRef({ dragging: false, moved: false, startX: 0, startY: 0 });

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // Enrich a room_status row with its matching guest record
  const enrichRoom = useCallback(async (roomRow) => {
    if (!supabase) return { ...roomRow, guest: null, _alertId: crypto.randomUUID() };
    const today = new Date().toISOString().slice(0, 10);
    const { data: guest } = await supabase
      .from("guests")
      .select("id, name, phone, treatment_time, treatment_type, suite_name, status")
      .eq("suite_name", roomRow.room_id)
      .gte("arrival_date", today)
      .neq("status", "checked_out")
      .order("arrival_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    return { ...roomRow, guest: guest ?? null, _alertId: crypto.randomUUID() };
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
      setAlerts(enriched);
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
        { event: "UPDATE", schema: "public", table: "room_status" },
        async (payload) => {
          const row = payload.new;
          if (row.status === "ממתין לאישור") {
            const enriched = await enrichRoom(row);
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

  // Approve: send the dedicated dream_room_ready WA template, mark suite
  // ready, mark guest checked_in.
  //
  // Sprint 5.1/5.3 — previously composed free text and sent it via the
  // inbox_reply trigger, which only works inside the guest's open 24h
  // session window. Approving a room can legitimately happen hours after
  // the guest's last message, so that path could fail right when it
  // mattered most. Routing through trigger:"room_ready" instead uses the
  // dedicated dream_room_ready Meta template (works outside the 24h window)
  // and goes through whatsapp-send's idempotent BRANCH D — no risk of
  // double-sending, and isolated from the scheduled morning_* templates.
  async function handleApprove(alert) {
    if (!supabase) return;
    setProcessing(alert._alertId);
    try {
      const { guest } = alert;

      // Never fail silently: a swallowed WhatsApp error must not let the room/guest
      // state advance as if the guest was actually notified.
      if (guest?.id) {
        const { data, error: waError } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "room_ready", guestId: guest.id },
        });
        if (waError) {
          throw new Error(`שליחת WhatsApp נכשלה (${waError.message}) — הסטטוס לא עודכן, אפשר לנסות שוב`);
        }
        if (data?.ok === false) {
          throw new Error(`שליחת WhatsApp נכשלה (${data.error ?? "שגיאה לא ידועה"}) — הסטטוס לא עודכן, אפשר לנסות שוב`);
        }
      }

      // Mark suite ready
      const { error: roomErr } = await supabase.from("room_status").upsert(
        { room_id: alert.room_id, status: "פנוי", updated_at: new Date().toISOString() },
        { onConflict: "room_id" }
      );
      if (roomErr) throw new Error("עדכון סטטוס חדר נכשל: " + roomErr.message);

      // Mark guest checked_in
      if (guest?.id) {
        const { error: guestErr } = await supabase
          .from("guests").update({ status: "checked_in" }).eq("id", guest.id);
        if (guestErr) throw new Error("עדכון סטטוס אורח נכשל: " + guestErr.message);
      }

      setAlerts(prev => prev.filter(a => a._alertId !== alert._alertId));
      showToast(`✓ ${alert.room_id} — אושר, הודעה נשלחה`);
    } catch (e) {
      // Keep the alert in the list (don't dismiss) so the manager can retry.
      showToast((e)?.message ?? "שגיאה לא ידועה", "err");
    } finally {
      setProcessing(null);
    }
  }

  function handleDismiss(alertId) {
    setAlerts(prev => prev.filter(a => a._alertId !== alertId));
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
    const left   = Math.max(8, Math.min(window.innerWidth - FAB - 8, e.clientX - FAB / 2));
    const bottom = Math.max(8, Math.min(window.innerHeight - FAB - 8, window.innerHeight - e.clientY - FAB / 2));
    setPos({ left, bottom });
  };
  const onPointerUp = () => {
    const d = drag.current;
    d.dragging = false;
    if (d.moved) {
      setPos((cur) => {
        if (cur) { try { localStorage.setItem(POS_KEY, JSON.stringify(cur)); } catch { /* ignore */ } }
        return cur;
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

  // Default anchor: bottom:24/left:24 (unchanged). A dragged position overrides it.
  const anchor = pos
    ? { left: `${pos.left}px`, bottom: `${pos.bottom}px` }
    : { left: "24px", bottom: "24px" };

  return (
    <div style={{
      position: "fixed",
      ...anchor,
      zIndex: 1100,
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

              {alert.guest?.treatment_time && (
                <div style={{ fontSize: "13px", color: "#A8843A", marginBottom: "10px" }}>
                  🧖 {alert.guest.treatment_type ?? "ספא"} · {alert.guest.treatment_time}
                </div>
              )}
              {!alert.guest && (
                <div style={{ fontSize: "13px", color: "#888", marginBottom: "10px" }}>
                  לא נמצא אורח משויך לסוויטה זו
                </div>
              )}

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => handleApprove(alert)}
                  disabled={processing === alert._alertId}
                  style={{
                    flex:       1,
                    background: processing === alert._alertId ? "#ccc" : "var(--gold, #C9A96E)",
                    color:      "#fff",
                    border:     "none",
                    borderRadius: "8px",
                    padding:    "8px 0",
                    fontWeight: 700,
                    fontSize:   "13px",
                    cursor:     processing === alert._alertId ? "default" : "pointer",
                    fontFamily: "inherit",
                    transition: "background 0.15s",
                  }}
                >
                  {processing === alert._alertId ? "שולח..." : "✓ אשר ושלח הודעה"}
                </button>
                <button
                  onClick={() => handleDismiss(alert._alertId)}
                  disabled={processing === alert._alertId}
                  style={{
                    background:   "none",
                    border:       "1px solid var(--border, #E0D5C5)",
                    borderRadius: "8px",
                    padding:      "8px 12px",
                    fontSize:     "13px",
                    cursor:       "pointer",
                    color:        "#888",
                    fontFamily:   "inherit",
                  }}
                >התעלם</button>
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
