// src/components/RequestsAlertWidget.js
// Floating realtime widget for guest_alerts — same Realtime pattern as
// AICopilot.js (room_status watcher), but for the Requests Board: staff
// gets a badge + toast the instant a guest request lands, from any page,
// without needing to be on the Requests Board or refresh anything.
// Resolving happens on the Requests Board itself (with the resolution-note
// modal) — this widget only alerts + navigates there, no inline actions.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

export default function RequestsAlertWidget({ onNavigate }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const loadCount = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { count } = await supabase
      .from("guest_alerts")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false);
    setPendingCount(count ?? 0);
  }, []);

  useEffect(() => {
    loadCount();
    if (!isSupabaseConfigured || !supabase) return;

    const ch = supabase
      .channel("requests_board_watch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "guest_alerts" },
        (payload) => {
          const row = payload.new;
          setPendingCount((prev) => prev + 1);
          const typeLabel = row.alert_type === "complaint" ? "🔴 תקלה" : "📝 בקשה";
          showToast(`${typeLabel} חדשה: ${String(row.message ?? "").slice(0, 60)}`);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guest_alerts" },
        (payload) => {
          // Only decrement on the false→true transition — avoids drifting the
          // count if a row is updated for an unrelated reason while still open.
          if (payload.new.resolved === true && payload.old.resolved === false) {
            setPendingCount((prev) => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [loadCount]);

  if (!isSupabaseConfigured) return null;

  const hasPending = pendingCount > 0;

  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 1100, direction: "rtl" }}>
      {toast && (
        <div
          onClick={() => onNavigate?.("requests_board")}
          style={{
            position: "absolute", bottom: "72px", right: 0, minWidth: "240px", maxWidth: "320px",
            background: "#FFF5E8", border: "1px solid #F5A623", color: "#7A4A00",
            borderRadius: "10px", padding: "12px 16px", fontSize: "13px", fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)", cursor: "pointer",
          }}
        >
          {toast}
        </div>
      )}
      <button
        onClick={() => onNavigate?.("requests_board")}
        title="לוח בקשות"
        style={{
          width: "56px", height: "56px", borderRadius: "50%",
          background: hasPending ? "var(--gold, #C9A96E)" : "#E0D5C5",
          border: "none", cursor: "pointer", fontSize: "24px",
          boxShadow: hasPending ? "0 4px 20px rgba(201,169,110,0.55)" : "0 2px 8px rgba(0,0,0,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", transition: "all 0.2s ease",
        }}
      >
        📋
        {hasPending && (
          <span style={{
            position: "absolute", top: "4px", right: "4px",
            background: "#E24B4A", color: "#fff", borderRadius: "50%",
            width: "18px", height: "18px", fontSize: "11px", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}>{pendingCount}</span>
        )}
      </button>
    </div>
  );
}
