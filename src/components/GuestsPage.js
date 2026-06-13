// src/components/GuestsPage.js
// Guest / daily check-in management. Fetch-on-mount (F5-proof).
// Manager can flip a guest to "Room Ready" → fires WhatsApp Trigger 3
// (suites) immediately via the whatsapp-send edge function.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const STATUS_META = {
  expected:   { label: "ממתין",     bg: "#FFF5E8", color: "#B5600A" },
  room_ready: { label: "חדר מוכן",  bg: "#E8F5EF", color: "#1A7A4A" },
  checked_in: { label: "צ'ק-אין",   bg: "#EEF4FF", color: "#2952A3" },
};

export default function GuestsPage() {
  const [guests, setGuests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [toast, setToast]     = useState(null);
  const [badgeHover, setBadgeHover] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null); // { id, name, phone, amount, link }
  const [paymentBusy, setPaymentBusy]   = useState(null); // guestId being sent

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  const fetchGuests = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("guests")
      .select("*")
      .order("arrival_date", { ascending: true })
      .order("id", { ascending: true });
    if (error) showToast("err", "שגיאה: " + error.message);
    else setGuests(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  const setStatus = async (guest, status) => {
    if (!supabase) return;
    setBusy(guest.id);
    const patch = { status };
    if (status === "checked_in") patch.checkin_time = new Date().toISOString();
    if (status === "expected")   patch.checkin_time = null; // clear on revert
    const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
    if (error) { showToast("err", "שגיאה: " + error.message); setBusy(null); return; }
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...patch } : g)));

    // Room Ready → fire WhatsApp Trigger 3 (suites only) immediately.
    // Safe before the function is deployed: failures are swallowed.
    if (status === "room_ready" && guest.room_type === "suite") {
      try {
        await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "room_ready", guestId: guest.id },
        });
      } catch { /* function may not be deployed yet */ }
    }
    const labels = { checked_in: "צ'ק-אין ✓", room_ready: "חדר מוכן ✓", expected: "הוחזר לממתין ↩" };
    showToast("ok", labels[status] ?? "עודכן ✓");
    setBusy(null);
  };

  const isSuite = (g) => g.room_type === "suite";

  // ── Payment template sender ──────────────────────────────────────────────────
  const doSendPayment = async (guestId) => {
    setPaymentBusy(guestId);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "payment_and_workshops", guestId: String(guestId) },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה בשליחה");
      showToast("ok", "💳 תבנית תשלום נשלחה בהצלחה ✓");
      setPaymentModal(null);
    } catch (e) {
      showToast("err", "שגיאה: " + (e?.message ?? e));
    } finally {
      setPaymentBusy(null);
    }
  };

  const handleSendPaymentTemplate = (g) => {
    if (!supabase) return;
    if (!g.payment_amount || !g.payment_link_url) {
      // Open modal to fill in missing payment data
      setPaymentModal({
        id:     g.id,
        name:   g.name,
        phone:  g.phone,
        amount: g.payment_amount ? String(g.payment_amount) : "",
        link:   g.payment_link_url || "",
      });
    } else {
      doSendPayment(g.id);
    }
  };

  const handleSavePaymentAndSend = async () => {
    if (!paymentModal || !supabase) return;
    if (!paymentModal.amount) { showToast("err", "נא להזין סכום תשלום"); return; }
    if (!paymentModal.link)   { showToast("err", "נא להזין קישור תשלום"); return; }

    setPaymentBusy(paymentModal.id);
    try {
      const { error } = await supabase.from("guests").update({
        payment_amount:   parseFloat(paymentModal.amount),
        payment_link_url: paymentModal.link.trim(),
      }).eq("id", paymentModal.id);
      if (error) throw error;

      setGuests((prev) => prev.map((g) => g.id === paymentModal.id
        ? { ...g, payment_amount: parseFloat(paymentModal.amount), payment_link_url: paymentModal.link.trim() }
        : g
      ));
      await doSendPayment(paymentModal.id);
    } catch (e) {
      showToast("err", "שגיאה: " + (e?.message ?? e));
      setPaymentBusy(null);
    }
  };

  return (
    <div>
      {/* ── Payment data modal ─────────────────────────────────────────────── */}
      {paymentModal && (
        <div
          onClick={() => !paymentBusy && setPaymentModal(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card-bg, #fff)", borderRadius: 16, padding: "28px 28px 24px",
              width: 360, boxShadow: "0 24px 64px rgba(0,0,0,0.25)", direction: "rtl",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>💳 שלח תשלום + סדנאות</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>
              {paymentModal.name} · {paymentModal.phone}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 5 }}>סכום לתשלום (₪)</label>
              <input
                type="number"
                value={paymentModal.amount}
                onChange={(e) => setPaymentModal((p) => ({ ...p, amount: e.target.value }))}
                placeholder="לדוגמה: 1200"
                disabled={!!paymentBusy}
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border, #ddd)", borderRadius: 8, fontSize: 15, direction: "ltr", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 5 }}>קישור תשלום</label>
              <input
                type="url"
                value={paymentModal.link}
                onChange={(e) => setPaymentModal((p) => ({ ...p, link: e.target.value }))}
                placeholder="https://pay.dream-island.co.il/r/..."
                disabled={!!paymentBusy}
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border, #ddd)", borderRadius: 8, fontSize: 12, direction: "ltr", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPaymentModal(null)}
                disabled={!!paymentBusy}
              >ביטול</button>
              <button
                className="btn btn-sm"
                onClick={handleSavePaymentAndSend}
                disabled={!!paymentBusy}
                style={{ background: "#1B3A32", color: "#fff", fontWeight: 700 }}
              >
                {paymentBusy === paymentModal.id ? "⏳ שולח..." : "💳 שמור ושלח"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{guests.length} אורחים</div>
        <button className="btn btn-ghost btn-sm" onClick={fetchGuests} disabled={loading}>
          {loading ? "..." : "↺ רענון"}
        </button>
      </div>

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון אורחים.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען אורחים...</div>
      ) : guests.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          אין אורחים עדיין — ייבא קובץ צ'ק-אין דרך "העלאת נתונים".
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead><tr>
                <th>שם</th><th>טלפון</th><th>חדר</th><th>סוג</th><th>הגעה</th><th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>
                {guests.map((g) => {
                  const sm = STATUS_META[g.status] ?? STATUS_META.expected;
                  return (
                    <tr key={g.id}>
                      <td style={{ fontWeight: 700 }}>
                        {g.name}
                        {g.arrival_confirmed && (
                          <span style={{ fontSize: 10, marginRight: 6, background: "#E8F5EF", color: "#1A7A4A", padding: "2px 6px", borderRadius: 8, fontWeight: 700, verticalAlign: "middle" }}>✓ אישר</span>
                        )}
                        {g.requires_attention && (
                          <span style={{ fontSize: 11, marginRight: 4, verticalAlign: "middle" }} title="דורש טיפול">🔴</span>
                        )}
                      </td>
                      <td style={{ direction: "ltr", fontSize: 13 }}>{g.phone ?? "—"}</td>
                      <td>{g.room ?? "—"}</td>
                      <td>
                        <span style={{
                          padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: isSuite(g) ? "rgba(201,169,110,0.2)" : "var(--ivory)",
                          color: isSuite(g) ? "var(--gold-dark)" : "var(--text-muted)",
                        }}>{isSuite(g) ? "👑 סוויטה" : "סטנדרט"}</span>
                      </td>
                      <td style={{ fontSize: 13 }}>{g.arrival_date ?? "—"}</td>
                      <td>
                        <span
                          onClick={g.status === "checked_in" ? () => setStatus(g, "expected") : undefined}
                          onMouseEnter={g.status === "checked_in" ? () => setBadgeHover(g.id) : undefined}
                          onMouseLeave={g.status === "checked_in" ? () => setBadgeHover(null) : undefined}
                          title={g.status === "checked_in" ? "לחץ לביטול צ'ק-אין" : undefined}
                          style={{
                            padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                            background: badgeHover === g.id ? "#FFF0EE" : sm.bg,
                            color:      badgeHover === g.id ? "#C0392B" : sm.color,
                            cursor: g.status === "checked_in" ? "pointer" : "default",
                            transition: "background 0.15s, color 0.15s",
                            userSelect: "none",
                          }}
                        >
                          {badgeHover === g.id ? "↩ בטל" : sm.label}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {/* ── ממתין: can mark room-ready or go straight to check-in ── */}
                          {g.status === "expected" && (<>
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "room_ready")}
                              style={{ background: "#E8F5EF", color: "#1A7A4A" }}>
                              ✓ חדר מוכן
                            </button>
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "checked_in")}
                              style={{ background: "#EEF4FF", color: "#2952A3" }}>
                              🛎️ צ'ק-אין
                            </button>
                          </>)}

                          {/* ── חדר מוכן: confirm check-in OR revert to waiting ── */}
                          {g.status === "room_ready" && (<>
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "checked_in")}
                              style={{ background: "#EEF4FF", color: "#2952A3" }}>
                              🛎️ צ'ק-אין
                            </button>
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "expected")}
                              style={{ background: "#FFF0EE", color: "#C0392B" }}>
                              ↩ בטל
                            </button>
                          </>)}

                          {/* ── צ'ק-אין: undo / revert back to waiting ── */}
                          {g.status === "checked_in" && (
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "expected")}
                              style={{ background: "#FFF5E8", color: "#B5600A", fontWeight: 700 }}>
                              ↩ בטל צ'ק-אין
                            </button>
                          )}

                          {/* Payment button — visible once guest confirmed arrival */}
                          {g.arrival_confirmed && (
                            <button
                              className="btn btn-sm"
                              disabled={paymentBusy === g.id || busy === g.id}
                              onClick={() => handleSendPaymentTemplate(g)}
                              title={g.payment_link_url ? "שלח תבנית תשלום + סדנאות" : "הגדר קישור תשלום לפני שליחה"}
                              style={{
                                background: g.payment_link_url ? "#1B3A32" : "#FFF5E8",
                                color:      g.payment_link_url ? "#fff"    : "#B5600A",
                                fontWeight: 700,
                              }}
                            >
                              {paymentBusy === g.id ? "⏳" : "💳 תשלום"}
                            </button>
                          )}

                          {busy === g.id && (
                            <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>⏳</span>
                          )}
                        </div>
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
