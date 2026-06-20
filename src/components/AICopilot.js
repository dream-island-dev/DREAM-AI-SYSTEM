// src/components/AICopilot.js
// Floating realtime widget: detects suites in "ממתין לאישור" status,
// lets the manager approve → sends personalised WhatsApp + marks suite ready.

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

export default function AICopilot({ user }) {
  const [alerts,     setAlerts]     = useState([]);
  const [isOpen,     setIsOpen]     = useState(false);
  const [processing, setProcessing] = useState(null);
  const [toast,      setToast]      = useState(null);

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
          } else {
            // Status moved away — remove alert
            setAlerts(prev => prev.filter(a => a.room_id !== row.room_id));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [loadPending, enrichRoom]);

  // Approve: send WA, mark suite ready, mark guest checked_in
  async function handleApprove(alert) {
    if (!supabase) return;
    setProcessing(alert._alertId);
    try {
      const { guest } = alert;
      const spaLine = guest?.treatment_time
        ? `${guest.treatment_type ?? "טיפול ספא"} בשעה ${guest.treatment_time}.\n`
        : "";
      const message =
        `🏨 סוויטת ${alert.room_id} מוכנה ומחכה לכם!\n\n` +
        spaLine +
        `ברוכים הבאים לחוויה שלא תשכחו! 🌴\n` +
        `הצוות שלנו כאן לכל בקשה.`;

      // Never fail silently: a swallowed WhatsApp error must not let the room/guest
      // state advance as if the guest was actually notified.
      if (guest?.phone) {
        const { error: waError } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "inbox_reply", phone: guest.phone, message },
        });
        if (waError) {
          throw new Error(`שליחת WhatsApp נכשלה (${waError.message}) — הסטטוס לא עודכן, אפשר לנסות שוב`);
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

  if (!isSupabaseConfigured) return null;

  const hasPending = alerts.length > 0;

  return (
    <div style={{
      position: "fixed",
      bottom: "24px",
      left:   "24px",
      zIndex: 1100,
      direction: "rtl",
    }}>
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
            }}>
              <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--black, #1A1A1A)", marginBottom: "4px" }}>
                🏨 {alert.room_id}
              </div>

              {alert.guest ? (
                <>
                  <div style={{ fontSize: "14px", color: "#555", marginBottom: "2px" }}>
                    {alert.guest.name ?? "—"}
                  </div>
                  {alert.guest.treatment_time && (
                    <div style={{ fontSize: "13px", color: "#A8843A", marginBottom: "10px" }}>
                      🧖 {alert.guest.treatment_type ?? "ספא"} · {alert.guest.treatment_time}
                    </div>
                  )}
                  {!alert.guest.treatment_time && (
                    <div style={{ height: "10px" }} />
                  )}
                </>
              ) : (
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

      {/* Floating bell button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          width:        "56px",
          height:       "56px",
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
