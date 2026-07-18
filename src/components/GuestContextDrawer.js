// GuestContextDrawer — single unified guest profile drawer (session merge:
// absorbs CustomerProfilePane.js's Smart Guest Profile / guest_alerts / check-in
// hand-off / portal stats). Opened from WhatsAppInbox roster+thread AND from the
// 👤 icon in GuestsPage/GuestDashboard — one component, one guests-row shape.
// Fetches fresh guests row + recent tasks; AddGuestModal is the unified edit surface.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { getGuestTimingBadge, isSuiteGuestProfile } from "../utils/guestTiming";
import { resolveTimelineScopeForArrival } from "../utils/guestCheckinMatrix";
import { formatSpaSchedule } from "../utils/israeliTime";
import { getProfileDisplayChips, hasMeaningfulProfile } from "../data/guestProfileSchema";
import GuestJourneyTimeline from "./GuestJourneyTimeline";
import AddGuestModal from "./AddGuestModal";
import GuestAttentionBadge from "./GuestAttentionBadge";
import MissingDepartureBadge from "./MissingDepartureBadge";
import { fetchGuestSuiteRooms } from "../utils/guestStaySummary";
import {
  mergeGuestProfileSelectedRoom,
  resolveEffectiveSelectedSuiteRoom,
  suiteRoomCanonicalLabel,
  writeSelectedSuiteRoomSession,
} from "../utils/guestSelectedSuiteRoom";
import { ensureMissingDepartureAlert } from "../utils/departureDateGuard";

const COLOR_FLAGS = [
  { value: "", label: "ללא סימון", bg: "var(--ivory)", fg: "var(--text-muted)" },
  { value: "red", label: "🔴 אדום", bg: "#FEE2E2", fg: "#B91C1C" },
  { value: "yellow", label: "🟡 צהוב", bg: "#FEF9C3", fg: "#A16207" },
  { value: "green", label: "🟢 ירוק", bg: "#DCFCE7", fg: "#15803D" },
  { value: "blue", label: "🔵 כחול", bg: "#DBEAFE", fg: "#1D4ED8" },
];

const TASK_STATUS_META = {
  open: { label: "פתוח", bg: "#FEE2E2", fg: "#B91C1C" },
  in_progress: { label: "בטיפול", bg: "#FEF9C3", fg: "#A16207" },
  done: { label: "בוצע", bg: "#DCFCE7", fg: "#15803D" },
};

const ALERT_TYPE_META = {
  complaint:           { label: "🔴 תקלה",        bg: "#FFF0EE", color: "#C0392B" },
  date_change_request: { label: "🗓️ שינוי תאריך", bg: "#E8F0FE", color: "#1A56DB" },
  request:             { label: "📝 בקשה",         bg: "#FFF5E8", color: "#B5600A" },
  upsell_opportunity:  { label: "🌴 מהפורטל",     bg: "#E8F5EF", color: "#1A7A4A" },
  missing_departure_date: { label: "⚠️ חסר עזיבה", bg: "#FEF2F2", color: "#B91C1C" },
};

function alertTypeMeta(alertType) {
  return ALERT_TYPE_META[alertType] ?? {
    label: `⚠ ${alertType ?? "ללא סוג"}`,
    bg: "#F5F5F5",
    color: "#888888",
  };
}

function fmtAlertTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : `${d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
}

const DEFAULT_CHECKOUT_TIME = "11:00";

function nightsBetween(arrivalDate, departureDate) {
  if (!arrivalDate || !departureDate) return null;
  const ms = new Date(departureDate).getTime() - new Date(arrivalDate).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.round(ms / 86400000);
}

function phoneVariants(bare) {
  const digits = (bare ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const noPlus = digits.startsWith("972") ? digits : `972${digits.replace(/^0/, "")}`;
  return [...new Set([`+${noPlus}`, noPlus, `0${noPlus.slice(3)}`])];
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(`${d}T12:00:00`).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{
        margin: "0 0 10px", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
        color: "var(--gold-dark, #A8843A)", textTransform: "uppercase",
      }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function GuestContextDrawer({
  contact,
  user,
  claimedByName,
  onClose,
  onGuestUpdated,
  onToggleClaim,
  claimBusy,
  onOpenCheckin,
  onOpenDreamBotChat,
  autoOpenEdit = false,
  onAutoOpenEditConsumed,
}) {
  const [guest, setGuest] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [internalNotes, setInternalNotes] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [muteSaving, setMuteSaving] = useState(false);
  const [colorSaving, setColorSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [queueRows, setQueueRows] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [checkoutTime, setCheckoutTime] = useState(null);
  const [loadingCheckout, setLoadingCheckout] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [guestAlerts, setGuestAlerts] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [showResolvedAlerts, setShowResolvedAlerts] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [suiteRooms, setSuiteRooms] = useState([]);
  const [selectedSuiteRoom, setSelectedSuiteRoom] = useState("");
  const [roomPickSaving, setRoomPickSaving] = useState(false);

  const showToast = useCallback((msg, isErr = false) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 2800);
  }, []);

  // Adapter — GuestProfileModal/GuestAttentionBadge expect showToast(type, msg)
  // (same contract as CustomerProfilePane's parent-supplied prop); this drawer
  // manages its own toast internally, so no new prop is required from any of
  // the three call sites.
  const showToastCompat = useCallback((type, msg) => {
    showToast(msg, type === "err");
  }, [showToast]);

  const loadData = useCallback(async () => {
    if (!contact?.phone || !supabase) return;
    setLoading(true);
    setLoadError(null);
    try {
      const variants = phoneVariants(contact.phone);
      const { data: g, error: gErr } = await supabase
        .from("guests")
        .select(
          "id, name, phone, room, room_type, status, arrival_date, departure_date, " +
          "claimed_by, claimed_at, automation_muted, staff_color_label, internal_notes, " +
          "spa_time, spa_date, treatment_count, order_number, payment_amount, payment_link_url, " +
          "meal_plan, meal_location, breakfast_time, lunch_time, dinner_time, meal_time, " +
          "arrival_time, needs_callback, requires_attention, attention_reason, lead_source, " +
          "portal_token, arrival_confirmed, guest_profile, guest_notes, " +
          "msg_pre_arrival_2d_sent, msg_stage_2_arrival_sent, msg_pre_arrival_sent, " +
          "msg_morning_suite_sent, msg_morning_welcome_sent, msg_mid_stay_sent, msg_checkout_fb_sent"
        )
        .in("phone", variants)
        .limit(1)
        .maybeSingle();
      if (gErr) throw gErr;

      const row = g ?? {
        name: contact.guestName || contact.pushName || null,
        phone: contact.phone.startsWith("+") ? contact.phone : `+${contact.phone}`,
        room: contact.room ?? null,
        status: contact.status ?? null,
        arrival_date: contact.arrivalDate ?? null,
        departure_date: contact.departureDate ?? null,
        claimed_by: contact.claimedBy ?? null,
        automation_muted: false,
        staff_color_label: null,
        internal_notes: "",
        portal_token: contact.portalToken ?? null,
        guest_profile: null,
        guest_notes: "",
        arrival_confirmed: false,
      };
      setGuest(row);
      setInternalNotes(row.internal_notes ?? "");
      setSelectedSuiteRoom(resolveEffectiveSelectedSuiteRoom({
        guestProfile: row.guest_profile,
        guestId: row.id,
        phone: row.phone || contact.phone,
        fallbackRoom: row.room,
      }) ?? "");
      if (row.id) {
        fetchGuestSuiteRooms(supabase, row).then(setSuiteRooms).catch(() => setSuiteRooms([]));
        ensureMissingDepartureAlert(supabase, row).catch(() => {});
      } else {
        setSuiteRooms([]);
      }

      setQueueRows([]);
      if (row.id && supabase) {
        try {
          const { data: qData } = await supabase.functions.invoke("automation-queue");
          if (qData?.ok && Array.isArray(qData.queue)) {
            setQueueRows(qData.queue.filter((q) => q.guestId === row.id));
          }
        } catch {
          /* queue preview optional */
        }
      }

      let taskRows = [];
      const phoneBare = (contact.phone ?? "").replace(/^\+/, "");
      if (row.id) {
        const { data: byGuest, error: tErr } = await supabase
          .from("tasks")
          .select("id, status, description, created_at, department, guest_id")
          .or(`guest_id.eq.${row.id},description.ilike.%${phoneBare}%`)
          .order("created_at", { ascending: false })
          .limit(5);
        if (tErr) throw tErr;
        taskRows = byGuest ?? [];
      } else if (phoneBare) {
        const { data: byPhone, error: tErr } = await supabase
          .from("tasks")
          .select("id, status, description, created_at, department, guest_id")
          .ilike("description", `%${phoneBare}%`)
          .order("created_at", { ascending: false })
          .limit(5);
        if (tErr) throw tErr;
        taskRows = byPhone ?? [];
      }
      setTasks(taskRows);
    } catch (e) {
      setLoadError(e?.message ?? "שגיאה בטעינת נתוני אורח");
    } finally {
      setLoading(false);
    }
  }, [contact]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (autoOpenEdit && guest?.id && !loading) {
      setEditOpen(true);
      onAutoOpenEditConsumed?.();
    }
  }, [autoOpenEdit, guest?.id, loading, onAutoOpenEditConsumed]);

  const openFullEdit = useCallback(() => {
    if (guest?.id) setEditOpen(true);
  }, [guest?.id]);

  const patchGuest = async (patch) => {
    if (!guest?.id) {
      showToast("אין פרופיל אורח ב-DB — צור פרופיל דרך ✏️ לפני עדכון", true);
      return null;
    }
    const { data, error } = await supabase
      .from("guests")
      .update(patch)
      .eq("id", guest.id)
      .select(
        "id, name, phone, room, room_type, status, arrival_date, departure_date, " +
        "claimed_by, claimed_at, automation_muted, staff_color_label, internal_notes, guest_notes, guest_profile"
      )
      .maybeSingle();
    if (error) throw error;
    setGuest((prev) => ({ ...prev, ...data }));
    onGuestUpdated?.(data);
    return data;
  };

  const handleSaveNotes = async () => {
    setNotesSaving(true);
    try {
      await patchGuest({ internal_notes: internalNotes.trim() || null });
      showToast("✓ הערות נשמרו");
    } catch (e) {
      showToast(e?.message ?? "שגיאה בשמירה", true);
    } finally {
      setNotesSaving(false);
    }
  };

  const handleColorChange = async (value) => {
    setColorSaving(true);
    try {
      await patchGuest({ staff_color_label: value || null });
      showToast("✓ סימון צבע עודכן");
    } catch (e) {
      showToast(e?.message ?? "שגיאה בעדכון סימון", true);
    } finally {
      setColorSaving(false);
    }
  };

  const handleAutomationMute = async () => {
    if (!guest) return;
    setMuteSaving(true);
    try {
      await patchGuest({ automation_muted: !guest.automation_muted });
      showToast(guest.automation_muted ? "✓ אוטומציה הופעלה מחדש" : "🔇 אוטומציה הושתקה");
    } catch (e) {
      showToast(e?.message ?? "שגיאה בעדכון השתקה", true);
    } finally {
      setMuteSaving(false);
    }
  };

  const handleClaimToggle = async () => {
    if (!onToggleClaim) return;
    const claim = guest?.claimed_by !== user?.id;
    await onToggleClaim(contact, claim);
    await loadData();
  };

  const suiteRoomLabels = [...new Set((suiteRooms ?? []).map(suiteRoomCanonicalLabel).filter(Boolean))];
  const showSuiteRoomPicker = suiteRoomLabels.length > 1;

  const handleSuiteRoomPick = async (roomLabel) => {
    if (!guest?.id) return;
    setSelectedSuiteRoom(roomLabel);
    writeSelectedSuiteRoomSession(guest.id, guest.phone, roomLabel);
    setRoomPickSaving(true);
    try {
      const nextProfile = mergeGuestProfileSelectedRoom(guest.guest_profile, roomLabel);
      const updated = await patchGuest({ guest_profile: nextProfile });
      if (updated) {
        onGuestUpdated?.({ ...updated, selectedSuiteRoom: roomLabel });
        showToast(roomLabel ? `✓ חדר פעיל: ${roomLabel}` : "✓ בחירת חדר נוקתה");
      }
    } catch (e) {
      showToast(e?.message ?? "שגיאה בשמירת חדר", true);
    } finally {
      setRoomPickSaving(false);
    }
  };

  const handleProfileUpdated = (updated) => {
    setGuest((prev) => ({ ...prev, ...updated }));
    onGuestUpdated?.(updated);
  };

  async function copyPortalLink() {
    if (!guest?.portal_token) return;
    const url = `${window.location.origin}/portal/${guest.portal_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      window.prompt("העתיקו את הקישור לפורטל האורח:", url);
    }
  }

  // Checkout time — same suite_rooms lookup CustomerProfilePane used.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingCheckout(true);
      if (supabase && guest?.phone) {
        const { data } = await supabase
          .from("suite_rooms")
          .select("checkout_time")
          .eq("guest_phone", guest.phone)
          .not("checkout_time", "is", null)
          .limit(1)
          .maybeSingle();
        if (active) setCheckoutTime(data?.checkout_time ?? null);
      }
      if (active) setLoadingCheckout(false);
    })();
    return () => { active = false; };
  }, [guest?.phone]);

  // Guest requests/alerts (guest_alerts) — same id+phone-variant merge CustomerProfilePane used.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase || (!guest?.id && !guest?.phone)) {
        if (active) { setGuestAlerts([]); setLoadingAlerts(false); }
        return;
      }
      setLoadingAlerts(true);
      const select = "id, alert_type, message, resolved, resolved_at, resolution_notes, created_at";
      const variants = phoneVariants(guest.phone);
      const byId = guest.id
        ? await supabase.from("guest_alerts").select(select).eq("guest_id", guest.id).order("created_at", { ascending: false }).limit(25)
        : { data: [], error: null };
      const byPhone = variants.length
        ? await supabase.from("guest_alerts").select(select).in("phone", variants).order("created_at", { ascending: false }).limit(25)
        : { data: [], error: null };
      if (!active) return;
      if (byId.error || byPhone.error) {
        console.warn("[GuestContextDrawer] guest_alerts:", byId.error?.message || byPhone.error?.message);
        setGuestAlerts([]);
      } else {
        const seen = new Set();
        const merged = [...(byId.data ?? []), ...(byPhone.data ?? [])]
          .filter((row) => {
            if (seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 25);
        setGuestAlerts(merged);
      }
      setLoadingAlerts(false);
    })();
    return () => { active = false; };
  }, [guest?.id, guest?.phone]);

  const displayName = guest?.name || contact?.guestName || contact?.pushName || "אורח";
  const timingBadge = guest ? getGuestTimingBadge(guest) : null;
  const colorMeta = COLOR_FLAGS.find((c) => c.value === (guest?.staff_color_label ?? "")) ?? COLOR_FLAGS[0];
  const isClaimedByMe = guest?.claimed_by === user?.id;
  const isClaimed = !!guest?.claimed_by;

  const nights = guest ? nightsBetween(guest.arrival_date, guest.departure_date) : null;
  const effectiveCheckoutTime = checkoutTime || DEFAULT_CHECKOUT_TIME;
  const profileChips = guest ? getProfileDisplayChips(guest.guest_profile, guest.arrival_time) : [];
  const systemNotes = typeof guest?.guest_notes === "string" ? guest.guest_notes.trim() : "";
  const visibleAlerts = showResolvedAlerts ? guestAlerts : guestAlerts.filter((a) => !a.resolved);
  const openAlertCount = guestAlerts.filter((a) => !a.resolved).length;

  return (
    <div
      onClick={() => onClose?.()}
      style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.32)",
        direction: "ltr",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <style>{`@keyframes gcd-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, height: "100%",
          background: "var(--card-bg, #fff)",
          boxShadow: "-10px 0 40px rgba(0,0,0,0.18)",
          direction: "rtl",
          overflowY: "auto",
          animation: "gcd-drawer-in 0.22s ease-out",
          display: "flex", flexDirection: "column",
        }}
      >
        <header style={{
          padding: "18px 20px 14px", borderBottom: "1px solid var(--border)",
          background: "linear-gradient(135deg, var(--sidebar-bg, #0F0F0F) 0%, #1B4D3E 100%)",
          color: "#fff", position: "sticky", top: 0, zIndex: 2,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 4 }}>פרופיל אורח · הקשר 360°</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.25 }}>{displayName}</span>
                {guest && (
                  <GuestAttentionBadge
                    guest={guest}
                    onUpdated={handleProfileUpdated}
                    showToast={showToastCompat}
                    onOpenDreamBotChat={onOpenDreamBotChat}
                    onOpenFullEdit={openFullEdit}
                  />
                )}
                {guest?.arrival_confirmed && (
                  <span style={{
                    fontSize: 10, background: "rgba(255,255,255,0.18)", color: "#fff",
                    padding: "2px 7px", borderRadius: 8, fontWeight: 700,
                  }}>✓ אישר הגעה</span>
                )}
                {guest && <MissingDepartureBadge guest={guest} style={{ background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)" }} />}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, direction: "ltr", textAlign: "right" }}>
                {guest?.phone || contact?.phone}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="סגור"
              style={{
                border: "none", background: "rgba(255,255,255,0.15)", color: "#fff",
                width: 36, height: 36, borderRadius: 8, cursor: "pointer", fontSize: 18, flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
          {guest?.id && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {onOpenDreamBotChat && guest.phone && (
                <button
                  type="button"
                  onClick={() => onOpenDreamBotChat({ phone: guest.phone, guestName: guest.name })}
                  style={{
                    flex: 1, minWidth: 120, padding: "8px 12px", borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.12)",
                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    fontFamily: "Heebo, sans-serif",
                  }}
                >
                  💬 צ'אט
                </button>
              )}
              <button
                type="button"
                onClick={openFullEdit}
                style={{
                  flex: 1, minWidth: 120, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid var(--gold)", background: "rgba(201,169,110,0.25)",
                  color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer",
                  fontFamily: "Heebo, sans-serif",
                }}
              >
                ✏️ ערוך פרופיל
              </button>
            </div>
          )}
        </header>

        <div style={{ padding: "18px 20px 28px", flex: 1 }}>
          {loading && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>טוען…</div>
          )}
          {loadError && (
            <div style={{
              background: "#FEE2E2", color: "#B91C1C", padding: 12, borderRadius: 8,
              fontSize: 13, marginBottom: 16,
            }}>
              {loadError}
            </div>
          )}
          {!loading && !loadError && (
            <>
              <Section title="פרטי שהייה">
                <div style={{
                  background: "var(--ivory)", borderRadius: 12, padding: 14,
                  border: "1px solid var(--border)",
                }}>
                  <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--text-muted)" }}>חדר / סוויטה</span>
                      <strong>{guest?.room || "—"}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--text-muted)" }}>הגעה</span>
                      <strong>{fmtDate(guest?.arrival_date)}</strong>
                    </div>
                    {guest?.arrival_time && (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ color: "var(--text-muted)" }}>שעת הגעה (ETA)</span>
                        <strong style={{ direction: "ltr" }}>🕐 {guest.arrival_time}</strong>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--text-muted)" }}>עזיבה</span>
                      <strong style={{ color: !guest?.departure_date && isSuiteGuestProfile(guest) ? "#B91C1C" : undefined }}>
                        {fmtDate(guest?.departure_date)}
                      </strong>
                    </div>
                    {showSuiteRoomPicker && (
                      <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)", marginBottom: 6 }}>
                          🚪 חדר פעיל לבקשות / קריאות
                        </div>
                        <select
                          value={selectedSuiteRoom}
                          disabled={roomPickSaving}
                          onChange={(e) => handleSuiteRoomPick(e.target.value)}
                          style={{
                            width: "100%", padding: "10px 12px", borderRadius: 10,
                            border: "1px solid var(--border)", fontFamily: "Heebo, sans-serif", fontSize: 14,
                          }}
                        >
                          <option value="">— בחר סוויטה —</option>
                          {suiteRoomLabels.map((label) => (
                            <option key={label} value={label}>{label}</option>
                          ))}
                        </select>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                          בחירה זו תישמר לשיחה הנוכחית ותעבור לקריאות תפעול.
                        </div>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "var(--text-muted)" }}>סטטוס שהייה</span>
                      {timingBadge ? (
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                          background: timingBadge.bg, color: timingBadge.color,
                          border: `1px solid ${timingBadge.border}`,
                        }}>
                          {timingBadge.label}
                        </span>
                      ) : (
                        <strong>⚠ {guest?.status ?? "לא ידוע"}</strong>
                      )}
                    </div>
                    {(guest?.spa_time || guest?.spa_date) && (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ color: "var(--text-muted)" }}>ספא</span>
                        <strong>{formatSpaSchedule(guest.spa_date, guest.spa_time) ?? "—"}</strong>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  <div style={{ background: "var(--ivory)", borderRadius: 10, padding: "10px 8px", textAlign: "center", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold-dark)" }}>
                      {nights != null ? nights : "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>סה״כ לילות</div>
                  </div>
                  <div style={{ background: "var(--ivory)", borderRadius: 10, padding: "10px 8px", textAlign: "center", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold-dark)" }}>
                      {loadingCheckout ? "⏳" : effectiveCheckoutTime}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>שעת צ׳ק-אאוט</div>
                  </div>
                </div>

                {onOpenCheckin && isSuiteGuestProfile({ room_type: guest?.room_type, room: guest?.room }) && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenCheckin({ timelineScope: resolveTimelineScopeForArrival(guest?.arrival_date) });
                      onClose?.();
                    }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      width: "100%", marginTop: 10, minHeight: 44, padding: "10px 12px", borderRadius: 10,
                      border: "2px solid var(--gold)",
                      background: "linear-gradient(135deg, var(--ivory), rgba(201,169,110,0.22))",
                      color: "var(--gold-dark)",
                      fontSize: 13, fontWeight: 800, fontFamily: "Heebo, sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    🛎️ מעבר לצ'ק-אין
                  </button>
                )}

                <button
                  type="button"
                  onClick={copyPortalLink}
                  disabled={!guest?.portal_token}
                  title={!guest?.portal_token ? "אין קישור פורטל לאורח זה" : undefined}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    width: "100%", marginTop: 10, padding: "9px 12px", borderRadius: 10,
                    border: `1px solid ${linkCopied ? "#16A34A" : "var(--gold)"}`,
                    background: linkCopied ? "#ECFDF5" : "var(--ivory)",
                    color: linkCopied ? "#16A34A" : "var(--gold-dark)",
                    fontSize: 13, fontWeight: 700, fontFamily: "Heebo, sans-serif",
                    cursor: guest?.portal_token ? "pointer" : "not-allowed",
                    opacity: guest?.portal_token ? 1 : 0.5,
                  }}
                >
                  {linkCopied ? "✓ הקישור הועתק" : "🔗 העתק קישור לפורטל האורח"}
                </button>
                <button
                  type="button"
                  onClick={() => window.open(`${window.location.origin}/portal/${guest?.portal_token}`, "_blank", "noopener,noreferrer")}
                  disabled={!guest?.portal_token}
                  title={!guest?.portal_token ? "אין קישור פורטל לאורח זה" : undefined}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    width: "100%", marginTop: 8, padding: "9px 12px", borderRadius: 10,
                    border: "1px solid var(--gold)",
                    background: "var(--ivory)",
                    color: "var(--gold-dark)",
                    fontSize: 13, fontWeight: 700, fontFamily: "Heebo, sans-serif",
                    cursor: guest?.portal_token ? "pointer" : "not-allowed",
                    opacity: guest?.portal_token ? 1 : 0.5,
                  }}
                >
                  👁️ צפה בפורטל האישי
                </button>
              </Section>

              <Section title="📋 פרופיל אורח">
                <div style={{
                  background: "var(--ivory)", borderRadius: 12, padding: "12px 14px",
                  border: "1px solid var(--border)",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: profileChips.length ? 10 : 0,
                  }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>תגיות VIP / אירוע / תזונה / הגעה</span>
                    <button
                      type="button"
                      onClick={openFullEdit}
                      disabled={!guest?.id}
                      title={!guest?.id ? "צור פרופיל דרך עריכה לפני הוספת תגיות" : undefined}
                      style={{
                        padding: "4px 10px", borderRadius: 8, border: "1px solid var(--gold)",
                        background: "rgba(201,169,110,0.12)", color: "var(--gold-dark)",
                        fontSize: 11, fontWeight: 700, cursor: guest?.id ? "pointer" : "not-allowed",
                        fontFamily: "Heebo,sans-serif", opacity: guest?.id ? 1 : 0.6,
                      }}
                    >
                      {hasMeaningfulProfile(guest?.guest_profile) || guest?.arrival_time ? "✏️ ערוך" : "+ הוסף"}
                    </button>
                  </div>
                  {profileChips.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {profileChips.map((chip) => (
                        <span
                          key={chip}
                          style={{
                            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                            background: "var(--card-bg)", border: "1px solid var(--gold)",
                            color: "var(--gold-dark)",
                          }}
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>אין תגיות פרופיל</div>
                  )}
                </div>
              </Section>

              <Section title="💬 הערות ובקשות">
                <div style={{
                  background: "var(--ivory)", borderRadius: 12, padding: "12px 14px",
                  border: "1px solid var(--border)",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: 10, flexWrap: "wrap", gap: 6,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                      בקשות אורח (guest_alerts)
                      {openAlertCount > 0 && (
                        <span style={{
                          marginRight: 6, fontSize: 10, background: "#FFF0EE", color: "#C0392B",
                          padding: "2px 7px", borderRadius: 10, fontWeight: 800,
                        }}>
                          {openAlertCount} פתוחות
                        </span>
                      )}
                    </span>
                    {guestAlerts.some((a) => a.resolved) && (
                      <label style={{
                        fontSize: 10, color: "var(--text-muted)", display: "flex",
                        alignItems: "center", gap: 4, cursor: "pointer",
                      }}>
                        <input
                          type="checkbox"
                          checked={showResolvedAlerts}
                          onChange={(e) => setShowResolvedAlerts(e.target.checked)}
                          style={{ accentColor: "var(--gold)" }}
                        />
                        הצג גם טופלו
                      </label>
                    )}
                  </div>

                  {loadingAlerts ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>טוען בקשות…</div>
                  ) : visibleAlerts.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: systemNotes ? 12 : 0 }}>
                      {visibleAlerts.map((alert) => {
                        const tm = alertTypeMeta(alert.alert_type);
                        return (
                          <div
                            key={alert.id}
                            style={{
                              background: "var(--card-bg)", borderRadius: 10, padding: "10px 11px",
                              border: `1px solid ${alert.resolved ? "var(--border)" : tm.color + "55"}`,
                              opacity: alert.resolved ? 0.75 : 1,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
                                background: tm.bg, color: tm.color,
                              }}>
                                {tm.label}
                              </span>
                              <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                {fmtAlertTime(alert.created_at)}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "#333", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                              {alert.message}
                            </div>
                            {alert.resolved && alert.resolution_notes && (
                              <div style={{ fontSize: 11, color: "#1A7A4A", marginTop: 6 }}>
                                ✓ {alert.resolution_notes}
                              </div>
                            )}
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                              {alert.resolved ? "✓ טופל" : "ממתין לטיפול"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: systemNotes ? 12 : 0 }}>
                      {guestAlerts.length > 0 && !showResolvedAlerts
                        ? "אין בקשות פתוחות — סמן «הצג גם טופלו» להיסטוריה"
                        : "אין בקשות מתועדות לאורח זה"}
                    </div>
                  )}

                  {systemNotes && (
                    <div style={{ borderTop: guestAlerts.length ? "1px solid var(--border)" : "none", paddingTop: guestAlerts.length ? 10 : 0 }}>
                      <button
                        type="button"
                        onClick={() => setAuditOpen((o) => !o)}
                        style={{
                          background: "none", border: "none", padding: 0, cursor: "pointer",
                          fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                          fontFamily: "Heebo,sans-serif",
                        }}
                      >
                        {auditOpen ? "▼ הסתר לוג מערכת" : "▶ לוג מערכת (הערות אוטומטיות מהבוט)"}
                      </button>
                      {auditOpen && (
                        <div style={{
                          marginTop: 8, whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.5,
                          background: "var(--card-bg)", borderRadius: 8, padding: 10,
                          border: "1px solid var(--border)", maxHeight: 160, overflowY: "auto",
                          color: "#555",
                        }}>
                          {systemNotes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Section>

              <Section title="מסע האורח (אוטומציה)">
                <div style={{
                  background: "var(--ivory)", borderRadius: 12, padding: 14,
                  border: "1px solid var(--border)",
                }}>
                  <GuestJourneyTimeline guest={guest} queueRows={queueRows} compact />
                </div>
              </Section>

              <Section title="אוטומציה ובוט">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {onToggleClaim && (
                    <button
                      type="button"
                      disabled={claimBusy || !user?.id}
                      onClick={handleClaimToggle}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)",
                        background: isClaimedByMe ? "var(--status-success-bg, #DCFCE7)" : "var(--card-bg)",
                        cursor: claimBusy || !user?.id ? "not-allowed" : "pointer",
                        opacity: claimBusy ? 0.7 : 1, fontFamily: "Heebo, sans-serif", fontSize: 14,
                      }}
                    >
                      <span>
                        <strong>🔇 השתקת בוט (claimed_by)</strong>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {isClaimed
                            ? (isClaimedByMe ? "אתה מטפל — הבוט מושתק" : `בטיפול: ${claimedByName ?? "צוות"}`)
                            : "לחץ לקחת שיחה ולהשתיק את הבוט"}
                        </div>
                      </span>
                      <span style={{
                        fontWeight: 800, fontSize: 12,
                        color: isClaimed ? "var(--status-success, #15803D)" : "var(--text-muted)",
                      }}>
                        {claimBusy ? "⏳" : isClaimed ? "פעיל" : "כבוי"}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={muteSaving || !guest?.id}
                    onClick={handleAutomationMute}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)",
                      background: guest?.automation_muted ? "#FEF3C7" : "var(--card-bg)",
                      cursor: muteSaving || !guest?.id ? "not-allowed" : "pointer",
                      opacity: muteSaving ? 0.7 : 1, fontFamily: "Heebo, sans-serif", fontSize: 14,
                    }}
                  >
                    <span>
                      <strong>⏸️ השתקת אוטומציה (Cron / תבניות)</strong>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        חוסם שליחות אוטומטיות ותבניות Meta לאורח זה
                      </div>
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 12 }}>
                      {muteSaving ? "⏳" : guest?.automation_muted ? "מושתק" : "פעיל"}
                    </span>
                  </button>
                </div>
              </Section>

              <Section title="הערות צוות וסימון צבע">
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 6 }}>
                    סימון צבע מהיר
                  </label>
                  <select
                    value={guest?.staff_color_label ?? ""}
                    disabled={colorSaving || !guest?.id}
                    onChange={(e) => handleColorChange(e.target.value)}
                    style={{
                      width: "100%", padding: "10px 12px", borderRadius: 8,
                      border: `2px solid ${colorMeta.fg}40`,
                      background: colorMeta.bg, color: colorMeta.fg,
                      fontWeight: 700, fontSize: 14, fontFamily: "Heebo, sans-serif",
                      cursor: colorSaving || !guest?.id ? "not-allowed" : "pointer",
                    }}
                  >
                    {COLOR_FLAGS.map((opt) => (
                      <option key={opt.value || "_none"} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 6 }}>
                    הערות פנימיות (internal_notes)
                  </label>
                  <textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={4}
                    placeholder="הערות לצוות — נראות מיידית לכל מי שפותח את הפרופיל…"
                    style={{
                      width: "100%", boxSizing: "border-box", padding: "10px 12px",
                      borderRadius: 8, border: "1px solid var(--border)", fontSize: 14,
                      fontFamily: "Heebo, sans-serif", resize: "vertical", minHeight: 88,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSaveNotes}
                    disabled={notesSaving || !guest?.id}
                    className="btn btn-primary"
                    style={{
                      marginTop: 8, width: "100%", padding: "10px 14px",
                      background: "var(--gold, #C9A96E)", color: "#1A1A1A",
                      border: "none", borderRadius: 8, fontWeight: 800, fontSize: 14,
                      cursor: notesSaving || !guest?.id ? "not-allowed" : "pointer",
                      opacity: notesSaving || !guest?.id ? 0.6 : 1,
                    }}
                  >
                    {notesSaving ? "שומר…" : "💾 שמור הערות"}
                  </button>
                </div>
              </Section>

              <Section title="משימות אחרונות">
                {tasks.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
                    אין משימות אחרונות לאורח זה
                  </div>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {tasks.map((task) => {
                      const meta = TASK_STATUS_META[task.status] ?? {
                        label: `⚠ ${task.status}`, bg: "var(--ivory)", fg: "var(--text-muted)",
                      };
                      return (
                        <li
                          key={task.id}
                          style={{
                            border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px",
                            background: "var(--card-bg)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{
                              fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 12,
                              background: meta.bg, color: meta.fg,
                            }}>
                              {meta.label}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {task.department || "—"}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--text-main)" }}>
                            {(task.description ?? "").slice(0, 160)}
                            {(task.description ?? "").length > 160 ? "…" : ""}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
                            {task.created_at ? new Date(task.created_at).toLocaleString("he-IL") : ""}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>

        {toast && (
          <div style={{
            position: "sticky", bottom: 0, margin: "0 16px 16px",
            padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: toast.isErr ? "#FEE2E2" : "#DCFCE7",
            color: toast.isErr ? "#B91C1C" : "#15803D",
            textAlign: "center",
          }}>
            {toast.msg}
          </div>
        )}
      </div>

      {editOpen && guest?.id && (
        <AddGuestModal
          guest={guest}
          dock="right"
          zIndex={1250}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            handleProfileUpdated(updated);
            setEditOpen(false);
          }}
          showToast={showToastCompat}
          onOpenDreamBotChat={onOpenDreamBotChat}
        />
      )}
    </div>
  );
}
