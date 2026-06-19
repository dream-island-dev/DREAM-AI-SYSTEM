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
  const [selectedIds, setSelectedIds]   = useState(new Set()); // batch selection
  const [resetBusy, setResetBusy]       = useState(false);
  const [editGuest,  setEditGuest]      = useState(null);  // guest obj being edited
  const [editForm,   setEditForm]       = useState({});
  const [editSaving, setEditSaving]     = useState(false);

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

  // ── Batch selection helpers ──────────────────────────────────────────────────
  const toggleSelect = (id) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => prev.size === guests.length ? new Set() : new Set(guests.map((g) => g.id)));

  // ── Safe spa reset — UPDATE only, never DELETE ───────────────────────────────
  const handleResetSpa = async () => {
    if (!selectedIds.size || !supabase) return;
    const ids = [...selectedIds];
    if (!window.confirm(`לאפס נתוני ספא ל-${ids.length} אורחים שנבחרו?\n(הרשומות לא יימחקו, רק שעת הספא תתאפס)`)) return;
    setResetBusy(true);
    try {
      const { error } = await supabase
        .from("guests")
        .update({ spa_time: null })
        .in("id", ids);
      if (error) throw error;
      // Best-effort: clear bookings table too (phone without + prefix)
      const phones = guests
        .filter((g) => selectedIds.has(g.id) && g.phone)
        .map((g) => g.phone.replace(/^\+/, ""));
      if (phones.length) {
        await supabase
          .from("bookings")
          .update({ treatment_time: null, treatment_type: null })
          .in("phone", phones);
      }
      setGuests((prev) => prev.map((g) => selectedIds.has(g.id) ? { ...g, spa_time: null } : g));
      setSelectedIds(new Set());
      showToast("ok", `✅ נתוני ספא אופסו ל-${ids.length} אורחים`);
    } catch (e) {
      showToast("err", "שגיאה באיפוס: " + (e?.message ?? e));
    } finally {
      setResetBusy(false);
    }
  };

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

  const openEdit = (g) => {
    setEditGuest(g);
    setEditForm({
      name:               g.name               ?? "",
      arrival_date:       g.arrival_date        ?? "",
      spa_time:           g.spa_time            ?? "",
      treatment_count:    g.treatment_count != null ? String(g.treatment_count) : "",
      order_number:       g.order_number        ?? "",
      status:             g.status              ?? "expected",
      requires_attention: !!g.requires_attention,
      needs_callback:     !!g.needs_callback,
      room:               g.room                ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editGuest || !supabase) return;
    setEditSaving(true);
    try {
      const patch = {
        name:               editForm.name.trim() || null,
        arrival_date:       editForm.arrival_date  || null,
        spa_time:           editForm.spa_time       || null,
        treatment_count:    editForm.treatment_count !== "" ? parseInt(editForm.treatment_count, 10) : null,
        order_number:       editForm.order_number.trim() || null,
        status:             editForm.status,
        requires_attention: editForm.requires_attention,
        needs_callback:     editForm.needs_callback,
        room:               editForm.room.trim()   || null,
      };
      const { error } = await supabase.from("guests").update(patch).eq("id", editGuest.id);
      if (error) throw error;
      setGuests(prev => prev.map(g => g.id === editGuest.id ? { ...g, ...patch } : g));
      setEditGuest(null);
      showToast("ok", "✅ פרופיל אורח עודכן בהצלחה");
    } catch (e) {
      showToast("err", "שגיאה: " + (e?.message ?? e));
    } finally {
      setEditSaving(false);
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

      {/* ── Edit guest profile modal ──────────────────────────────────────── */}
      {editGuest && (
        <div
          onClick={() => !editSaving && setEditGuest(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--card-bg,#fff)", borderRadius: 18,
              padding: "28px 24px 22px", width: "100%", maxWidth: 480,
              boxShadow: "0 24px 64px rgba(0,0,0,0.25)", direction: "rtl",
              maxHeight: "90vh", overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>✏️ עריכת פרופיל אורח</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20, direction: "ltr" }}>
              {editGuest.phone}
            </div>

            {[
              { label: "שם מלא",       field: "name",            type: "text"   },
              { label: "חדר",           field: "room",            type: "text"   },
              { label: "תאריך הגעה",   field: "arrival_date",    type: "date"   },
              { label: "שעת ספא",      field: "spa_time",        type: "time"   },
              { label: "מספר טיפולים", field: "treatment_count", type: "number" },
              { label: "מספר הזמנה",   field: "order_number",    type: "text"   },
            ].map(({ label, field, type }) => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>{label}</label>
                <input
                  type={type}
                  value={editForm[field] ?? ""}
                  onChange={e => setEditForm(p => ({ ...p, [field]: e.target.value }))}
                  disabled={editSaving}
                  style={{
                    width: "100%", padding: "9px 12px", boxSizing: "border-box",
                    border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 14,
                    direction: type === "text" ? "rtl" : "ltr", fontFamily: "Heebo,sans-serif",
                  }}
                />
              </div>
            ))}

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>סטטוס</label>
              <select
                value={editForm.status ?? "expected"}
                onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}
                disabled={editSaving}
                style={{
                  width: "100%", padding: "9px 12px", border: "1px solid var(--border,#ddd)",
                  borderRadius: 8, fontSize: 14, fontFamily: "Heebo,sans-serif",
                  background: "var(--card-bg,#fff)", cursor: "pointer",
                }}
              >
                <option value="pending">ממתין לייבוא</option>
                <option value="expected">ממתין</option>
                <option value="room_ready">חדר מוכן</option>
                <option value="checked_in">צ'ק-אין</option>
              </select>
            </div>

            {[
              { label: "דורש תשומת לב 🔴",         field: "requires_attention" },
              { label: "הועבר לטיפול אנושי (בוט שותק)", field: "needs_callback"     },
            ].map(({ label, field }) => (
              <div key={field} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 0", borderBottom: "1px solid var(--border,#eee)",
              }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                <input
                  type="checkbox"
                  checked={!!editForm[field]}
                  onChange={e => setEditForm(p => ({ ...p, [field]: e.target.checked }))}
                  disabled={editSaving}
                  style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--gold)" }}
                />
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
              <button
                onClick={() => setEditGuest(null)}
                disabled={editSaving}
                style={{
                  padding: "9px 18px", borderRadius: 8,
                  border: "1px solid var(--border,#ddd)", background: "transparent",
                  fontFamily: "Heebo,sans-serif", fontSize: 13, cursor: "pointer",
                }}>
                ביטול
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={editSaving}
                style={{
                  padding: "9px 22px", borderRadius: 8, border: "none",
                  background: "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                  color: "#0F0F0F", fontFamily: "Heebo,sans-serif",
                  fontSize: 14, fontWeight: 800, cursor: editSaving ? "not-allowed" : "pointer",
                }}>
                {editSaving ? "⏳ שומר..." : "💾 שמור"}
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selectedIds.size > 0 && (
            <button
              onClick={handleResetSpa}
              disabled={resetBusy}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "1px solid #C0392B",
                background: resetBusy ? "var(--ivory)" : "#FFF0EE", color: "#C0392B",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700, cursor: resetBusy ? "not-allowed" : "pointer",
              }}>
              {resetBusy ? "⏳ מאפס..." : `🗑️ מחיקת נתוני ספא שנבחרו (${selectedIds.size})`}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={fetchGuests} disabled={loading}>
            {loading ? "..." : "↺ רענון"}
          </button>
        </div>
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
                <th style={{ width: 36 }}>
                  <input type="checkbox"
                    checked={guests.length > 0 && selectedIds.size === guests.length}
                    onChange={toggleSelectAll}
                    title="בחר הכל"
                    style={{ cursor: "pointer", accentColor: "var(--gold)" }} />
                </th>
                <th>שם</th><th>טלפון</th><th>חדר</th><th>סוג</th><th>הגעה</th>
                <th style={{ color: "#7c3aed" }}>ספא</th>
                <th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>
                {guests.map((g) => {
                  const sm = STATUS_META[g.status] ?? STATUS_META.expected;
                  return (
                    <tr key={g.id} style={{ background: selectedIds.has(g.id) ? "rgba(201,169,110,0.07)" : undefined }}>
                      <td>
                        <input type="checkbox"
                          checked={selectedIds.has(g.id)}
                          onChange={() => toggleSelect(g.id)}
                          style={{ cursor: "pointer", accentColor: "var(--gold)" }} />
                      </td>
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
                      <td style={{
                        fontSize: 13, fontWeight: g.spa_time ? 800 : 400,
                        color: g.spa_time ? "#7c3aed" : "var(--text-muted)",
                      }}>
                        {g.spa_time || "—"}
                      </td>
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
                          {/* ── Edit profile ── */}
                          <button
                            className="btn btn-sm"
                            onClick={() => openEdit(g)}
                            title="ערוך פרופיל אורח"
                            style={{ background: "var(--ivory)", color: "var(--gold-dark)", fontWeight: 700, border: "1px solid var(--gold)" }}>
                            ✏️
                          </button>
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
