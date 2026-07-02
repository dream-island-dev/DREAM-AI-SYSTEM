// src/components/RoutingControlCenter.js
// "מרכז ניתוב" — admin dashboard for routing_config (migration 121).
//
// Root problem this exists to solve: whapi-webhook/sla-escalation-cron used to
// decide "which WhatsApp group" and "does SLA apply" purely from hardcoded
// constants/env vars — a Room Service request and a towel request were both
// just `tasks` rows, so the same 7-minute unassigned-SLA clock fired an
// "SLA BREACH" card into whichever group the request card itself went to.
// This screen lets an admin split every intent into exactly two channels:
//   🛠️ תפעול (Operations)      — physical field tasks, SLA stays ON.
//   🛎️ בקשות אורחים (Requests) — future orders/spa/room-service/portal, SLA OFF.
// per intent_type, with an optional WhatsApp group JID override — no redeploy
// needed, edge functions read this table live (5-min cache).

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
      padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
      color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
      border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
    }}>{toast.msg}</div>
  );
}

const BOARD_META = {
  operations: { icon: "🛠️", label: "תפעול (SLA פעיל כברירת מחדל)", color: "var(--gold-dark)" },
  requests:   { icon: "🛎️", label: "בקשות אורחים (ללא SLA כברירת מחדל)", color: "#5B21B6" },
};

export default function RoutingControlCenter() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [dirtyKeys, setDirtyKeys] = useState({});

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setError("Supabase לא מוגדר"); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("routing_config")
        .select("intent_type, destination_board, whatsapp_group_id, enable_sla, label, updated_at")
        .order("destination_board", { ascending: true })
        .order("intent_type", { ascending: true });
      if (err) throw err;
      setRows(data ?? []);
    } catch (e) {
      setError("שגיאה בטעינת הגדרות הניתוב: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function patchRow(intentType, patch) {
    setRows((prev) => prev.map((r) => (r.intent_type === intentType ? { ...r, ...patch } : r)));
    setDirtyKeys((prev) => ({ ...prev, [intentType]: true }));
  }

  async function saveRow(row) {
    setSavingKey(row.intent_type);
    try {
      const { error: err } = await supabase
        .from("routing_config")
        .update({
          destination_board: row.destination_board,
          whatsapp_group_id: row.whatsapp_group_id?.trim() || null,
          enable_sla: row.enable_sla,
        })
        .eq("intent_type", row.intent_type);
      if (err) throw err;
      setDirtyKeys((prev) => { const next = { ...prev }; delete next[row.intent_type]; return next; });
      showToast("ok", `✓ נשמר: ${row.label || row.intent_type}`);
    } catch (e) {
      showToast("err", "שגיאה בשמירה: " + (e?.message ?? e));
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) return <div style={{ padding: 30, color: "var(--text-muted)" }}>טוען הגדרות ניתוב...</div>;
  if (error) return <div style={{ padding: 30, color: "#C0392B", fontWeight: 700 }}>⚠ {error}</div>;

  const grouped = { operations: [], requests: [] };
  for (const r of rows) (grouped[r.destination_board] ?? grouped.operations).push(r);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <Toast toast={toast} />
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontFamily: "'Playfair Display', serif", color: "var(--gold-dark)" }}>
          🔀 מרכז ניתוב — Operations vs Guest Requests
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 6, maxWidth: 720 }}>
          לכל סוג בקשה (intent) — לאיזה לוח הוא הולך, לאיזו קבוצת וואטסאפ (JID, ריק = ברירת מחדל
          מהקוד), ואם חל עליו שעון SLA. שירות חדרים / ספא / הזמנות פורטל לא אמורים להפעיל התראת
          "SLA BREACH" — זו הבעיה שהמסך הזה פותר.
        </p>
      </div>

      {["operations", "requests"].map((board) => (
        <div key={board} style={{ marginBottom: 28 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
            fontWeight: 800, fontSize: 15, color: BOARD_META[board].color,
          }}>
            <span>{BOARD_META[board].icon}</span>
            <span>{BOARD_META[board].label}</span>
          </div>

          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            {grouped[board].length === 0 && (
              <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>אין רשומות בלוח זה.</div>
            )}
            {grouped[board].map((row, i) => {
              const dirty = !!dirtyKeys[row.intent_type];
              return (
                <div key={row.intent_type} style={{
                  display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
                  padding: "12px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  background: dirty ? "var(--ivory)" : "transparent",
                }}>
                  <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{row.label || row.intent_type}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{row.intent_type}</div>
                  </div>

                  <select
                    value={row.destination_board}
                    onChange={(e) => patchRow(row.intent_type, { destination_board: e.target.value })}
                    style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}
                  >
                    <option value="operations">🛠️ תפעול</option>
                    <option value="requests">🛎️ בקשות אורחים</option>
                  </select>

                  <input
                    value={row.whatsapp_group_id ?? ""}
                    onChange={(e) => patchRow(row.intent_type, { whatsapp_group_id: e.target.value })}
                    placeholder="Group JID (ריק = ברירת מחדל)"
                    dir="ltr"
                    style={{ flex: "1 1 200px", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, fontFamily: "monospace" }}
                  />

                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={!!row.enable_sla}
                      onChange={(e) => patchRow(row.intent_type, { enable_sla: e.target.checked })}
                    />
                    SLA פעיל
                  </label>

                  <button
                    onClick={() => saveRow(row)}
                    disabled={!dirty || savingKey === row.intent_type}
                    title={dirty ? "שמור שינויים" : "אין שינויים לשמור"}
                    style={{
                      padding: "6px 14px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 700,
                      cursor: dirty ? "pointer" : "not-allowed",
                      background: dirty ? "var(--gold-dark)" : "var(--border)",
                      color: dirty ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {savingKey === row.intent_type ? "שומר..." : "💾 שמור"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
