// SuitesDashboard.js
// Per-room grid sourced from suite_rooms table (populated by ArrivalImportPanel Suite CSV import).
// Groups rooms by order_number (booking group) and shows individual guest details
// including the phone_source badge (individual vs coordinator extraction).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";

const GUEST_STATUS = {
  pending:    { label: "טרם נקלט", bg: "#F5F5F5", color: "#888888" },
  expected:   { label: "ממתין",    bg: "#FFF5E8", color: "#B5600A" },
  room_ready: { label: "חדר מוכן", bg: "#E8F5EF", color: "#1A7A4A" },
  checked_in: { label: "צ'ק-אין",  bg: "#EEF4FF", color: "#2952A3" },
};

export default function SuitesDashboard() {
  const [date, setDate]               = useState(new Date().toISOString().slice(0, 10));
  const [rooms, setRooms]             = useState([]);
  const [loading, setLoading]         = useState(false);
  const [toast, setToast]             = useState(null);
  const [guestStatus, setGuestStatus] = useState({}); // E.164 phone → { id, status, arrival_confirmed, spa_time, msg_room_ready_sent }
  const [sendingWa, setSendingWa]     = useState(new Set()); // phones currently dispatching room_ready

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("suite_rooms")
      .select("*")
      .eq("arrival_date", date)
      .order("order_number")
      .order("res_line_id");
    if (error) {
      console.error("[SuitesDashboard] load error:", error.message);
    } else {
      const rows = data ?? [];
      setRooms(rows);
      // Fetch live check-in status from guests table (same phone = E.164)
      const phones = [...new Set(rows.map((r) => r.guest_phone).filter(Boolean))];
      if (phones.length) {
        const { data: gd } = await supabase
          .from("guests")
          .select("id, phone, status, arrival_confirmed, spa_time, meal_time, msg_room_ready_sent")
          .in("phone", phones);
        const sm = {};
        for (const g of (gd ?? [])) sm[g.phone] = g;
        setGuestStatus(sm);
      } else {
        setGuestStatus({});
      }
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { load(); }, [load]);

  // Group by order_number for display
  const groups = rooms.reduce((acc, r) => {
    (acc[r.order_number] = acc[r.order_number] ?? []).push(r);
    return acc;
  }, {});

  // TODAY is the authoritative guardrail for dispatch buttons — computed
  // from UTC timestamp for consistency with arrival_date DATE column.
  const today = new Date().toISOString().slice(0, 10);

  const copyPhone = (e164) => {
    if (!e164) return;
    const local = "0" + e164.slice(4);  // "+972501234567" → "0501234567"
    navigator.clipboard?.writeText(local).catch(() => {});
    showToast(`📋 ${local} הועתק`);
  };

  const sendRoomReady = async (phone, guestId) => {
    if (!supabase) return;
    setSendingWa((prev) => new Set([...prev, phone]));
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "room_ready", guestId },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error ?? "שגיאה לא ידועה");
      showToast("✅ הודעת 'חדר מוכן' נשלחה");
      // Optimistically stamp the flag locally so the button flips to ✅ without a reload.
      setGuestStatus((prev) => ({
        ...prev,
        [phone]: { ...prev[phone], msg_room_ready_sent: true },
      }));
    } catch (e) {
      showToast(`❌ שליחה נכשלה: ${e.message}`);
    } finally {
      setSendingWa((prev) => {
        const n = new Set(prev);
        n.delete(phone);
        return n;
      });
    }
  };

  const stats = {
    total:       rooms.length,
    groups:      Object.keys(groups).length,
    individual:  rooms.filter((r) => r.phone_source === "individual").length,
    day:         rooms.filter((r) => r.is_day_guest).length,
  };

  return (
    <div style={{ padding: "0 0 60px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16,
        marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontFamily: "Playfair Display, serif", fontSize: 22,
            color: "var(--gold)", margin: 0 }}>
            🏨 פירוט חדרים — סוויטות
          </h2>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.8 }}>
            {stats.total} חדרים · {stats.groups} הזמנות ·
            <span style={{ color: "#15803D", fontWeight: 700 }}> ✅ {stats.individual} טלפונים אישיים</span>
            {stats.day > 0 && ` · ☀️ ${stats.day} בילוי יומי`}
          </div>
        </div>

        <div style={{ marginRight: "auto", display: "flex", gap: 8, alignItems: "center",
          flexWrap: "wrap" }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
              fontFamily: "Heebo, sans-serif", fontSize: 13, background: "var(--card-bg)",
              color: "var(--black)", cursor: "pointer" }}
          />
          <button
            onClick={load}
            style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--card-bg)", fontFamily: "Heebo, sans-serif",
              fontSize: 13, cursor: "pointer", color: "var(--text-muted)" }}>
            🔄 רענן
          </button>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)", fontSize: 14 }}>
          טוען נתוני חדרים...
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && rooms.length === 0 && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏨</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>
            אין נתוני חדרים לתאריך זה
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
            ייבא קובץ EZGO Suites CSV מ<strong>Data Hub → EZGO → ייבא אורחים</strong>
            <br />הנתונים יופיעו כאן לאחר הייבוא
          </div>
        </div>
      )}

      {/* ── Booking groups ── */}
      {!loading && Object.entries(groups).map(([orderNum, roomList]) => {
        const firstRoom   = roomList[0];
        const isDayOnly   = roomList.every((r) => r.is_day_guest);
        const hasSuite    = roomList.some((r) => !r.is_day_guest);
        const totalAdults = roomList.reduce((s, r) => s + (r.adults || 0), 0);
        const suiteLabel  = (firstRoom.suite_type ?? "")
          .replace(/^סוויטת\s*/i, "")
          .trim();

        return (
          <div key={orderNum} className="card" style={{ marginBottom: 20, overflow: "hidden" }}>

            {/* Group header */}
            <div style={{ display: "flex", alignItems: "center", gap: 14,
              marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{
                background: hasSuite ? "rgba(201,169,110,0.1)" : "var(--ivory)",
                border: `1px solid ${hasSuite ? "rgba(201,169,110,0.35)" : "var(--border)"}`,
                borderRadius: 10, padding: "8px 14px", flexShrink: 0,
              }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: 0.5 }}>הזמנה</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--gold-dark)",
                  fontFamily: "monospace", letterSpacing: 1 }}>
                  {orderNum}
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 15,
                  color: hasSuite ? "var(--gold-dark)" : "var(--text-muted)" }}>
                  {isDayOnly ? "☀️ בילוי יומי" : `🏨 ${suiteLabel || "סוויטה"}`}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.7 }}>
                  {roomList.length} חדרים · {totalAdults} אורחים ·
                  הגעה: <strong>{firstRoom.arrival_date ?? "—"}</strong>
                  {firstRoom.nights > 0 && ` · ${firstRoom.nights} לילות`}
                </div>
              </div>

              <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: hasSuite ? "rgba(201,169,110,0.1)" : "#F1F5F9",
                color: hasSuite ? "var(--gold-dark)" : "#64748B" }}>
                {isDayOnly ? "יומי" : `${firstRoom.nights ?? 0} לילות`}
              </span>
            </div>

            {/* Room cards grid */}
            <div style={{ display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
              {roomList.map((r) => {
                const isIndividual = r.phone_source === "individual";
                // phone_source is "individual" | "coordinator" in practice (ezgoParser.js),
                // but FAIL VISIBLE (CLAUDE.md §0.3): a missing/unexpected value must show
                // as a visible "אחר", not silently get labeled as a real category.
                const sourceLabel =
                  r.phone_source === "individual"  ? "פרטי" :
                  r.phone_source === "coordinator" ? "עסקי" :
                                                      "אחר";
                return (
                  <div key={r.id} style={{
                    border: `1px solid ${isIndividual ? "rgba(22,163,74,0.3)" : "var(--border)"}`,
                    background: isIndividual ? "rgba(22,163,74,0.03)" : "var(--ivory)",
                    borderRadius: 10, padding: "12px 14px",
                  }}>
                    {/* Room number + suite type label */}
                    <div style={{ display: "flex", alignItems: "center",
                      gap: 8, marginBottom: 8 }}>
                      <div style={{ background: "var(--gold)", color: "#0F0F0F", fontWeight: 800,
                        borderRadius: 6, padding: "2px 8px", fontSize: 13,
                        minWidth: 24, textAlign: "center" }}>
                        {r.room_name ?? "?"}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600,
                        flex: 1, lineHeight: 1.3 }}>
                        {r.suite_type}
                      </div>
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, fontWeight: 700,
                        background: isIndividual ? "#DCFCE7" : "#F1F5F9",
                        color: isIndividual ? "#15803D" : "#94A3B8", whiteSpace: "nowrap" }}>
                        {sourceLabel}
                      </span>
                    </div>

                    {/* Guest name */}
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--black)",
                      marginBottom: 7, lineHeight: 1.35 }}>
                      {r.guest_name || "—"}
                    </div>

                    {/* Phone — tap to copy */}
                    {r.guest_phone ? (
                      <button
                        onClick={() => copyPhone(r.guest_phone)}
                        title="העתק מספר"
                        style={{ background: "none", border: "none", cursor: "pointer",
                          padding: 0, display: "flex", alignItems: "center", gap: 6,
                          fontFamily: "monospace", fontSize: 13,
                          color: "var(--gold-dark)", direction: "ltr" }}>
                        📞 {"0" + r.guest_phone.slice(4)}
                      </button>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>ללא טלפון</div>
                    )}

                    {/* Footer: adults + check-in time */}
                    <div style={{ marginTop: 8, display: "flex", gap: 10,
                      fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
                      <span>👥 {r.adults} מבוגרים</span>
                      {r.checkin_time && <span>⏰ {r.checkin_time}</span>}
                      {r.is_day_guest && (
                        <span style={{ color: "#B45309", fontWeight: 700 }}>☀️ יומי</span>
                      )}
                    </div>

                    {/* Live check-in status from guests table */}
                    {(() => {
                      const gs = r.guest_phone ? guestStatus[r.guest_phone] : null;
                      if (!gs) return null;
                      const sm = GUEST_STATUS[gs.status] ?? GUEST_STATUS.pending;
                      return (
                        <div style={{ marginTop: 7, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, fontWeight: 700,
                            background: sm.bg, color: sm.color }}>
                            {sm.label}
                          </span>
                          {gs.arrival_confirmed && (
                            <span style={{ fontSize: 9, color: "#1A7A4A", fontWeight: 700 }}>✓ אישר הגעה</span>
                          )}
                          {gs.spa_time && (
                            <span style={{ fontSize: 9, color: "#7c3aed", fontWeight: 700 }}>💆 {gs.spa_time}</span>
                          )}
                          {gs.meal_time && (
                            <span style={{ fontSize: 9, color: "#B45309", fontWeight: 700 }}>🍽️ {gs.meal_time}</span>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── Room Ready dispatch button — Date guardrail (DNA §0.2 Disable Don't Hide) ── */}
                    {r.guest_phone && (() => {
                      const gs        = guestStatus[r.guest_phone];
                      const isToday   = r.arrival_date === today;
                      const hasGuest  = !!gs?.id;
                      const sent      = !!gs?.msg_room_ready_sent;
                      const sending   = sendingWa.has(r.guest_phone);
                      const isDisabled = !isToday || !hasGuest || sent || sending;

                      let tip = "";
                      if (sent)          tip = "כבר נשלחה הודעת 'חדר מוכן' לאורח זה";
                      else if (!isToday) tip = `שליחה חסומה — הגעת האורח מתוכננת ל-${r.arrival_date || "תאריך לא ידוע"}`;
                      else if (!hasGuest) tip = "אורח לא נמצא בטבלת guests — לא ניתן לשלוח";

                      return (
                        <div style={{ marginTop: 9 }}>
                          <button
                            onClick={() => !isDisabled && sendRoomReady(r.guest_phone, gs.id)}
                            disabled={isDisabled}
                            title={tip}
                            style={{
                              width: "100%",
                              padding: "7px 10px",
                              borderRadius: 8,
                              border: `1px solid ${
                                sent    ? "#16A34A" :
                                isDisabled ? "var(--border)" :
                                "rgba(201,169,110,0.5)"
                              }`,
                              background: sent
                                ? "rgba(22,163,74,0.07)"
                                : isDisabled
                                  ? "var(--ivory)"
                                  : "rgba(201,169,110,0.08)",
                              color: sent
                                ? "#16A34A"
                                : isDisabled
                                  ? "var(--text-muted)"
                                  : "var(--gold-dark)",
                              fontFamily: "Heebo, sans-serif",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: isDisabled ? "not-allowed" : "pointer",
                              opacity: isDisabled && !sent ? 0.55 : 1,
                              transition: "background 0.15s, opacity 0.15s",
                            }}>
                            {sending ? "⏳ שולח..." : sent ? "✅ חדר מוכן נשלח" : "📨 שלח חדר מוכן"}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── Copy toast ── */}
      {toast && (
        <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "#1A1A1A", color: "#fff", padding: "10px 22px", borderRadius: 30,
          fontSize: 13, zIndex: 9999, pointerEvents: "none", whiteSpace: "nowrap" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
