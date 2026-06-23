// src/components/AiFailoverWidget.js
// Floating realtime alert for ai_failover_events — same Realtime-subscription
// mechanic as RequestsAlertWidget.js (postgres_changes on INSERT), but a
// different shape: a failover is a one-off auto-recovery EVENT, not a queue
// of unresolved work, so this is a transient top-center banner that
// auto-dismisses, not a persistent badge+button. Positioned top-center so it
// doesn't collide with AICopilot (bottom-left) or RequestsAlertWidget
// (bottom-right).
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const ENGINE_LABEL = { claude: "Claude", gemini: "Gemini" };

export default function AiFailoverWidget() {
  const [alert, setAlert] = useState(null);

  const dismiss = useCallback(() => setAlert(null), []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const ch = supabase
      .channel("ai_failover_watch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ai_failover_events" },
        (payload) => {
          const row = payload.new;
          setAlert(row);
          setTimeout(() => setAlert((cur) => (cur === row ? null : cur)), 10000);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, []);

  if (!isSupabaseConfigured || !alert) return null;

  const fromLabel = ENGINE_LABEL[alert.from_engine] ?? alert.from_engine;
  const toLabel   = ENGINE_LABEL[alert.to_engine]   ?? alert.to_engine;

  return (
    <div style={{
      position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
      zIndex: 1200, direction: "rtl", maxWidth: "92vw",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        background: "#FFF0EE", border: "1px solid #C0392B", color: "#7A1F1F",
        borderRadius: 12, padding: "10px 16px", fontSize: 13, fontWeight: 700,
        boxShadow: "0 6px 24px rgba(192,57,43,0.25)",
      }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <span>
          {fromLabel} הגיע למגבלה — עבר אוטומטית ל-{toLabel}.
          {alert.guest_phone ? ` (אורח: ${alert.guest_phone})` : ""}
        </span>
        <button
          onClick={dismiss}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#7A1F1F", fontSize: 16, fontWeight: 800 }}
        >✕</button>
      </div>
    </div>
  );
}
