// src/components/SpaBoard.js
// Smart Spa Board — Phase 1: read + manual assign.
// spa_rooms / spa_therapists / spa_appointments (migration 176). Conflict
// detection is enforced at the DB layer (GiST exclusion constraints on both
// room_id and therapist_id) — this UI surfaces that as a FAIL VISIBLE ⚠
// banner rather than re-implementing the overlap check client-side.
// Incoming requests = guest_alerts (alert_type='spa_request'); assigning one
// here creates/links a spa_appointments row and resolves the alert. On
// success, writes through guests.spa_time/spa_date (Golden Profile SSOT).

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const DEFAULT_START_TIME = "09:00";
const DEFAULT_DURATION_MIN = 60;

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function addMinutesToHm(hm, minutes) {
  const [h, m] = hm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

// Small reusable chat-launch button — same pattern as RequestsBoard.js's
// DreamBotChatButton (not extracted to a shared file; this codebase keeps
// small presentational bits local per-board rather than over-abstracting).
function DreamBotChatButton({ phone, guestName, onOpenDreamBotChat }) {
  if (!phone || !onOpenDreamBotChat) return null;
  return (
    <button
      type="button"
      onClick={() => onOpenDreamBotChat({ phone, guestName })}
      title="מעבר מיידי לשיחת הוואטסאפ של האורח"
      style={{
        minHeight: 36, padding: "6px 12px", borderRadius: 8,
        border: "1.5px solid var(--border)", background: "var(--ivory)",
        color: "var(--black)", fontFamily: "Heebo, sans-serif", fontSize: 12,
        fontWeight: 700, cursor: "pointer", display: "inline-flex",
        alignItems: "center", gap: 6,
      }}
    >
      💬 שיחה
    </button>
  );
}

// ── Guest search — same inline `.ilike` pattern as ReceptionistView.js ─────
function GuestSearchField({ value, onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim() || !isSupabaseConfigured || !supabase) { setResults([]); return; }
    let cancelled = false;
    supabase
      .from("guests")
      .select("id, name, phone, room, status")
      .or(`name.ilike.%${query.trim()}%,phone.ilike.%${query.trim()}%`)
      .limit(8)
      .then(({ data }) => { if (!cancelled) setResults(data ?? []); });
    return () => { cancelled = true; };
  }, [query]);

  if (value) {
    return (
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "var(--ivory)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "10px 12px",
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{value.name || "—"}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", direction: "ltr", textAlign: "right" }}>
            {value.phone}{value.room ? ` · ${value.room}` : ""}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect(null)}>✕ החלף</button>
      </div>
    );
  }

  return (
    <div className="form-field" style={{ marginBottom: 0 }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="חיפוש אורח — שם או טלפון"
      />
      {results.length > 0 && (
        <div style={{ marginTop: 6, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          {results.map((g) => (
            <div
              key={g.id}
              onClick={() => { onSelect(g); setQuery(""); setResults([]); }}
              style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--card-bg)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", direction: "ltr" }}>
                {g.phone}{g.room ? ` · ${g.room}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Therapist name management — inline edit list (placeholder → real names) ─
function TherapistManagePanel({ therapists, onClose, onSaved }) {
  const [drafts, setDrafts] = useState({}); // id -> draft name (only while dirty)
  const [savingId, setSavingId] = useState(null);
  const [err, setErr] = useState(null);

  async function handleSave(id) {
    const name = (drafts[id] ?? "").trim();
    if (!name) { setErr("שם לא יכול להיות ריק"); return; }
    setErr(null);
    setSavingId(id);
    const { error } = await supabase.from("spa_therapists").update({ name }).eq("id", id);
    setSavingId(null);
    if (error) {
      // spa_therapists.name is UNIQUE — a duplicate rename surfaces as 23505.
      setErr(error.code === "23505" ? "⚠ השם הזה כבר קיים אצל מטפל/ת אחר/ת" : "⚠ שגיאה: " + error.message);
      return;
    }
    setDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
    onSaved();
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%",
          direction: "rtl", textAlign: "right", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          fontFamily: "Heebo, sans-serif", maxHeight: "85vh", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: "var(--gold-dark)" }}>✏️ עריכת שמות מטפלים</h3>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ minWidth: 36, minHeight: 36, border: "none", background: "var(--ivory)", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {err && (
          <div style={{ background: "#FFF0EE", border: "1px solid #E24B4A", color: "#A32D2D", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            {err}
          </div>
        )}

        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {therapists.map((t) => {
            const dirty = drafts[t.id] !== undefined;
            return (
              <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  value={dirty ? drafts[t.id] : t.name}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", fontFamily: "Heebo, sans-serif", fontSize: 13 }}
                />
                <button
                  type="button"
                  disabled={!dirty || savingId === t.id}
                  onClick={() => handleSave(t.id)}
                  title={dirty ? "שמור שם חדש" : "אין שינוי לשמירה"}
                  style={{
                    minHeight: 32, padding: "6px 12px", borderRadius: 8, border: "none",
                    background: dirty ? "var(--gold)" : "var(--ivory)",
                    color: dirty ? "#412402" : "var(--text-muted)",
                    fontWeight: 700, fontSize: 12, cursor: dirty ? "pointer" : "not-allowed",
                    fontFamily: "Heebo, sans-serif",
                  }}
                >
                  {savingId === t.id ? "…" : "✓ שמור"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Assign / create appointment modal ──────────────────────────────────────
function AssignModal({ draft, rooms, therapists, onClose, onSaved }) {
  const [guest, setGuest] = useState(draft?.guest ?? null);
  const [roomId, setRoomId] = useState(draft?.roomId ?? "");
  const [therapistId, setTherapistId] = useState("");
  const [date, setDate] = useState(draft?.date ?? todayYmd());
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(addMinutesToHm(DEFAULT_START_TIME, DEFAULT_DURATION_MIN));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  if (!draft) return null;

  async function handleSave() {
    setErr(null);
    if (!guest) return setErr("נא לבחור אורח");
    if (!roomId) return setErr("נא לבחור חדר");
    if (!startTime || !endTime) return setErr("נא למלא שעת התחלה וסיום");
    if (endTime <= startTime) return setErr("שעת הסיום חייבת להיות אחרי שעת ההתחלה");

    setSaving(true);
    const { data: appt, error: insErr } = await supabase
      .from("spa_appointments")
      .insert({
        guest_id: guest.id,
        room_id: Number(roomId),
        therapist_id: therapistId ? Number(therapistId) : null,
        guest_alert_id: draft.alertId ?? null,
        appointment_date: date,
        start_time: startTime,
        end_time: endTime,
        notes: notes.trim() || null,
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      setSaving(false);
      // FAIL VISIBLE — the DB's GiST exclusion constraint is the real conflict
      // guard; surface it as a plain-language collision, not a raw SQL error.
      if (insErr.code === "23P01") {
        setErr("⚠ התנגשות בלוח הזמנים — החדר או המטפל/ת כבר משובצים בטווח השעות הזה");
      } else {
        setErr("⚠ שגיאה: " + insErr.message);
      }
      return;
    }

    // Write-through to the Golden Profile (guests.spa_date/spa_time) — keep
    // _shared/spaSchedule.ts's existing WhatsApp/portal placeholders working.
    const { error: guestErr } = await supabase
      .from("guests")
      .update({ spa_date: date, spa_time: startTime })
      .eq("id", guest.id);
    if (guestErr) {
      console.warn("[SpaBoard] guests.spa_date/spa_time write-through failed:", guestErr.message);
    }

    if (draft.alertId) {
      const { error: alertErr } = await supabase
        .from("guest_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", draft.alertId);
      if (alertErr) {
        console.warn("[SpaBoard] guest_alerts resolve failed:", alertErr.message);
      }
    }

    setSaving(false);
    onSaved(appt?.id ?? null);
  }

  const couples = rooms.filter((r) => r.room_type === "couple");
  const singles = rooms.filter((r) => r.room_type === "single");

  return (
    <div
      onClick={() => !saving && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)", borderRadius: 16, padding: 24,
          maxWidth: 460, width: "100%", direction: "rtl", textAlign: "right",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)", fontFamily: "Heebo, sans-serif",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h3 style={{ margin: "0 0 16px", color: "var(--gold-dark)" }}>💆 קביעת תור ספא</h3>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>אורח</label>
          <GuestSearchField value={guest} onSelect={setGuest} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>חדר</label>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ width: "100%" }}>
              <option value="">— בחר חדר —</option>
              <optgroup label="חדרי זוגות">
                {couples.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
              <optgroup label="חדרי יחיד">
                {singles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
              מטפל/ת <span style={{ opacity: 0.6 }}>(אופציונלי)</span>
            </label>
            <select value={therapistId} onChange={(e) => setTherapistId(e.target.value)} style={{ width: "100%" }}>
              <option value="">— טרם שובץ —</option>
              {therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>תאריך</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>התחלה</label>
            <input
              type="time" value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setEndTime(addMinutesToHm(e.target.value, DEFAULT_DURATION_MIN));
              }}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>סיום</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
            הערות <span style={{ opacity: 0.6 }}>(אופציונלי)</span>
          </label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: 10, fontFamily: "Heebo, sans-serif", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
          />
        </div>

        {err && (
          <div style={{ background: "#FFF0EE", border: "1px solid #E24B4A", color: "#A32D2D", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving} style={{ background: "var(--ivory)" }}>ביטול</button>
          <button
            className="btn btn-sm" onClick={handleSave} disabled={saving}
            style={{ background: "var(--gold)", color: "#412402", fontWeight: 700 }}
          >
            {saving ? "שומר…" : "✓ קבע תור"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Swap therapists between two appointments ───────────────────────────────
// Calls the atomic swap_spa_therapists RPC (migration 177) instead of two
// sequential UPDATEs — a naive sequential swap would trip the DB's
// therapist-overlap exclusion constraint mid-swap.
function SwapTherapistModal({ sourceAppt, candidates, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  if (!sourceAppt) return null;

  async function handleSwap(targetId) {
    setErr(null);
    setSaving(true);
    const { data, error } = await supabase.rpc("swap_spa_therapists", {
      p_appt_id_a: sourceAppt.id,
      p_appt_id_b: targetId,
    });
    setSaving(false);
    if (error) {
      setErr(error.code === "23P01" ? "⚠ ההחלפה יוצרת התנגשות בלוח הזמנים" : "⚠ שגיאה: " + error.message);
      return;
    }
    if (data && data.ok === false) {
      setErr("⚠ שגיאה: " + (data.error || "unknown"));
      return;
    }
    onSaved();
  }

  return (
    <div
      onClick={() => !saving && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)", borderRadius: 16, padding: 24, maxWidth: 460, width: "100%",
          direction: "rtl", textAlign: "right", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          fontFamily: "Heebo, sans-serif", maxHeight: "85vh", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: "var(--gold-dark)" }}>🔄 החלפת מטפל/ת</h3>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ minWidth: 36, minHeight: 36, border: "none", background: "var(--ivory)", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ background: "var(--ivory)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>{sourceAppt.roomName} · {sourceAppt.start_time?.slice(0, 5)}–{sourceAppt.end_time?.slice(0, 5)}</div>
          <div style={{ color: "var(--text-muted)", marginTop: 2 }}>👤 {sourceAppt.spa_therapists?.name ?? "—"} · {sourceAppt.guests?.name ?? "—"}</div>
        </div>

        {err && (
          <div style={{ background: "#FFF0EE", border: "1px solid #E24B4A", color: "#A32D2D", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            {err}
          </div>
        )}

        {candidates.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>אין תור אחר עם מטפל/ת משובץ/ת ביום זה להחלפה מולו.</div>
        ) : (
          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>החלף מול:</div>
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={saving}
                onClick={() => handleSwap(c.id)}
                style={{
                  textAlign: "right", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--ivory)", cursor: saving ? "not-allowed" : "pointer", fontFamily: "Heebo, sans-serif",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>{c.roomName} · {c.start_time?.slice(0, 5)}–{c.end_time?.slice(0, 5)}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>👤 {c.spa_therapists?.name} · {c.guests?.name ?? "—"}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SpaBoard({ onOpenDreamBotChat }) {
  const [rooms, setRooms] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [spaAlerts, setSpaAlerts] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayYmd());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [assignDraft, setAssignDraft] = useState(null); // { alertId?, guest?, roomId?, date }
  const [showTherapistPanel, setShowTherapistPanel] = useState(false);
  const [swapDraft, setSwapDraft] = useState(null); // appointment being swapped

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const fetchStatic = useCallback(async () => {
    if (!supabase) return;
    const [{ data: roomRows }, { data: therapistRows }] = await Promise.all([
      supabase.from("spa_rooms").select("id, name, room_type, display_order, active").eq("active", true).order("room_type").order("display_order"),
      supabase.from("spa_therapists").select("id, name, active").eq("active", true).order("name"),
    ]);
    setRooms(roomRows ?? []);
    setTherapists(therapistRows ?? []);
  }, []);

  const fetchAppointments = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("spa_appointments")
      .select("*, guests(name, phone, room), spa_therapists(name)")
      .eq("appointment_date", selectedDate)
      .neq("status", "cancelled")
      .order("start_time");
    if (error) showToast("שגיאה בטעינת התורים: " + error.message, "err");
    setAppointments(data ?? []);
  }, [selectedDate]);

  const fetchSpaAlerts = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("guest_alerts")
      .select("*, guests(name, phone, room, arrival_date, departure_date, status)")
      .eq("alert_type", "spa_request")
      .eq("resolved", false)
      .order("created_at", { ascending: false });
    if (error) showToast("שגיאה בטעינת בקשות ספא: " + error.message, "err");
    setSpaAlerts(data ?? []);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatic(), fetchAppointments(), fetchSpaAlerts()]);
    setLoading(false);
  }, [fetchStatic, fetchAppointments, fetchSpaAlerts]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("spa-board-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "spa_appointments" }, fetchAppointments)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_alerts" }, fetchSpaAlerts)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchAppointments, fetchSpaAlerts]);

  const apptsByRoom = useMemo(() => {
    const map = {};
    appointments.forEach((a) => {
      if (!map[a.room_id]) map[a.room_id] = [];
      map[a.room_id].push(a);
    });
    return map;
  }, [appointments]);

  const roomsById = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r.name])), [rooms]);

  const swapCandidates = useMemo(() => {
    if (!swapDraft) return [];
    return appointments
      .filter((a) => a.id !== swapDraft.id && a.therapist_id)
      .map((a) => ({ ...a, roomName: roomsById[a.room_id] ?? "—" }));
  }, [swapDraft, appointments, roomsById]);

  const swapSource = swapDraft ? { ...swapDraft, roomName: roomsById[swapDraft.room_id] ?? "—" } : null;

  function openAssignForRoom(roomId) {
    setAssignDraft({ roomId: String(roomId), date: selectedDate, guest: null });
  }
  function openAssignForAlert(alert) {
    setAssignDraft({
      alertId: alert.id,
      date: selectedDate,
      guest: alert.guests ? { id: alert.guest_id, name: alert.guests.name, phone: alert.guests.phone, room: alert.guests.room } : null,
    });
  }

  function handleSaved() {
    setAssignDraft(null);
    showToast("✓ התור נקבע בהצלחה");
    fetchAppointments();
    fetchSpaAlerts();
  }

  const couples = rooms.filter((r) => r.room_type === "couple");
  const singles = rooms.filter((r) => r.room_type === "single");

  if (loading) {
    return (
      <div style={{ direction: "rtl", textAlign: "center", padding: 48, color: "var(--text-muted)", fontFamily: "Heebo, sans-serif" }}>
        טוען לוח ספא...
      </div>
    );
  }

  return (
    <div style={{ direction: "rtl", fontFamily: "Heebo, sans-serif" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          padding: "12px 20px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          background: toast.type === "err" ? "#FCEBEB" : "#EAF3DE",
          color: toast.type === "err" ? "#A32D2D" : "#3B6D11",
          border: `1px solid ${toast.type === "err" ? "#E24B4A" : "#639922"}`,
        }}>
          {toast.msg}
        </div>
      )}

      {showTherapistPanel && (
        <TherapistManagePanel
          therapists={therapists}
          onClose={() => setShowTherapistPanel(false)}
          onSaved={() => { showToast("✓ השם עודכן"); fetchStatic(); }}
        />
      )}

      <AssignModal
        // Remount on every distinct draft (React's own recommended pattern for
        // resetting state derived from props) — otherwise reopening for a
        // different room/alert would keep the previous open's stale form state,
        // since this component never actually unmounts (it just renders null).
        key={assignDraft ? `${assignDraft.alertId ?? "room"}-${assignDraft.roomId ?? "alert"}-${assignDraft.date}` : "closed"}
        draft={assignDraft}
        rooms={rooms}
        therapists={therapists}
        onClose={() => setAssignDraft(null)}
        onSaved={handleSaved}
      />

      <SwapTherapistModal
        sourceAppt={swapSource}
        candidates={swapCandidates}
        onClose={() => setSwapDraft(null)}
        onSaved={() => { setSwapDraft(null); showToast("✓ המטפלים הוחלפו בהצלחה"); fetchAppointments(); }}
      />

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון את לוח הספא.
        </div>
      )}

      {/* ── Incoming spa requests queue ────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--black)" }}>
            💆 בקשות ספא ממתינות {spaAlerts.length > 0 ? `(${spaAlerts.length})` : ""}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchAll}>↺ רענון</button>
        </div>
        {spaAlerts.length === 0 ? (
          <div style={{ padding: "16px 0", color: "var(--text-muted)", fontSize: 13 }}>אין בקשות ספא פתוחות 🎉</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {spaAlerts.map((alert) => (
              <div key={alert.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: "var(--card-bg)", border: "1px solid var(--border)", borderRight: "4px solid #1A56DB",
                borderRadius: 10, padding: "10px 14px", flexWrap: "wrap", gap: 10,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {alert.guests?.name ?? "אורח"}{alert.guests?.room ? ` · ${alert.guests.room}` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{alert.message}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>התקבל: {fmtTimestamp(alert.created_at)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <DreamBotChatButton phone={alert.phone} guestName={alert.guests?.name} onOpenDreamBotChat={onOpenDreamBotChat} />
                  <button
                    className="btn btn-sm"
                    onClick={() => openAssignForAlert(alert)}
                    style={{ background: "var(--gold)", color: "#412402", fontWeight: 700 }}
                  >
                    📅 שבץ תור
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Date selector ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: "var(--black)" }}>תאריך:</label>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate(todayYmd())}>היום</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowTherapistPanel(true)} style={{ marginRight: "auto" }}>
          ✏️ עריכת שמות מטפלים
        </button>
      </div>

      {/* ── Room-columns board ──────────────────────────────────────────────── */}
      {[{ label: "חדרי זוגות", list: couples }, { label: "חדרי יחיד", list: singles }].map((group) => (
        group.list.length === 0 ? null : (
          <div key={group.label} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", marginBottom: 10, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
              {group.label} ({group.list.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {group.list.map((room) => {
                const roomAppts = apptsByRoom[room.id] ?? [];
                return (
                  <div key={room.id} style={{
                    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12,
                    padding: "12px 12px", minHeight: 140, display: "flex", flexDirection: "column",
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>{room.name}</div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      {roomAppts.length === 0 ? (
                        <div style={{ fontSize: 11, color: "#ccc" }}>אין תורים</div>
                      ) : roomAppts.map((a) => (
                        <div key={a.id} style={{
                          background: "var(--ivory)", borderRadius: 8, padding: "6px 8px",
                          border: a.therapist_id ? "1px solid var(--border)" : "1px solid #E8AE0A",
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>
                            {a.start_time?.slice(0, 5)}–{a.end_time?.slice(0, 5)}
                          </div>
                          <div style={{ fontSize: 12 }}>{a.guests?.name ?? "—"}</div>
                          {a.spa_therapists?.name ? (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>👤 {a.spa_therapists.name}</div>
                              <button
                                type="button"
                                onClick={() => setSwapDraft(a)}
                                title="החלפת מטפל/ת עם תור אחר"
                                style={{
                                  minHeight: 26, minWidth: 26, padding: 0, borderRadius: 6,
                                  border: "1px solid var(--border)", background: "var(--card-bg)",
                                  cursor: "pointer", fontSize: 12, lineHeight: 1, flexShrink: 0,
                                }}
                              >
                                🔄
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: "#8A6A00", fontWeight: 700 }}>⚠ טרם שובץ מטפל/ת</div>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => openAssignForRoom(room.id)}
                      style={{
                        marginTop: 8, minHeight: 36, borderRadius: 8, border: "1.5px dashed var(--border)",
                        background: "transparent", color: "var(--text-muted)", fontSize: 12, fontWeight: 700,
                        cursor: "pointer", fontFamily: "Heebo, sans-serif",
                      }}
                    >
                      + קבע תור
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ))}
    </div>
  );
}
