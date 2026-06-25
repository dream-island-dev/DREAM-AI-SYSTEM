// src/components/RequestsBoard.js
// Requests Board — staff-facing view of guest_alerts (migration 012).
// Backing table already existed and was already being written to
// (complaint / date_change_request / request alert_types) — this is the
// first UI that reads it. Single source of truth: guest_alerts, joined to
// guests for name/room. No new table — see CLAUDE.md Task Board plan.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const TYPE_META = {
  complaint:           { label: "🔴 תקלה",          bg: "#FFF0EE", color: "#C0392B" },
  date_change_request: { label: "🗓️ שינוי תאריך",   bg: "#E8F0FE", color: "#1A56DB" },
  request:             { label: "📝 בקשה",           bg: "#FFF5E8", color: "#B5600A" },
  // Currently written ONLY by guest-portal-upsell — relabeled from the
  // original generic "💰 הזדמנות מכירה" so a portal request reads as exactly
  // that, at a glance, even without using the source filter below.
  upsell_opportunity:  { label: "🌴 בקשה מהפורטל",   bg: "#E8F5EF", color: "#1A7A4A" },
};
// FAIL VISIBLE (CLAUDE.md §0.3): an unrecognized alert_type must show as a
// visible warning, not silently fall back to a "looks fine" label.
function typeMeta(alertType) {
  return TYPE_META[alertType] ?? { label: `⚠ ${alertType ?? "ללא סוג"}`, bg: "#F5F5F5", color: "#888888" };
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export default function RequestsBoard({ user }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  // "New Portal Requests" pane — Full Portal Integration session. Reuses this
  // existing board + its realtime/resolve flow rather than a parallel
  // dashboard: alert_type='upsell_opportunity' is currently written ONLY by
  // guest-portal-upsell, so it's already a clean, unique key for "came from
  // the Guest Portal" — no new column needed.
  const [sourceFilter, setSourceFilter] = useState("all"); // "all" | "portal"
  const [resolvingReq, setResolvingReq] = useState(null); // the row being resolved
  const [noteText, setNoteText]         = useState("");
  const [saving, setSaving]             = useState(false);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("guest_alerts")
      .select("*, guests(name, room)")
      .order("resolved", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setRequests(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const openResolve = (req) => { setResolvingReq(req); setNoteText(""); };
  const closeResolve = () => { if (!saving) { setResolvingReq(null); setNoteText(""); } };

  const confirmResolve = async () => {
    if (!resolvingReq) return;
    setSaving(true);
    const patch = {
      resolved:         true,
      resolved_by:      user?.id ?? null,
      resolved_at:      new Date().toISOString(),
      resolution_notes: noteText.trim() || null,
    };
    const { error } = await supabase.from("guest_alerts").update(patch).eq("id", resolvingReq.id);
    setSaving(false);
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setRequests((prev) => prev.map((r) => (r.id === resolvingReq.id ? { ...r, ...patch } : r)));
    showToast("ok", "✅ סומן כטופל");
    setResolvingReq(null);
    setNoteText("");
  };

  const bySource = sourceFilter === "portal"
    ? requests.filter((r) => r.alert_type === "upsell_opportunity")
    : requests;
  const visible = showResolved ? bySource : bySource.filter((r) => !r.resolved);
  const pendingCount = bySource.filter((r) => !r.resolved).length;
  const portalPendingCount = requests.filter((r) => r.alert_type === "upsell_opportunity" && !r.resolved).length;

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* ── Resolve modal — request context + optional resolution note ──────── */}
      {resolvingReq && (
        <div
          onClick={closeResolve}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card-bg)", borderRadius: 12, padding: 24,
              maxWidth: 440, width: "90%", direction: "rtl", textAlign: "right",
              boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "var(--gold-dark)" }}>
              ✓ סמן כטופל — {resolvingReq.guests?.name || "אורח"}
            </h3>
            <div style={{
              whiteSpace: "pre-wrap", background: "var(--ivory)", borderRadius: 8,
              padding: 12, fontSize: 14, color: "#333", marginBottom: 12,
              border: "1px solid var(--border)",
            }}>
              {resolvingReq.message}
            </div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
              הערת טיפול (אופציונלי) — לדוגמה: "מגבות נמסרו לחדר 104"
            </label>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={3}
              placeholder="מה בוצע בפועל..."
              style={{
                width: "100%", borderRadius: 8, border: "1px solid var(--border)",
                padding: 10, fontFamily: "Heebo, sans-serif", fontSize: 13,
                resize: "vertical", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-sm" onClick={closeResolve} disabled={saving} style={{ background: "var(--ivory)" }}>
                ביטול
              </button>
              <button
                className="btn btn-sm"
                disabled={saving}
                onClick={confirmResolve}
                style={{ background: "#E8F5EF", color: "#1A7A4A", fontWeight: 700 }}
              >
                {saving ? "שומר…" : "✓ אשר טיפול"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Source filter — "🌴 בקשות מהפורטל" isolates guest-portal-upsell rows
          (alert_type='upsell_opportunity') into their own dedicated view,
          without forking a second board/realtime subscription. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          { id: "all", label: "הכל" },
          { id: "portal", label: `🌴 בקשות מהפורטל${portalPendingCount > 0 ? ` (${portalPendingCount})` : ""}` },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setSourceFilter(f.id)}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: `1.5px solid ${sourceFilter === f.id ? "var(--gold-dark)" : "var(--border)"}`,
              background: sourceFilter === f.id ? "var(--gold)" : "transparent",
              color: sourceFilter === f.id ? "#1A1A1A" : "var(--text-muted)",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {pendingCount} {"בקשות פתוחות"}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} style={{ accentColor: "var(--gold)" }} />
            הצג גם טופלו
          </label>
          <button className="btn btn-ghost btn-sm" onClick={fetchRequests} disabled={loading}>
            {loading ? "..." : "↺ רענון"}
          </button>
        </div>
      </div>

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון בקשות.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען בקשות...</div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          {showResolved ? "אין בקשות עדיין." : "אין בקשות פתוחות 🎉"}
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead><tr>
                <th>אורח</th><th>חדר</th><th>סוג</th><th>בקשה</th><th>זמן</th><th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>
                {visible.map((r) => {
                  const tm = typeMeta(r.alert_type);
                  return (
                    <tr key={r.id} style={{ opacity: r.resolved ? 0.6 : 1 }}>
                      <td style={{ fontWeight: 700 }}>{r.guests?.name || "—"}</td>
                      <td>{r.guests?.room || "—"}</td>
                      <td>
                        <span style={{
                          padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: tm.bg, color: tm.color,
                        }}>{tm.label}</span>
                      </td>
                      <td style={{ fontSize: 13, maxWidth: 320 }}>
                        <div>{r.message}</div>
                        {r.resolved && r.resolution_notes && (
                          <div style={{ fontSize: 12, color: "#1A7A4A", marginTop: 4 }}>
                            ✓ {r.resolution_notes}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {fmtTimestamp(r.created_at)}
                      </td>
                      <td>
                        <span style={{
                          padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: r.resolved ? "#E8F5EF" : "#FFF5E8",
                          color:      r.resolved ? "#1A7A4A" : "#B5600A",
                        }}>
                          {r.resolved ? "✓ בוצע" : "ממתין"}
                        </span>
                      </td>
                      <td>
                        {!r.resolved && (
                          <button
                            className="btn btn-sm"
                            onClick={() => openResolve(r)}
                            style={{ background: "#E8F5EF", color: "#1A7A4A", fontWeight: 700 }}
                          >
                            ✓ סמן כטופל
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
