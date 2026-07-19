// Active restaurant orders today — waiter view + realtime.

import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { israelTodayStr } from "../utils/guestTiming";

const STATUS_COLORS = {
  submitted: { bg: "#FEF3C7", border: "#F59E0B", label: "חדש במטבח" },
  in_kitchen: { bg: "#DBEAFE", border: "#3B82F6", label: "בהכנה" },
  ready: { bg: "#D1FAE5", border: "#10B981", label: "מוכן להגשה" },
  served: { bg: "#F3F4F6", border: "#9CA3AF", label: "נמסר" },
  cancelled: { bg: "#FEE2E2", border: "#EF4444", label: "בוטל" },
};

export default function RestaurantActiveOrdersPanel({ dayYmd, onToast }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    const ymd = dayYmd || israelTodayStr();
    const { data, error } = await supabase
      .from("restaurant_orders")
      .select(
        "id, display_number, status, guest_name_snap, room_snap, meal_period, " +
        "submitted_at, kitchen_notes, vip_snap, dietary_snap",
      )
      .eq("day_ymd", ymd)
      .neq("status", "cancelled")
      .order("submitted_at", { ascending: false })
      .limit(50);

    if (error) {
      onToast?.("err", error.message);
      setOrders([]);
    } else {
      const ids = (data ?? []).map((o) => o.id);
      let lines = [];
      if (ids.length) {
        const { data: lineRows } = await supabase
          .from("restaurant_order_lines")
          .select("order_id, item_name, quantity, line_notes")
          .in("order_id", ids);
        lines = lineRows ?? [];
      }
      const byOrder = {};
      for (const l of lines) {
        if (!byOrder[l.order_id]) byOrder[l.order_id] = [];
        byOrder[l.order_id].push(l);
      }
      setOrders((data ?? []).map((o) => ({ ...o, lines: byOrder[o.id] ?? [] })));
    }
    setLoading(false);
  }, [dayYmd, onToast]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    const ch = supabase
      .channel("restaurant-orders-active")
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_orders" }, () => {
        fetchOrders();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchOrders]);

  if (loading) {
    return <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>טוען הזמנות…</div>;
  }

  const open = orders.filter((o) => ["submitted", "in_kitchen", "ready"].includes(o.status));

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
        {open.length} הזמנות פתוחות היום · מתעדכן אוטומטית
      </div>
      {orders.length === 0 ? (
        <div style={{
          padding: 28, textAlign: "center", border: "1px dashed var(--border)",
          borderRadius: 12, color: "var(--text-muted)",
        }}>
          עדיין אין הזמנות היום.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orders.map((o) => {
            const sc = STATUS_COLORS[o.status] ?? STATUS_COLORS.submitted;
            return (
              <div
                key={o.id}
                style={{
                  padding: "12px 14px", borderRadius: 10,
                  border: `2px solid ${sc.border}`, background: sc.bg,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <strong>#{o.display_number} · {o.guest_name_snap || "—"}</strong>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{sc.label}</span>
                </div>
                {o.room_snap && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>🏨 {o.room_snap}</div>
                )}
                {o.dietary_snap && (
                  <div style={{ fontSize: 12, color: "#9A7209", marginTop: 4 }}>🥗 {o.dietary_snap}</div>
                )}
                <ul style={{ margin: "8px 0 0", paddingRight: 18, fontSize: 13 }}>
                  {(o.lines ?? []).map((l, i) => (
                    <li key={i}>
                      {l.quantity}× {l.item_name}
                      {l.line_notes ? ` (${l.line_notes})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
