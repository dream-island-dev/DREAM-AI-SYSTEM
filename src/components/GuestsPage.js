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
import {
  CHECKIN_TIMELINE_LABELS,
  CHECKIN_TIMELINE_SCOPES,
  CHECKIN_TIMELINE_TODAY,
  CHECKIN_TIMELINE_TOMORROW,
  CHECKIN_TIMELINE_WEEK7,
  CHECKIN_TIMELINE_ARCHIVE,
  getCheckinRowHighlight,
  matchesCheckinTimelineScope,
  resolveEffectiveGuestStatus,
  shouldAutoCheckoutGuest,
  shouldAutoPromoteToCheckedIn,
  sortCheckinRosterGuests,
} from "../utils/guestCheckinMatrix";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";
import {
  performSuiteCheckIn,
  performSuiteCheckInRevert,
} from "../utils/suiteCheckinSync";

export default function GuestsPage({
  initialTimelineScope = null,
  onTimelineScopeConsumed,
  onOpenDreamBotChat,
  onOpenCheckin,
}) {
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
  const [deleteBusy, setDeleteBusy]     = useState(false);
  const [editGuest,     setEditGuest]    = useState(null);  // {} = new guest, {id,...} = existing
  const [roomByPhone,    setRoomByPhone]    = useState({});  // phone → { roomName, suiteType, isDayGuest } — fallback display only; the room dropdown itself uses SUITE_REGISTRY
  // PMS timeline scope — today | tomorrow | week7 | archive
  const [timelineScope, setTimelineScope] = useState(
    () => initialTimelineScope || CHECKIN_TIMELINE_TODAY,
  );

  useEffect(() => {
    if (!initialTimelineScope) return;
    setTimelineScope(initialTimelineScope);
    onTimelineScopeConsumed?.();
  }, [initialTimelineScope, onTimelineScopeConsumed]);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3500); };

  /** 15:00 auto check-in + departure-day checkout — mirrors whatsapp-cron. */
  const applyReceptionMatrixSync = useCallback(async (guestList) => {
    if (!supabase || !guestList?.length) return guestList;
    const now = new Date();
    let next = guestList;
    let anyChanged = false;

    for (const g of guestList) {
      if (shouldAutoPromoteToCheckedIn(g, now)) {
        const result = await performSuiteCheckIn(supabase, g);
        if (result.ok) {
          next = next.map((x) => (x.id === g.id ? { ...x, ...result.guestPatch } : x));
          anyChanged = true;
        }
      } else if (shouldAutoCheckoutGuest(g, now)) {
        const patch = { status: "checked_out", room_ready_notified: false, msg_room_ready_sent: false };
        const { error } = await supabase.from("guests").update(patch).eq("id", g.id);
        if (!error) {
          next = next.map((x) => (x.id === g.id ? { ...x, ...patch } : x));
          anyChanged = true;
        }
      }
    }
    return anyChanged ? next : guestList;
  }, []);

  const fetchGuests = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("guests")
      .select("*")
      .order("arrival_date", { ascending: true })
      .order("id", { ascending: true });
    if (error) showToast("err", "שגיאה: " + error.message);
    else {
      const synced = await applyReceptionMatrixSync(data ?? []);
      setGuests(synced);
    }
    setLoading(false);
  }, [applyReceptionMatrixSync]);

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

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("guests-page-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, fetchGuests)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchGuests]);

  // Re-evaluate 15:00 gateway + departure checkout every minute.
  useEffect(() => {
    const id = setInterval(() => { fetchGuests(); }, 60_000);
    return () => clearInterval(id);
  }, [fetchGuests]);

  const setStatus = async (guest, status) => {
    if (!supabase) return;
    setBusy(guest.id);

    if (status === "checked_in") {
      const result = await performSuiteCheckIn(supabase, guest);
      if (!result.ok) {
        showToast("err", "שגיאה: " + result.error);
        setBusy(null);
        return;
      }
      setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...result.guestPatch } : g)));
      showToast("ok", result.noRoomLinked
        ? "צ'ק-אין ✓ (לא שובץ חדר בלוח סוויטות)"
        : "צ'ק-אין ✓ — מסונכרן ללוח סוויטות");
      setBusy(null);
      return;
    }

    if (status === "expected" && guest.status === "checked_in") {
      const result = await performSuiteCheckInRevert(supabase, guest);
      if (!result.ok) {
        showToast("err", "שגיאה: " + result.error);
        setBusy(null);
        return;
      }
      setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, ...result.guestPatch } : g)));
      showToast("ok", result.revertStatus === "room_ready" ? "הוחזר לחדר מוכן ↩" : "הוחזר לממתין ↩");
      setBusy(null);
      return;
    }

    const patch = { status };
    if (status === "expected") patch.checkin_time = null;
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

  const roomNameFor = useCallback(
    (g) => g.room || roomByPhone[g.phone]?.roomName || "",
    [roomByPhone],
  );

  // ── Reception matrix filters — PMS timeline scopes ─────────────────────
  const suiteGuests = guests.filter((g) => isSuite(g));
  const scopeCounts = Object.fromEntries(
    CHECKIN_TIMELINE_SCOPES.map((scope) => [
      scope,
      suiteGuests.filter((g) => matchesCheckinTimelineScope(g, scope)).length,
    ]),
  );
  const displayGuests = sortCheckinRosterGuests(
    suiteGuests.filter((g) => matchesCheckinTimelineScope(g, timelineScope)),
    new Date(),
    roomNameFor,
  );

  // ── Bulk delete selected guests (same pattern as GuestDashboard.js) ────────
  const handleDeleteSelected = async () => {
    if (!selectedIds.size || !supabase) return;
    const ids = [...selectedIds];
    if (!window.confirm(`מחק ${ids.length} אורחים שנבחרו?\nפעולה זו לא ניתנת לביטול.`)) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.from("guests").delete().in("id", ids);
      if (error) throw error;
      setGuests((prev) => prev.filter((g) => !ids.includes(g.id)));
      setSelectedIds(new Set());
      showToast("ok", `🗑️ נמחקו ${ids.length} אורחים בהצלחה`);
    } catch (e) {
      showToast("err", "שגיאה במחיקה: " + (e?.message ?? e));
    } finally {
      setDeleteBusy(false);
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
          onOpenDreamBotChat={onOpenDreamBotChat}
        />
      )}

      {/* ── Read-only profile drawer (nights/checkout/portal link) — same
          component + click pattern as GuestDashboard.js's "ניהול אורחים" ── */}
      {profileGuest && (
        <CustomerProfilePane
          guest={profileGuest}
          onClose={() => setProfileGuest(null)}
          showToast={showToast}
          onOpenDreamBotChat={onOpenDreamBotChat}
          onGuestUpdated={(updated) => {
            setProfileGuest(updated);
            setGuests((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
          }}
          onOpenCheckin={onOpenCheckin}
        />
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

      <div style={{ marginBottom: 14 }}>
        <div
          role="tablist"
          aria-label="מסנן צ'ק-אין"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            padding: "10px 12px",
            background: "var(--ivory, #F5F0E8)",
            borderRadius: 12,
            border: "1px solid var(--border, #E0D5C5)",
          }}
        >
          {CHECKIN_TIMELINE_SCOPES.map((scope) => {
            const active = timelineScope === scope;
            const count = scopeCounts[scope] ?? 0;
            return (
              <button
                key={scope}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTimelineScope(scope);
                  setSelectedIds(new Set());
                }}
                style={{
                  minHeight: 44,
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: active ? "2px solid var(--gold, #C9A96E)" : "1.5px solid var(--border, #E0D5C5)",
                  background: active
                    ? "linear-gradient(135deg, rgba(201,169,110,0.28), rgba(232,201,138,0.35))"
                    : "var(--card-bg, #fff)",
                  color: active ? "var(--gold-dark, #A8843A)" : "var(--text-muted, #666)",
                  fontFamily: "Heebo, sans-serif",
                  fontSize: 13,
                  fontWeight: active ? 800 : 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <span>{CHECKIN_TIMELINE_LABELS[scope]}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 20,
                    background: active ? "rgba(15,15,15,0.08)" : "var(--ivory, #F5F0E8)",
                    color: active ? "#0F0F0F" : "var(--text-muted)",
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {timelineScope !== CHECKIN_TIMELINE_ARCHIVE && (
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1A7A4A", display: "inline-block" }} />
              בחדר (checked_in)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#C9A96E", display: "inline-block" }} />
              הגעה מתוכננת
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2952A3", display: "inline-block" }} />
              חדר מוכן
            </span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {displayGuests.length} אורחים · {CHECKIN_TIMELINE_LABELS[timelineScope]}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: "rgba(201,169,110,0.15)", color: "var(--gold-dark)",
            border: "1px solid var(--gold)",
          }}>👑 סוויטות בלבד</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={deleteBusy}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "2px solid #DC2626",
                background: deleteBusy ? "var(--ivory)" : "#FEF2F2", color: "#DC2626",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700, cursor: deleteBusy ? "not-allowed" : "pointer",
              }}>
              {deleteBusy ? "⏳ מוחק..." : `🗑️ מחק נבחרים (${selectedIds.size})`}
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
          {timelineScope === CHECKIN_TIMELINE_ARCHIVE
            ? "אין אורחי סוויטות בארכיון לאחר שהות."
            : timelineScope === CHECKIN_TIMELINE_TOMORROW
            ? "אין הגעות מתוכננות למחר — בדוק ב«7 ימים קרובים» או ייבא הגעות."
            : timelineScope === CHECKIN_TIMELINE_WEEK7
            ? "אין הגעות מתוכננות ב-7 הימים הקרובים."
            : "אין אורחים פעילים להיום — ייבא הגעות דרך \"תפעול ואחזקה\" או הוסף אורח ידנית."}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ width: "100%", overflowX: "hidden" }}>
            <table className="table" style={{ width: "100%", tableLayout: "fixed" }}>
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
                  const effectiveStatus = resolveEffectiveGuestStatus(g);
                  const sm = STATUS_META[effectiveStatus] ?? STATUS_META[g.status] ?? { label: `⚠ ${g.status ?? "ללא סטטוס"}`, bg: "#FFF0EE", color: "#C0392B" };
                  const rowStatus = g.status;
                  const rowHi = getCheckinRowHighlight(g);
                  const rowBg = selectedIds.has(g.id)
                    ? "rgba(201,169,110,0.12)"
                    : rowHi.bg;
                  return (
                    <tr
                      key={g.id}
                      title={rowHi.title ?? undefined}
                      style={{ background: rowBg }}
                    >
                      <td>
                        <input type="checkbox"
                          checked={selectedIds.has(g.id)}
                          onChange={() => toggleSelect(g.id)}
                          style={{ cursor: "pointer", accentColor: "var(--gold)" }} />
                      </td>
                      <td style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {rowHi.dot && (
                          <span
                            aria-hidden
                            title={rowHi.title ?? undefined}
                            style={{
                              display: "inline-block",
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: rowHi.dot,
                              marginLeft: 6,
                              verticalAlign: "middle",
                              flexShrink: 0,
                            }}
                          />
                        )}
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
                          onOpenDreamBotChat={onOpenDreamBotChat}
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
                          onClick={rowStatus === "checked_in" ? () => setStatus(g, "expected") : undefined}
                          onMouseEnter={rowStatus === "checked_in" ? () => setBadgeHover(g.id) : undefined}
                          onMouseLeave={rowStatus === "checked_in" ? () => setBadgeHover(null) : undefined}
                          title={rowStatus === "checked_in" ? "לחץ לביטול צ'ק-אין" : undefined}
                          style={{
                            padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                            background: badgeHover === g.id ? "#FFF0EE" : sm.bg,
                            color:      badgeHover === g.id ? "#C0392B" : sm.color,
                            cursor: rowStatus === "checked_in" ? "pointer" : "default",
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
                          {rowStatus === "room_ready" ? (
                            <button className="btn btn-sm" disabled={busy === g.id}
                              onClick={() => setStatus(g, "expected")}
                              style={{ background: "#FFF0EE", color: "#C0392B" }}>
                              ↩ בטל חדר מוכן
                            </button>
                          ) : rowStatus === "checked_in" ? (
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
                          {rowStatus === "checked_in" ? (
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
