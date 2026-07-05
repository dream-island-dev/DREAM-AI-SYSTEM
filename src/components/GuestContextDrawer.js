// GuestContextDrawer — 360° guest context slide-out for WhatsAppInbox roster clicks.
// Fetches fresh guests row + recent tasks; does not replace AddGuestModal (full CRUD).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { getGuestTimingBadge } from "../utils/guestTiming";
import { formatSpaSchedule } from "../utils/israeliTime";
import GuestJourneyTimeline from "./GuestJourneyTimeline";

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

  const showToast = useCallback((msg, isErr = false) => {
    setToast({ msg, isErr });
    setTimeout(() => setToast(null), 2800);
  }, []);

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
          "spa_time, spa_date, meal_time, arrival_time, needs_callback, requires_attention, " +
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
      };
      setGuest(row);
      setInternalNotes(row.internal_notes ?? "");

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
        "claimed_by, claimed_at, automation_muted, staff_color_label, internal_notes, guest_notes"
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

  const displayName = guest?.name || contact?.guestName || contact?.pushName || "אורח";
  const timingBadge = guest ? getGuestTimingBadge(guest) : null;
  const colorMeta = COLOR_FLAGS.find((c) => c.value === (guest?.staff_color_label ?? "")) ?? COLOR_FLAGS[0];
  const isClaimedByMe = guest?.claimed_by === user?.id;
  const isClaimed = !!guest?.claimed_by;

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
              <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.25 }}>{displayName}</div>
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
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--text-muted)" }}>עזיבה</span>
                      <strong>{fmtDate(guest?.departure_date)}</strong>
                    </div>
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
    </div>
  );
}
