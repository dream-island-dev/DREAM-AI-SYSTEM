// Kitchen Display Screen — /kds/:token (no login). Phase 2C.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const POLL_MS = 4000;

function playNewOrderChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    /* ignore */
  }
}

const STATUS_BTN = {
  submitted: { next: "in_kitchen", label: "▶ התחלתי", color: "#3B82F6" },
  in_kitchen: { next: "ready", label: "✓ מוכן", color: "#10B981" },
  ready: { next: "served", label: "נמסר", color: "#6B7280" },
};

export default function KitchenDisplayScreen({ token }) {
  const [label, setLabel] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);
  const knownIdsRef = useRef(new Set());
  const initialLoadRef = useRef(true);

  const fetchOrders = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !token) {
      setError("חיבור לא זמין");
      setLoading(false);
      return;
    }
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("restaurant-kds-data", {
        body: { token },
      });
      if (fnErr || !data?.ok) {
        setError(data?.error === "link_not_found" ? "קישור לא תקין" : (data?.error ?? fnErr?.message));
        setOrders([]);
      } else {
        setError(null);
        setLabel(data.label ?? "מסך מטבח");
        const incoming = data.orders ?? [];

        if (!initialLoadRef.current && !muted) {
          for (const o of incoming) {
            if (o.status === "submitted" && !knownIdsRef.current.has(o.id)) {
              playNewOrderChime();
              break;
            }
          }
        }

        knownIdsRef.current = new Set(incoming.map((o) => o.id));
        initialLoadRef.current = false;
        setOrders(incoming);
      }
    } catch (e) {
      setError(e?.message ?? "שגיאה");
    } finally {
      setLoading(false);
    }
  }, [token, muted]);

  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, POLL_MS);
    return () => clearInterval(t);
  }, [fetchOrders]);

  const updateStatus = async (orderId, status) => {
    if (!supabase) return;
    const { data, error: fnErr } = await supabase.functions.invoke("restaurant-order-status", {
      body: { token, order_id: orderId, status },
    });
    if (fnErr || !data?.ok) return;
    fetchOrders();
  };

  if (loading) {
    return (
      <div style={shellStyle}>
        <div style={{ color: "#94A3B8", textAlign: "center", paddingTop: 80 }}>טוען מסך מטבח…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={shellStyle}>
        <div style={{ color: "#FCA5A5", textAlign: "center", paddingTop: 80, fontSize: 18 }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 20px", borderBottom: "1px solid #334155",
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#F8FAFC" }}>🍳 {label}</div>
          <div style={{ fontSize: 13, color: "#94A3B8", marginTop: 4 }}>
            {orders.length} הזמנות פתוחות · מתעדכן כל {POLL_MS / 1000} שניות
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "1px solid #475569",
            background: muted ? "#7F1D1D" : "#1E293B", color: "#F8FAFC",
            fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif",
          }}
        >
          {muted ? "🔇 מושתק" : "🔔 צליל פעיל"}
        </button>
      </header>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 14, padding: 16,
      }}>
        {orders.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "#64748B", padding: 48 }}>
            אין הזמנות פתוחות — מחכים להזמנה חדשה
          </div>
        ) : orders.map((o) => {
          const btn = STATUS_BTN[o.status];
          const isNew = o.status === "submitted";
          return (
            <div
              key={o.id}
              style={{
                borderRadius: 12, padding: "14px 16px",
                background: isNew ? "#422006" : "#1E293B",
                border: isNew ? "2px solid #F59E0B" : "1px solid #334155",
                animation: isNew ? "kds-pulse 1.5s ease-in-out infinite" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: "#F8FAFC" }}>#{o.display_number}</span>
                <span style={{ fontSize: 12, color: "#94A3B8" }}>
                  {new Date(o.submitted_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F8FAFC", marginBottom: 4 }}>
                {o.vip_snap && "⭐ "}{o.guest_name_snap}
              </div>
              {o.room_snap && <div style={{ fontSize: 13, color: "#CBD5E1" }}>{o.room_snap}</div>}
              {o.dietary_snap && (
                <div style={{
                  marginTop: 8, padding: "6px 8px", borderRadius: 6,
                  background: "rgba(239,68,68,0.2)", color: "#FCA5A5", fontSize: 12, fontWeight: 700,
                }}>
                  🥗 {o.dietary_snap}
                </div>
              )}
              {o.kitchen_notes && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#FDE68A" }}>📝 {o.kitchen_notes}</div>
              )}
              <ul style={{ margin: "12px 0", paddingRight: 18, color: "#E2E8F0", fontSize: 14, lineHeight: 1.6 }}>
                {(o.lines ?? []).map((l) => (
                  <li key={l.id}>
                    <strong>{l.quantity}×</strong> {l.item_name}
                    {l.line_notes ? ` (${l.line_notes})` : ""}
                  </li>
                ))}
              </ul>
              {btn && (
                <button
                  type="button"
                  onClick={() => updateStatus(o.id, btn.next)}
                  style={{
                    width: "100%", padding: "12px", borderRadius: 10, border: "none",
                    background: btn.color, color: "#fff", fontWeight: 800, fontSize: 15,
                    cursor: "pointer", fontFamily: "Heebo, sans-serif",
                  }}
                >
                  {btn.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes kds-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
          50% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
        }
      `}</style>
    </div>
  );
}

const shellStyle = {
  minHeight: "100vh",
  background: "#0F172A",
  fontFamily: "Heebo, sans-serif",
  direction: "rtl",
};
