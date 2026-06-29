// src/components/GuestsPage.js
// Guest / daily check-in management. Fetch-on-mount (F5-proof).
// Manager can flip a guest to "Room Ready" → fires WhatsApp Trigger 3
// (suites) immediately via the whatsapp-send edge function.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { SUITE_REGISTRY } from "../data/suiteRegistry";
import AddGuestModal from "./AddGuestModal";
import GuestAttentionBadge from "./GuestAttentionBadge";
import CustomerProfilePane from "./CustomerProfilePane";
import QuietHoursGate from "./QuietHoursGate";
import { STATUS_META } from "../utils/guestStatusMeta";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";

export default function GuestsPage() {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const [guests, setGuests]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [toast, setToast]     = useState(null);
  const [profileGuest, setProfileGuest] = useState(null); // guest object or null — CustomerProfilePane
  const [badgeHover, setBadgeHover] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null); // { id, name, phone, amount, link }
  const [paymentBusy, setPaymentBusy]   = useState(null); // guestId being sent
  const [selectedIds, setSelectedIds]   = useState(new Set()); // batch selection
  const [resetBusy, setResetBusy]       = useState(false);
  const [editGuest,     setEditGuest]    = useState(null);  // {} = new guest, {id,...} = existing
  const [roomByPhone,    setRoomByPhone]    = useState({});  // phone → { roomName, suiteType, isDayGuest } — fallback display only; the room dropdown itself uses SUITE_REGISTRY
  // "🗂️ לקוחות עבר" filter — guests stays the single source of truth (no new
  // table/component, DNA principle #5); just a client-side view toggle.
  const [showPastGuests, setShowPastGuests] = useState(false);

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

  const fetchRooms = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from("suite_rooms")
      .select("room_name, suite_type, arrival_date, guest_phone, is_day_guest")
      .order("arrival_date", { ascending: true })
      .order("room_name",    { ascending: true });
    const rows = data ?? [];
    // Build phone → room lookup so the table can show room for CSV-imported guests
    const map = {};
    for (const r of rows) {
      if (r.guest_phone && !map[r.guest_phone]) {
        map[r.guest_phone] = { roomName: r.room_name, suiteType: r.suite_type, isDayGuest: !!r.is_day_guest };
      }
    }
    setRoomByPhone(map);
  }, []);

  useEffect(() => { fetchGuests(); fetchRooms(); }, [fetchGuests, fetchRooms]);

  const setStatus = async (guest, status) => {
    if (!supabase) return;
    setBusy(guest.id);
    const patch = { status };
    if (status === "checked_in") patch.checkin_time = new Date().toISOString();
    if (status === "expected")   patch.checkin_time = null; // clear on revert
    const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
    if (error) { showToast("err", "שגיאה: " + error.message); setBusy(null); return; }
    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...patch } : g)));

    // Room Ready → fire WhatsApp room_ready trigger (suites only).
    // Uses isSuite() so legacy guests without explicit room_type are covered.
    if (status === "room_ready" && isSuite(guest)) {
      if (!ensureCanSend()) {
        showToast("err", "חדר סומן כמוכן — אך שליחת WA חסומה בשעות שקט (סמן אישור למעלה)");
        setBusy(null);
        return;
      }
      try {
        const { data: waData, error: waError } = await supabase.functions.invoke("whatsapp-send", {
          body: { trigger: "room_ready", guestId: guest.id },
        });
        if (waError || !waData?.ok) {
          const reason = waData?.error ?? waError?.message ?? "שגיאה לא ידועה";
          showToast("err", `חדר סומן כמוכן — אך הודעת WA נכשלה: ${reason}`);
          setBusy(null);
          return;
        }
        showToast("ok", `✅ חדר מוכן + הודעת WA נשלחה ל${guest.name}${waData.simulation ? " (סימולציה)" : ""}`);
      } catch (e) {
        showToast("err", `חדר סומן כמוכן — אך הודעת WA נכשלה: ${e?.message ?? String(e)}`);
        setBusy(null);
        return;
      }
    } else {
      const labels = { checked_in: "צ'ק-אין ✓", room_ready: "חדר מוכן ✓", expected: "הוחזר לממתין ↩" };
      showToast("ok", labels[status] ?? "עודכן ✓");
    }
    setBusy(null);
  };

  const isSuite = (g) =>
    g.room_type === "suite" ||
    SUITE_REGISTRY.includes(g.room) ||
    (!!roomByPhone[g.phone] && !roomByPhone[g.phone].isDayGuest);

  // ── Room-prerequisite gating for check-in actions ───────────────────────────
  // Day packages (Premium Day 1/2, or any suite_rooms row flagged is_day_guest)
  // never get an actual room — they're exempt from the room requirement.
  const DAY_GUEST_ROOM_VALUES = new Set(["Premium Day 1", "Premium Day 2"]);
  const isDayGuest = (g) =>
    DAY_GUEST_ROOM_VALUES.has(g.room) || !!roomByPhone[g.phone]?.isDayGuest;
  const hasRoomAssigned = (g) => !!(g.room || roomByPhone[g.phone]?.roomName);
  const roomMissing = (g) => !isDayGuest(g) && !hasRoomAssigned(g);

  // ── Batch selection helpers ──────────────────────────────────────────────────
  const toggleSelect = (id) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => prev.size === displayGuests.length ? new Set() : new Set(displayGuests.map((g) => g.id)));

  // ── Past Guests filter — mirrors the departure_date query style already
  //    used in WhatsAppInbox.js for "still on property" checks. ───────────────
  const todayISO = new Date().toISOString().slice(0, 10);
  // Bifurcation enforcement: CheckinTable shows suite guests ONLY.
  // Day-pass guests (day_guest / premium_day_guest) use GuestDashboard's
  // "בילוי יומי" tab — they never have a room-ready or check-in pipeline.
  const displayGuests = guests.filter((g) => {
    const activeWindow = showPastGuests
      ? (g.departure_date && g.departure_date < todayISO)
      : (!g.departure_date || g.departure_date >= todayISO);
    return activeWindow && isSuite(g);
  });

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
    if (!g.payment_amount || !(g.direct_payment_url || g.payment_link_url)) {
      // Open modal to fill in missing payment data
      setPaymentModal({
        id:     g.id,
        name:   g.name,
        phone:  g.phone,
        amount: g.payment_amount ? String(g.payment_amount) : "",
        link:   g.direct_payment_url || g.payment_link_url || "",
      });
    } else {
      doSendPayment(g.id);
    }
  };

  const openEdit = (g) => setEditGuest(g);
  const openAdd  = () => setEditGuest({}); // empty = new guest (no id)

  const handleGuestSaved = (saved) => {
    setGuests((prev) => {
      const exists = prev.some((g) => g.id === saved.id);
      return exists
        ? prev.map((g) => (g.id === saved.id ? { ...g, ...saved } : g))
        : [saved, ...prev];
    });
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
      {quietActive && (
        <div style={{ marginBottom: 16 }}>
          <QuietHoursGate
            active={quietActive}
            checked={overrideChecked}
            onChange={setOverrideChecked}
          />
        </div>
      )}

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

      {/* ── Add/Edit guest profile modal — universal AddGuestModal ─────────── */}
      {editGuest && (
        <AddGuestModal
          guest={editGuest}
          onClose={() => setEditGuest(null)}
          onSaved={handleGuestSaved}
          showToast={showToast}
        />
      )}

      {/* ── Read-only profile drawer (nights/checkout/portal link) — same
          component + click pattern as GuestDashboard.js's "ניהול אורחים" ── */}
      {profileGuest && (
        <CustomerProfilePane guest={profileGuest} onClose={() => setProfileGuest(null)} />
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
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{displayGuests.length} אורחים</div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: "rgba(201,169,110,0.15)", color: "var(--gold-dark)",
            border: "1px solid var(--gold)",
          }}>👑 סוויטות בלבד</span>
          <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={showPastGuests} onChange={(e) => { setShowPastGuests(e.target.checked); setSelectedIds(new Set()); }} style={{ accentColor: "var(--gold)" }} />
            🗂️ הצג לקוחות עבר
          </label>
        </div>
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
          <button
            onClick={openAdd}
            style={{
              padding: "7px 14px", borderRadius: 8, border: "none",
              background: "linear-gradient(135deg,var(--gold),var(--gold-dark))",
              color: "#0F0F0F", fontFamily: "Heebo,sans-serif",
              fontSize: 13, fontWeight: 800, cursor: "pointer",
            }}>
            + הוסף אורח
          </button>
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
      ) : displayGuests.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>
          {showPastGuests
            ? "אין אורחי סוויטות עבר."
            : "אין אורחי סוויטות — ייבא קובץ הגעות דרך \"תפעול ואחזקה\" או הוסף אורח ידנית."}
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table className="table" style={{ minWidth: 720 }}>
              <thead><tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox"
                    checked={displayGuests.length > 0 && selectedIds.size === displayGuests.length}
                    onChange={toggleSelectAll}
                    title="בחר הכל"
                    style={{ cursor: "pointer", accentColor: "var(--gold)" }} />
                </th>
                <th>שם</th><th>טלפון</th><th>חדר</th><th>סוג</th><th>הגעה</th>
                <th style={{ color: "#7c3aed" }}>ספא</th>
                <th>סטטוס</th><th>פעולות</th>
              </tr></thead>
              <tbody>
                {displayGuests.map((g) => {
                  // Unknown status (e.g. a stray value written outside the app) must be visible,
                  // not silently masked as "ממתין" — that's exactly what hid the button bug.
                  const sm = STATUS_META[g.status] ?? { label: `⚠ ${g.status ?? "ללא סטטוס"}`, bg: "#FFF0EE", color: "#C0392B" };
                  return (
                    <tr key={g.id} style={{ background: selectedIds.has(g.id) ? "rgba(201,169,110,0.07)" : undefined }}>
                      <td>
                        <input type="checkbox"
                          checked={selectedIds.has(g.id)}
                          onChange={() => toggleSelect(g.id)}
                          style={{ cursor: "pointer", accentColor: "var(--gold)" }} />
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        <span
                          onClick={() => setProfileGuest(g)}
                          title="הצג פרופיל אורח"
                          style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: "transparent" }}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = "var(--gold)")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = "transparent")}
                        >
                          {g.name}
                        </span>
                        {g.arrival_confirmed && (
                          <span style={{ fontSize: 10, marginRight: 6, background: "#E8F5EF", color: "#1A7A4A", padding: "2px 6px", borderRadius: 8, fontWeight: 700, verticalAlign: "middle" }}>✓ אישר</span>
                        )}
                        <GuestAttentionBadge
                          guest={g}
                          showToast={showToast}
                          onUpdated={(updated) =>
                            setGuests((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
                          }
                        />
                      </td>
                      <td style={{ direction: "ltr", fontSize: 13 }}>{g.phone ?? "—"}</td>
                      <td>{g.room ?? roomByPhone[g.phone]?.roomName ?? "—"}</td>
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
                          {/* ── Slot 1: חדר מוכן — always rendered, never disappears ── */}
                          {g.status === "room_ready" ? (
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "expected")}
                              style={{ background: "#FFF0EE", color: "#C0392B" }}>
                              ↩ בטל חדר מוכן
                            </button>
                          ) : g.status === "checked_in" ? (
                            <button className="btn btn-sm" disabled
                              title="האורח כבר בצ'ק-אין"
                              style={{ background: "#F5F5F5", color: "#AAAAAA", cursor: "not-allowed" }}>
                              ✓ חדר מוכן
                            </button>
                          ) : (
                            <button className="btn btn-sm" disabled={busy === g.id || roomMissing(g) || !canSend}
                              onClick={() => setStatus(g, "room_ready")}
                              title={
                                !canSend ? "שליחה חסומה בשעות שקט — סמן אישור למעלה"
                                  : roomMissing(g) ? "יש לשבץ חדר לפני סימון כמוכן — לחץ ✏️ לעריכה"
                                  : undefined
                              }
                              style={{
                                background: roomMissing(g) || !canSend ? "#F5F5F5" : "#E8F5EF",
                                color:      roomMissing(g) || !canSend ? "#AAAAAA" : "#1A7A4A",
                                cursor:     roomMissing(g) || !canSend ? "not-allowed" : "pointer",
                              }}>
                              ✓ חדר מוכן
                            </button>
                          )}

                          {/* ── Slot 2: צ'ק-אין — always rendered, never disappears ── */}
                          {g.status === "checked_in" ? (
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "expected")}
                              style={{ background: "#FFF5E8", color: "#B5600A", fontWeight: 700 }}>
                              ↩ בטל צ'ק-אין
                            </button>
                          ) : (
                            <button className="btn btn-sm" disabled={busy === g.id || roomMissing(g)}
                              onClick={() => setStatus(g, "checked_in")}
                              title={roomMissing(g) ? "יש לשבץ חדר לפני צ'ק-אין — לחץ ✏️ לעריכה" : undefined}
                              style={{
                                background: roomMissing(g) ? "#F5F5F5" : "#EEF4FF",
                                color:      roomMissing(g) ? "#AAAAAA" : "#2952A3",
                                cursor:     roomMissing(g) ? "not-allowed" : "pointer",
                              }}>
                              🛎️ צ'ק-אין
                            </button>
                          )}

                          {/* Payment button — visible once guest confirmed arrival */}
                          {g.arrival_confirmed && (
                            <button
                              className="btn btn-sm"
                              disabled={paymentBusy === g.id || busy === g.id}
                              onClick={() => handleSendPaymentTemplate(g)}
                              title={(g.direct_payment_url || g.payment_link_url) ? "שלח תבנית תשלום + סדנאות" : "הגדר קישור תשלום לפני שליחה"}
                              style={{
                                background: (g.direct_payment_url || g.payment_link_url) ? "#1B3A32" : "#FFF5E8",
                                color:      (g.direct_payment_url || g.payment_link_url) ? "#fff"    : "#B5600A",
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
