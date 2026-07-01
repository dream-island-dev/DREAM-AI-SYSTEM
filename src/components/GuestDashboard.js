// src/components/GuestDashboard.js  v2
// Guest Pipeline Dashboard — daily tactical view.
//
// Tabs:   כולם | 🏊 בילוי יומי | 👑 לינה
// CRUD:   הוסף אורח ידנית | מחק אורח
// WA:     כפתור "💬" ליד כל טלפון → שלח הודעה ספציפית לאורח
//         כפתור "🏨 חדר מוכן" → pipeline (לינה בלבד)
//
// room_type logic:
//   day_guest         = בילוי יומי
//   premium_day_guest = פרימיום בילוי יומי (Premium Day 1/2 packages)
//   standard          = legacy value (no longer set by UI)
//   suite             = סוויטה / VIP
//
// Auth: RLS — tactical manager sees own rows; GM/super_admin see all.

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import AddGuestModal from "./AddGuestModal";
import GuestAttentionBadge from "./GuestAttentionBadge";
import CustomerProfilePane from "./CustomerProfilePane";
import QuietHoursGate from "./QuietHoursGate";
import { STATUS_META } from "../utils/guestStatusMeta";
import { isSuiteGuestProfile } from "../utils/guestTiming";
import { resolveTimelineScopeForArrival, sortCheckinRosterGuests } from "../utils/guestCheckinMatrix";
import { useQuietHoursSend } from "../hooks/useQuietHoursSend";

// ── Date helpers (local time) ─────────────────────────────────────────────────
function localISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ArrivalBadge({ date }) {
  const base = {
    display: "inline-flex", alignItems: "center",
    padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
  };
  if (date === localISO(0))
    return <span style={{ ...base, background: "#FFF3CD", color: "#856404" }}>היום ⚡</span>;
  if (date === localISO(1))
    return <span style={{ ...base, background: "#E8F0FE", color: "#1A56DB" }}>מחר</span>;
  return <span style={{ ...base, background: "var(--ivory)", color: "var(--text-muted)" }}>{date}</span>;
}

function StatusBadge({ status }) {
  // FAIL VISIBLE (CLAUDE.md §0.3): an unrecognized status must show as a
  // visible warning, not silently fall back to a "looks fine" label.
  const sm = STATUS_META[status] ?? { label: `⚠ ${status ?? "ללא סטטוס"}`, bg: "#FFF0EE", color: "#C0392B" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: sm.bg, color: sm.color,
    }}>
      {sm.label}
    </span>
  );
}

function PipelineStage({ label, done }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 600,
      color: done ? "#1A7A4A" : "var(--text-muted)",
    }}>
      {done ? "✅" : "○"} {label}
    </span>
  );
}

function RoomTypeBadge({ type }) {
  if (type === "day_guest") return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      background: "rgba(37,99,235,0.08)", color: "#1D4ED8", border: "1px solid #BFDBFE",
    }}>🏊 בילוי יומי</span>
  );
  if (type === "premium_day_guest") return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      background: "rgba(234,179,8,0.12)", color: "#92400E", border: "1px solid #FCD34D",
    }}>⭐ פרימיום יומי</span>
  );
  const isSuite = type === "suite" || /suite|סוויט|vip|penthouse/i.test(type ?? "");
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      background: isSuite ? "rgba(201,169,110,0.15)" : "var(--ivory)",
      color:      isSuite ? "var(--gold-dark)"        : "var(--text-muted)",
      border:     `1px solid ${isSuite ? "var(--gold)" : "var(--border)"}`,
    }}>
      {isSuite ? "👑 " : "⚠ "}{type || "standard"}
    </span>
  );
}

// ── WA compose modal ──────────────────────────────────────────────────────────
function WAModal({ guest, onClose, onSend, isSending }) {
  const [msg, setMsg] = useState(
    `שלום ${guest.name}! 👋\nכאן Dream Island — `
  );
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998,
      background: "rgba(0,0,0,0.45)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: "var(--card-bg)", borderRadius: 16, padding: 24,
        width: "100%", maxWidth: 420, boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
        direction: "rtl",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
          💬 הודעה ל{guest.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
          {guest.phone}
        </div>
        <textarea
          autoFocus
          rows={5}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          style={{
            width: "100%", borderRadius: 10, border: "1px solid var(--border)",
            padding: "10px 12px", fontSize: 14, fontFamily: "Heebo, sans-serif",
            direction: "rtl", resize: "vertical", boxSizing: "border-box",
            background: "var(--ivory)",
          }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "10px 20px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo, sans-serif",
              fontSize: 14, color: "var(--text-muted)",
            }}
          >ביטול</button>
          <button
            onClick={() => onSend(msg)}
            disabled={isSending || !msg.trim()}
            style={{
              padding: "10px 24px", borderRadius: 8, border: "none",
              background: isSending ? "#ccc" : "linear-gradient(135deg, var(--gold), var(--gold-dark))",
              color: "#fff", fontFamily: "Heebo, sans-serif", fontWeight: 700,
              fontSize: 14, cursor: isSending ? "default" : "pointer",
            }}
          >
            {isSending ? "⏳ שולח..." : "📤 שלח"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GuestDashboard({ user, onOpenCheckin, onOpenDreamBotChat }) {
  const {
    quietActive,
    overrideChecked,
    setOverrideChecked,
    ensureCanSend,
    canSend,
  } = useQuietHoursSend();

  const [guests,      setGuests]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);
  const [loadingId,   setLoadingId]   = useState(null);  // room_ready pipeline
  const [sendingWAId, setSendingWAId] = useState(null);  // individual WA
  const [deletingId,  setDeletingId]  = useState(null);  // delete

  const [activeTab,   setActiveTab]   = useState("all"); // all | day_guest | suite
  const [addingGuest, setAddingGuest] = useState(null);  // {} = add modal open, null = closed
  const [editingGuest, setEditingGuest] = useState(null); // existing guest object for edit, null = closed
  const [waModal,     setWaModal]     = useState(null);  // guest object or null
  const [selected,    setSelected]    = useState(new Set()); // checked guest IDs
  const [arrivalSelectDate, setArrivalSelectDate] = useState(localISO(0));
  const [profileGuest, setProfileGuest] = useState(null); // guest object or null — CustomerProfilePane

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchGuests = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("guests")
      .select(
        "id, name, phone, room, room_type, arrival_date, departure_date, status, " +
        "msg_pre_arrival_sent, msg_room_ready_sent, msg_post_checkin_sent, " +
        "requires_attention, guest_notes, guest_profile, arrival_time, attention_reason, arrival_confirmed, spa_time, " +
        "meal_time, meal_location, treatment_count, order_number, payment_amount, " +
        "payment_link_url, needs_callback, portal_token, lead_source, automation_muted"
      )
      .order("arrival_date", { ascending: true })
      .order("name",         { ascending: true });
    if (error) showToast("err", "שגיאה בטעינת אורחים: " + error.message);
    else setGuests(data ?? []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);
  // Clear selection when tab or data changes
  useEffect(() => { setSelected(new Set()); }, [activeTab]);

  // ── Mark Room Ready (pipeline — hotel guests only) ────────────────────────
  const markRoomReady = useCallback(async (guest) => {
    if (guest.msg_room_ready_sent || loadingId) return;
    if (!ensureCanSend()) {
      showToast("err", "שליחה חסומה בשעות שקט — סמן את האישור למעלה");
      return;
    }
    setLoadingId(guest.id);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "room_ready", guestId: guest.id },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "שליחת ההודעה נכשלה");
      setGuests((prev) =>
        prev.map((g) => g.id === guest.id ? { ...g, msg_room_ready_sent: true } : g)
      );
      showToast("ok", `✅ הודעת חדר מוכן נשלחה ל${guest.name}${data.simulation ? " (סימולציה)" : ""}`);
    } catch (err) {
      showToast("err", "שגיאה בשליחה: " + (err?.message ?? String(err)));
    } finally {
      setLoadingId(null);
    }
  }, [loadingId, showToast, ensureCanSend]);

  // ── Send WA to a specific guest (free-text via inbox_reply) ─────────────
  const sendWAToGuest = useCallback(async (guest, message) => {
    if (!message?.trim()) return showToast("err", "נא להזין הודעה");
    if (!guest.phone)     return showToast("err", "לאורח זה אין מספר טלפון");
    if (!ensureCanSend()) return showToast("err", "שליחה חסומה בשעות שקט — סמן את האישור למעלה");
    setSendingWAId(guest.id);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { trigger: "inbox_reply", phone: guest.phone, message: message.trim() },
      });
      if (error) throw new Error(data?.error ?? error.message ?? "edge_function_error");
      if (!data?.ok) throw new Error(data?.error ?? "שגיאה בשליחה");
      showToast("ok", `✅ הודעה נשלחה ל${guest.name}${data.simulation ? " (סימולציה)" : ""}`);
      setWaModal(null);
    } catch (err) {
      showToast("err", "שגיאה: " + (err?.message ?? String(err)));
    } finally {
      setSendingWAId(null);
    }
  }, [showToast, ensureCanSend]);

  // ── Delete guest ──────────────────────────────────────────────────────────
  const deleteGuest = useCallback(async (guest) => {
    if (!window.confirm(`מחק את "${guest.name}"?`)) return;
    setDeletingId(guest.id);
    const { error } = await supabase.from("guests").delete().eq("id", guest.id);
    if (error) showToast("err", "שגיאה במחיקה: " + error.message);
    else {
      setGuests((prev) => prev.filter((g) => g.id !== guest.id));
      showToast("ok", `🗑️ ${guest.name} נמחק`);
    }
    setDeletingId(null);
  }, [showToast]);

  // ── Add/edit guest — shared with GuestsPage via AddGuestModal ────────────
  const handleGuestSaved = useCallback((saved) => {
    setGuests((prev) => {
      const exists = prev.some((g) => g.id === saved.id);
      const next = exists
        ? prev.map((g) => (g.id === saved.id ? { ...g, ...saved } : g))
        : [...prev, saved];
      return next.sort((a, b) => {
        if (a.arrival_date !== b.arrival_date)
          return (a.arrival_date ?? "") < (b.arrival_date ?? "") ? -1 : 1;
        return (a.name ?? "").localeCompare(b.name ?? "", "he");
      });
    });
  }, []);

  // ── Selection + bulk delete ───────────────────────────────────────────────
  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const deleteSelected = useCallback(async () => {
    if (!selected.size) return;
    if (!window.confirm(`מחק ${selected.size} אורחים? פעולה זו לא ניתנת לביטול.`)) return;
    const ids = [...selected];
    const { error } = await supabase.from("guests").delete().in("id", ids);
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setGuests((prev) => prev.filter((g) => !ids.includes(g.id)));
    setSelected(new Set());
    showToast("ok", `🗑️ נמחקו ${ids.length} אורחים בהצלחה`);
  }, [selected, showToast]);

  // ── Tab filtering ─────────────────────────────────────────────────────────
  // isDayType: both regular and premium day-pass guests belong in the "יומי" tab.
  const isDayType    = (g) => g.room_type === "day_guest" || g.room_type === "premium_day_guest";
  const dayGuests   = guests.filter(isDayType);
  const hotelGuests = guests.filter((g) => !isDayType(g));
  const tabGuestsRaw = activeTab === "day_guest" ? dayGuests
                    : activeTab === "suite"     ? hotelGuests
                    :                              guests;
  const tabGuests = sortCheckinRosterGuests(tabGuestsRaw, new Date(), (g) => g.room || "");

  const selectGuestsByArrivalDate = useCallback(() => {
    if (!arrivalSelectDate) {
      showToast("err", "בחר תאריך הגעה");
      return;
    }
    const ids = tabGuests
      .filter((g) => g.arrival_date === arrivalSelectDate)
      .map((g) => g.id);
    if (!ids.length) {
      showToast("err", `לא נמצאו אורחים להגעה ב-${arrivalSelectDate}`);
      return;
    }
    setSelected(new Set(ids));
    showToast("ok", `נבחרו ${ids.length} אורחים להגעה ${arrivalSelectDate}`);
  }, [arrivalSelectDate, tabGuests, showToast]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const todayCount     = guests.filter((g) => g.arrival_date === localISO(0)).length;
  const tomorrowCount  = guests.filter((g) => g.arrival_date === localISO(1)).length;
  const roomReadyCount = guests.filter((g) => g.msg_room_ready_sent).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A"  : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {quietActive && (
        <div style={{ marginBottom: 16 }}>
          <QuietHoursGate
            active={quietActive}
            checked={overrideChecked}
            onChange={setOverrideChecked}
          />
        </div>
      )}

      {/* WA compose modal */}
      {waModal && (
        <WAModal
          guest={waModal}
          isSending={sendingWAId === waModal.id}
          onClose={() => setWaModal(null)}
          onSend={(msg) => sendWAToGuest(waModal, msg)}
        />
      )}


      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "היום",        value: todayCount,     color: "#856404", bg: "#FFF3CD" },
          { label: "מחר",         value: tomorrowCount,  color: "#1A56DB", bg: "#E8F0FE" },
          { label: "חדרים מוכנים", value: roomReadyCount, color: "#1A7A4A", bg: "#E8F5EF" },
          { label: "🏊 בילוי יומי", value: dayGuests.length,   color: "#1D4ED8", bg: "rgba(37,99,235,0.07)" },
          { label: "👑 לינה",      value: hotelGuests.length,  color: "var(--gold-dark)", bg: "rgba(201,169,110,0.1)" },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{
            flex: "1 1 80px", padding: "12px 16px", borderRadius: 12,
            background: bg, textAlign: "center",
          }}>
            <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 11, color, fontWeight: 600, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Header row: tabs + add + refresh */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, flex: 1 }}>
          {[
            { key: "all",       label: `כולם (${guests.length})` },
            { key: "day_guest", label: `🏊 יומי (${dayGuests.length})` },
            { key: "suite",     label: `👑 לינה (${hotelGuests.length})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "7px 14px", borderRadius: 20, cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
                border: `2px solid ${activeTab === key ? "var(--gold)" : "var(--border)"}`,
                background: activeTab === key ? "rgba(201,169,110,0.12)" : "var(--card-bg)",
                color: activeTab === key ? "var(--gold-dark)" : "var(--text-muted)",
                transition: "all 0.15s",
              }}
            >{label}</button>
          ))}
        </div>
        {/* Select all checkbox */}
        {tabGuests.length > 0 && (
          <label style={{
            display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer", fontSize: 13, fontWeight: 600,
            color: "var(--text-muted)", userSelect: "none",
          }}>
            <input
              type="checkbox"
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#C0392B" }}
              checked={tabGuests.length > 0 && selected.size === tabGuests.length}
              onChange={() =>
                setSelected(
                  selected.size === tabGuests.length
                    ? new Set()
                    : new Set(tabGuests.map((g) => g.id))
                )
              }
            />
            בחר הכל
          </label>
        )}

        {/* Select all guests arriving on a specific date — then bulk-delete */}
        {tabGuests.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input
              type="date"
              value={arrivalSelectDate}
              onChange={(e) => setArrivalSelectDate(e.target.value)}
              title="תאריך הגעה לבחירה מרובה"
              style={{
                padding: "6px 10px", borderRadius: 10, border: "1px solid var(--border)",
                fontFamily: "Heebo, sans-serif", fontSize: 13, cursor: "pointer",
              }}
            />
            <button
              type="button"
              onClick={selectGuestsByArrivalDate}
              style={{
                padding: "7px 14px", borderRadius: 20, cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
                border: "2px solid var(--gold)", background: "rgba(201,169,110,0.1)",
                color: "var(--gold-dark)",
              }}
            >
              📅 בחר לפי תאריך הגעה
            </button>
          </div>
        )}

        {/* Bulk delete — appears only when selection is active */}
        {selected.size > 0 && (
          <button
            onClick={deleteSelected}
            style={{
              padding: "7px 16px", borderRadius: 20, cursor: "pointer",
              fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              border: "2px solid #DC2626", background: "#FEF2F2", color: "#DC2626",
              animation: "pulse 1s ease-in-out infinite",
            }}
          >
            🗑️ מחק נבחרים ({selected.size})
          </button>
        )}

        {/* Add + Refresh */}
        <>
          <button
            onClick={() => setAddingGuest((g) => (g ? null : {}))}
            style={{
              padding: "7px 16px", borderRadius: 20, cursor: "pointer",
              fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              border: "2px solid var(--gold)",
              background: addingGuest ? "rgba(201,169,110,0.15)" : "var(--card-bg)",
              color: "var(--gold-dark)",
            }}
          >
            {addingGuest ? "✕ סגור" : "➕ הוסף אורח"}
          </button>
          <button
            onClick={fetchGuests}
            disabled={loading}
            style={{
              padding: "7px 14px", borderRadius: 20, cursor: loading ? "default" : "pointer",
              border: "1px solid var(--border)", background: "var(--card-bg)",
              fontSize: 13, fontFamily: "Heebo, sans-serif", color: "var(--text-muted)",
            }}
          >
            {loading ? "⏳" : "🔄"}
          </button>
        </>
      </div>

      {/* Add guest modal — universal AddGuestModal, shared with GuestsPage */}
      {addingGuest && (
        <AddGuestModal
          guest={addingGuest}
          onClose={() => setAddingGuest(null)}
          onSaved={handleGuestSaved}
          showToast={showToast}
          onOpenDreamBotChat={onOpenDreamBotChat}
        />
      )}

      {/* Edit guest modal — same AddGuestModal, receives existing guest object */}
      {editingGuest && (
        <AddGuestModal
          guest={editingGuest}
          onClose={() => setEditingGuest(null)}
          onSaved={handleGuestSaved}
          showToast={showToast}
          onOpenDreamBotChat={onOpenDreamBotChat}
        />
      )}

      {/* Guest profile slide-out — click a guest's name to open */}
      {profileGuest && (
        <CustomerProfilePane
          guest={profileGuest}
          onClose={() => setProfileGuest(null)}
          showToast={showToast}
          onOpenCheckin={onOpenCheckin}
          onOpenDreamBotChat={onOpenDreamBotChat}
          onGuestUpdated={(updated) => {
            setProfileGuest(updated);
            setGuests((prev) => prev.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)));
          }}
        />
      )}

      {/* Guest list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 56, color: "var(--text-muted)", fontSize: 14 }}>
          ⏳ טוען אורחים...
        </div>
      ) : tabGuests.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          border: "1px dashed var(--border)", borderRadius: 14,
          color: "var(--text-muted)", fontSize: 14, lineHeight: 2,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛎️</div>
          אין הגעות בטאב זה להיום ולמחר.
          <br />
          <span style={{ fontSize: 12 }}>לחץ "📥 ייבוא קובץ" כדי לייבא הגעות, או הוסף אורח ידנית.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tabGuests.map((guest) => {
            const isDayGuest = guest.room_type === "day_guest" || guest.room_type === "premium_day_guest";
            const isDeleting = deletingId === guest.id;
            const isLoadingPipeline = loadingId === guest.id;
            const isDone = guest.msg_room_ready_sent;

            return (
              <div
                key={guest.id}
                style={{
                  padding: "14px 16px", borderRadius: 14,
                  border: `1px solid ${
                    selected.has(guest.id) ? "#DC2626"
                    : isDayGuest ? "#BFDBFE"
                    : "var(--border)"
                  }`,
                  background: selected.has(guest.id)
                    ? "#FEF2F2"
                    : isDayGuest ? "rgba(37,99,235,0.03)"
                    : "var(--card-bg)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                  opacity: isDeleting ? 0.5 : 1,
                  transition: "border-color 0.15s, background 0.15s, opacity 0.2s",
                }}
              >
                {/* Row 1: Checkbox + Name + arrival badge + delete */}
                <div style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", marginBottom: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(guest.id)}
                      onChange={() => toggleSelect(guest.id)}
                      style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#DC2626" }}
                    />
                    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--black)" }}>
                      <span
                        onClick={() => setProfileGuest(guest)}
                        title="הצג פרופיל אורח"
                        style={{ cursor: "pointer", textDecoration: "underline", textDecorationColor: "transparent" }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecorationColor = "var(--gold)")}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecorationColor = "transparent")}
                      >
                        {guest.name}
                      </span>
                      {guest.arrival_confirmed && (
                        <span style={{ fontSize: 10, marginRight: 6, background: "#E8F5EF", color: "#1A7A4A", padding: "2px 6px", borderRadius: 8, fontWeight: 700, verticalAlign: "middle" }}>✓ אישר הגעה</span>
                      )}
                      <GuestAttentionBadge
                        guest={guest}
                        showToast={showToast}
                        onOpenDreamBotChat={onOpenDreamBotChat}
                        onUpdated={(updated) =>
                          setGuests((prev) => prev.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)))
                        }
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusBadge status={guest.status} />
                    <ArrivalBadge date={guest.arrival_date} />
                    {isSuiteGuestProfile({ room_type: guest.room_type, room: guest.room }) && onOpenCheckin && (
                      <button
                        type="button"
                        onClick={() => onOpenCheckin({
                          timelineScope: resolveTimelineScopeForArrival(guest.arrival_date),
                        })}
                        title="מעבר ללשונית צ'ק-אין עם מסנן תאריך מתאים"
                        style={{
                          minHeight: 44,
                          padding: "6px 12px",
                          borderRadius: 10,
                          border: "2px solid var(--gold)",
                          background: "linear-gradient(135deg, var(--ivory), rgba(201,169,110,0.2))",
                          color: "var(--gold-dark)",
                          fontFamily: "Heebo, sans-serif",
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        🛎️ צ'ק-אין
                      </button>
                    )}
                    <button
                      onClick={() => setEditingGuest(guest)}
                      disabled={isDeleting}
                      title="ערוך פרטי אורח"
                      style={{
                        width: 28, height: 28, borderRadius: "50%",
                        border: "1px solid var(--gold)", background: "var(--ivory)",
                        cursor: "pointer", fontSize: 13, color: "var(--gold-dark)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 0,
                      }}
                    >✏️</button>
                    <button
                      onClick={() => deleteGuest(guest)}
                      disabled={isDeleting}
                      title="מחק אורח"
                      style={{
                        width: 28, height: 28, borderRadius: "50%",
                        border: "1px solid #FECACA", background: "#FFF5F5",
                        cursor: "pointer", fontSize: 13, color: "#DC2626",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 0,
                      }}
                    >🗑️</button>
                  </div>
                </div>  {/* end row-1 */}

                {/* Row 2: Phone + WA button + room + type badge */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  marginBottom: isDayGuest ? 0 : 10, flexWrap: "wrap",
                }}>
                  {guest.phone ? (
                    <>
                      <a
                        href={`tel:${guest.phone}`}
                        style={{ fontSize: 14, color: "#2563EB", fontWeight: 600, textDecoration: "none" }}
                      >
                        📞 {guest.phone}
                      </a>
                      {/* Individual WA send button */}
                      <button
                        onClick={() => setWaModal(guest)}
                        disabled={sendingWAId === guest.id}
                        title="שלח הודעת WhatsApp"
                        style={{
                          padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                          border: "1px solid #22C55E", background: "#F0FDF4",
                          color: "#15803D", cursor: "pointer",
                        }}
                      >
                        {sendingWAId === guest.id ? "⏳" : "💬 WA"}
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: "#C0392B" }}>ללא טלפון</span>
                  )}
                  {guest.room && (
                    <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                      🚪 {guest.room}
                    </span>
                  )}
                  {guest.departure_date && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                      עד {guest.departure_date}
                    </span>
                  )}
                  {guest.spa_time && (
                    <span style={{ fontSize: 13, color: "#7c3aed", fontWeight: 800 }}>
                      💆 ספא {guest.spa_time}
                    </span>
                  )}
                  <RoomTypeBadge type={guest.room_type} />
                </div>

                {/* Hotel guests only: pipeline + room ready button */}
                {!isDayGuest && (
                  <>
                    <div style={{ display: "flex", gap: 14, marginBottom: 12, marginTop: 10, flexWrap: "wrap" }}>
                      <PipelineStage label="הודעה מקדימה" done={guest.msg_pre_arrival_sent}  />
                      <PipelineStage label="חדר מוכן"     done={guest.msg_room_ready_sent}   />
                      <PipelineStage label="פולו-אפ"       done={guest.msg_post_checkin_sent} />
                    </div>
                    <button
                      onClick={() => markRoomReady(guest)}
                      disabled={isDone || isLoadingPipeline || (!!loadingId && !isLoadingPipeline) || !canSend}
                      title={!canSend ? "שליחה חסומה בשעות שקט" : undefined}
                      style={{
                        width: "100%", padding: "12px 0", borderRadius: 10,
                        fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 700,
                        border: "none", transition: "opacity 0.2s, background 0.2s",
                        cursor: (isDone || isLoadingPipeline || !canSend) ? "default" : "pointer",
                        opacity: (!!loadingId && !isLoadingPipeline && !isDone) || !canSend ? 0.45 : 1,
                        background: isDone
                          ? "#E8F5EF"
                          : isLoadingPipeline
                          ? "#F0F0F0"
                          : "linear-gradient(135deg, var(--gold), var(--gold-dark))",
                        color: isDone ? "#1A7A4A" : isLoadingPipeline ? "var(--text-muted)" : "#fff",
                      }}
                    >
                      {isDone ? "✅ נשלח ✓" : isLoadingPipeline ? "⏳ שולח..." : "🏨 סמן חדר מוכן"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
