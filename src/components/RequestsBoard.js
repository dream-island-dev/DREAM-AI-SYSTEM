// src/components/RequestsBoard.js
// Requests Board — staff-facing view of guest_alerts (migration 012).
// Backing table already existed and was already being written to
// (complaint / date_change_request / request alert_types) — this is the
// first UI that reads it. Single source of truth: guest_alerts, joined to
// guests for name/room. No new table — see CLAUDE.md Task Board plan.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { getGuestTimingBadge } from "../utils/guestTiming";
import AILearningButton from "./AILearningButton";
import UndoSnackbar from "./UndoSnackbar";

const TYPE_META = {
  complaint:           { label: "🔴 תקלה",          bg: "#FFF0EE", color: "#C0392B" },
  date_change_request: { label: "🗓️ שינוי תאריך",   bg: "#E8F0FE", color: "#1A56DB" },
  request:             { label: "📝 בקשה",           bg: "#FFF5E8", color: "#B5600A" },
  // Currently written ONLY by guest-portal-upsell — relabeled from the
  // original generic "💰 הזדמנות מכירה" so a portal request reads as exactly
  // that, at a glance, even without using the source filter below.
  upsell_opportunity:  { label: "🌴 בקשה מהפורטל",   bg: "#E8F5EF", color: "#1A7A4A" },
  portal_room_service: { label: "🍽️ שירות לחדר (פורטל)", bg: "#FFF5E8", color: "#A8843A" },
  financial_issue:     { label: "💳 בעיית חיוב",    bg: "#FFF0EE", color: "#C0392B" },
  spa_request:         { label: "💆 בקשת ספא",       bg: "#E8F0FE", color: "#1A56DB" },
  arrival_eta:         { label: "🕐 שעת הגעה",       bg: "#F3EEFF", color: "#5B3CC4" },
  missing_departure_date: { label: "⚠️ חסר עזיבה",  bg: "#FEF2F2", color: "#B91C1C" },
};
// FAIL VISIBLE (CLAUDE.md §0.3): an unrecognized alert_type must show as a
// visible warning, not silently fall back to a "looks fine" label.
function typeMeta(alertType) {
  return TYPE_META[alertType] ?? { label: `⚠ ${alertType ?? "ללא סוג"}`, bg: "#F5F5F5", color: "#888888" };
}

// Same variant set WhatsAppInbox.js's dismissHumanRequest() matches against —
// guest_alerts.phone and whatsapp_conversations.phone aren't guaranteed to
// share one format (session 15 root cause, CLAUDE.md §6).
function phoneVariants(raw) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const noPlus = digits.startsWith("972") ? digits : `972${digits.replace(/^0/, "")}`;
  return [...new Set([`+${noPlus}`, noPlus, `0${noPlus.slice(3)}`])];
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

function DreamBotChatButton({ phone, guestName, onOpenDreamBotChat, disabled }) {
  const [hover, setHover] = useState(false);
  if (!phone || !onOpenDreamBotChat) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onOpenDreamBotChat({ phone, guestName })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="מעבר מיידי לשיחת הוואטסאפ של האורח ב-DREAM BOT"
      style={{
        width: "100%",
        minHeight: 44,
        padding: "12px 16px",
        borderRadius: 10,
        border: `1.5px solid ${hover && !disabled ? "var(--gold-dark)" : "var(--border)"}`,
        background: disabled
          ? "var(--ivory)"
          : hover
            ? "linear-gradient(135deg, var(--gold-light, #E8C98A) 0%, var(--gold, #C9A96E) 100%)"
            : "var(--ivory)",
        color: disabled ? "var(--text-muted)" : "var(--black)",
        fontFamily: "Heebo, sans-serif",
        fontSize: 14,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
        boxShadow: hover && !disabled ? "0 4px 14px rgba(201,169,110,0.35)" : "none",
      }}
    >
      <span style={{ fontSize: 18 }}>💬</span>
      פתח שיחה ב-DREAM BOT
    </button>
  );
}

function RequestDetailDrawer({ req, onClose, onOpenResolve, onOpenDreamBotChat }) {
  if (!req) return null;
  const tm = typeMeta(req.alert_type);
  const timingBadge = getGuestTimingBadge(req.guests);
  const guestName = req.guests?.name || "אורח";
  const canChat = Boolean(req.phone);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9998, direction: "ltr",
        background: "rgba(0,0,0,0.45)", display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 400, height: "100%", background: "var(--card-bg)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.18)", direction: "rtl", overflowY: "auto",
          padding: "24px 22px", fontFamily: "Heebo, sans-serif",
          animation: "req-drawer-slide-in 0.2s ease-out",
        }}
      >
        <style>{`@keyframes req-drawer-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: "var(--black)" }}>{guestName}</div>
            {req.guests?.room && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>🏨 {req.guests.room}</div>
            )}
            {req.phone && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2, direction: "ltr", textAlign: "right" }}>
                📞 {req.phone}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            style={{
              minWidth: 44, minHeight: 44, border: "none", background: "var(--ivory)",
              borderRadius: 10, cursor: "pointer", fontSize: 18, color: "var(--text-muted)",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          <span style={{
            padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: tm.bg, color: tm.color,
          }}>{tm.label}</span>
          {timingBadge && (
            <span style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: timingBadge.bg, color: timingBadge.color,
              border: `1px solid ${timingBadge.border}`,
            }}>{timingBadge.label}</span>
          )}
          <span style={{
            padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: req.resolved ? "#E8F5EF" : "#FFF5E8",
            color: req.resolved ? "#1A7A4A" : "#B5600A",
          }}>
            {req.resolved ? "✓ בוצע" : "ממתין"}
          </span>
        </div>

        <div style={{
          whiteSpace: "pre-wrap", background: "var(--ivory)", borderRadius: 10,
          padding: 14, fontSize: 14, color: "#333", marginBottom: 12,
          border: "1px solid var(--border)", lineHeight: 1.55,
        }}>
          {req.message}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
          התקבל: {fmtTimestamp(req.created_at)}
        </div>

        {req.resolved && req.resolution_notes && (
          <div style={{
            fontSize: 13, color: "#1A7A4A", background: "#E8F5EF",
            borderRadius: 8, padding: 12, marginBottom: 16,
          }}>
            ✓ {req.resolution_notes}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          <DreamBotChatButton
            phone={req.phone}
            guestName={guestName}
            onOpenDreamBotChat={onOpenDreamBotChat}
            disabled={!canChat}
          />
          {!req.resolved && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { onClose(); onOpenResolve(req); }}
              style={{
                minHeight: 44, background: "#E8F5EF", color: "#1A7A4A", fontWeight: 700,
                width: "100%", borderRadius: 10,
              }}
            >
              ✓ סמן כטופל
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RequestsBoard({ user, onOpenDreamBotChat }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  // "New Portal Requests" pane — Full Portal Integration session. Reuses this
  // existing board + its realtime/resolve flow rather than a parallel
  // dashboard: alert_type='upsell_opportunity' is currently written ONLY by
  // guest-portal-upsell, so it's already a clean, unique key for "came from
  // the Guest Portal" — no new column needed.
  const [sourceFilter, setSourceFilter] = useState("all"); // "all" | "portal" | "eta"
  const [resolvingReq, setResolvingReq] = useState(null); // the row being resolved
  const [noteText, setNoteText]         = useState("");
  const [saving, setSaving]             = useState(false);
  const [undoSnack, setUndoSnack]       = useState(null); // { id, prevRow }
  const [detailReq, setDetailReq]       = useState(null); // right drawer — request context

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    // arrival_date/departure_date/status feed the live future-arrival/in-house
    // badge below (getGuestTimingBadge) — computed at render time, not stored,
    // so it can't drift from the guest's actual current state (CLAUDE.md §0.5).
    const { data, error } = await supabase
      .from("guest_alerts")
      .select("*, guests(name, room, arrival_date, departure_date, status)")
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
    const prevRow = { ...resolvingReq };
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
    setUndoSnack({ id: resolvingReq.id, prevRow });
    setResolvingReq(null);
    setNoteText("");

    // Global Red Alert (CLAUDE.md Task 2) — clear the mirrored Inbox flag now
    // that the underlying request is resolved here. Scoped to
    // human_request_type='guest_alert' so an unrelated genuine callback/
    // date-change flag on the same guest is never silently cleared alongside it.
    const variants = phoneVariants(resolvingReq.phone);
    if (variants.length) {
      supabase
        .from("whatsapp_conversations")
        .update({ human_requested: false })
        .in("phone", variants)
        .eq("human_requested", true)
        .eq("human_request_type", "guest_alert")
        .then(({ error: clearErr }) => {
          if (clearErr) console.warn("[RequestsBoard] inbox red-alert clear failed:", clearErr.message);
        });
    }
  };

  const handleUndoResolve = async () => {
    if (!undoSnack) return;
    const revert = {
      resolved: false,
      resolved_by: null,
      resolved_at: null,
      resolution_notes: null,
    };
    const { error } = await supabase.from("guest_alerts").update(revert).eq("id", undoSnack.id);
    if (error) {
      showToast("err", "שגיאה בביטול: " + error.message);
      return;
    }
    setRequests((prev) => prev.map((r) => (r.id === undoSnack.id ? { ...undoSnack.prevRow, ...revert } : r)));
    setUndoSnack(null);
  };

  const bySource = sourceFilter === "portal"
    ? requests.filter((r) => r.alert_type === "upsell_opportunity")
    : sourceFilter === "eta"
      ? requests.filter((r) => r.alert_type === "arrival_eta")
      : requests;
  const visible = showResolved ? bySource : bySource.filter((r) => !r.resolved);
  const pendingCount = bySource.filter((r) => !r.resolved).length;
  const portalPendingCount = requests.filter((r) => r.alert_type === "upsell_opportunity" && !r.resolved).length;
  const etaPendingCount = requests.filter((r) => r.alert_type === "arrival_eta" && !r.resolved).length;

  return (
    <div>
      {toast && toast.type === "err" && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: "#FFF0EE",
          color: "#C0392B",
          border: "1px solid #C0392B",
        }}>{toast.msg}</div>
      )}

      <UndoSnackbar
        visible={!!undoSnack}
        message="✓ סומן כטופל"
        onUndo={handleUndoResolve}
        onDismiss={() => setUndoSnack(null)}
        durationMs={6000}
      />

      <RequestDetailDrawer
        req={detailReq}
        onClose={() => setDetailReq(null)}
        onOpenResolve={openResolve}
        onOpenDreamBotChat={(ctx) => {
          setDetailReq(null);
          onOpenDreamBotChat?.(ctx);
        }}
      />

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
            {resolvingReq.phone && onOpenDreamBotChat && (
              <div style={{ marginBottom: 12 }}>
                <DreamBotChatButton
                  phone={resolvingReq.phone}
                  guestName={resolvingReq.guests?.name}
                  onOpenDreamBotChat={(ctx) => {
                    closeResolve();
                    onOpenDreamBotChat(ctx);
                  }}
                />
              </div>
            )}
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
          { id: "eta", label: `🕐 שעות הגעה${etaPendingCount > 0 ? ` (${etaPendingCount})` : ""}` },
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
          <AILearningButton module="routing" />
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
                <th>אורח</th><th>חדר</th><th>תזמון</th><th>סוג</th><th>בקשה</th><th>זמן</th><th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>
                {visible.map((r) => {
                  const tm = typeMeta(r.alert_type);
                  const timingBadge = getGuestTimingBadge(r.guests);
                  return (
                    <tr key={r.id} style={{ opacity: r.resolved ? 0.6 : 1 }}>
                      <td style={{ fontWeight: 700 }}>
                        <button
                          type="button"
                          onClick={() => setDetailReq(r)}
                          title="פרטי בקשה"
                          style={{
                            background: "none", border: "none", padding: "6px 0",
                            font: "inherit", fontWeight: 700, color: "var(--gold-dark)",
                            cursor: "pointer", textDecoration: "underline",
                            textUnderlineOffset: 3, minHeight: 44,
                          }}
                        >
                          {r.guests?.name || "—"}
                        </button>
                      </td>
                      <td>{r.guests?.room || "—"}</td>
                      <td>
                        {timingBadge && (
                          <span style={{
                            padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                            whiteSpace: "nowrap",
                            background: timingBadge.bg, color: timingBadge.color,
                            border: `1px solid ${timingBadge.border}`,
                          }}>{timingBadge.label}</span>
                        )}
                      </td>
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
