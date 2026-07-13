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
import ActivitiesImportZone from "./spa/ActivitiesImportZone";
import { resolveHomeRoomMap, planAlignDay, roomOccupancyAtSlot } from "../utils/spaStickyRoom";

const DEFAULT_START_TIME = "09:00";
const DEFAULT_DURATION_MIN = 60;

const UNMATCHED_REASON_LABELS = {
  no_guest_match: "לא נמצא אורח לפי הטלפון",
  room_unmapped: "חדר לא מזוהה במערכת",
  conflict_23P01: "התנגשות בלוח הזמנים",
  suspicious_shared_phone: "טלפון משותף לכמה אורחים",
  invalid_time_range: "שעה לא תקינה בקובץ",
  write_failed: "שגיאת מערכת בשמירה",
};

// Staff board markers — soft pastels, one-tap on the card. Keys match
// spa_appointments.board_color CHECK (migration 180). Sync never writes these.
const BOARD_COLORS = [
  { key: "gold",  label: "זהב",  bg: "#FBF3E0", border: "#C9A96E", text: "#412402" },
  { key: "blue",  label: "כחול", bg: "#E8F0FE", border: "#1A56DB", text: "#1A3A6B" },
  { key: "green", label: "ירוק", bg: "#EAF3DE", border: "#639922", text: "#3B6D11" },
  { key: "rose",  label: "ורוד", bg: "#FCE8F0", border: "#C2185B", text: "#8B1548" },
  { key: "amber", label: "כתום", bg: "#FFF5E8", border: "#F5A623", text: "#7A4A00" },
  { key: "slate", label: "אפור", bg: "#F0F0F0", border: "#8A8A8A", text: "#3D3D3D" },
];

function boardColorStyle(key) {
  return BOARD_COLORS.find((c) => c.key === key) ?? null;
}

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

function genderLabel(gender) {
  if (gender === "female") return "אישה";
  if (gender === "male") return "גבר";
  return "לא הוגדר";
}

// Therapist -> distinct rooms they appear in today (soft ⚠ trigger, never blocks save).
function therapistsMultiRoomToday(appointments) {
  const map = new Map();
  appointments.forEach((a) => {
    if (!a.therapist_id) return;
    if (!map.has(a.therapist_id)) map.set(a.therapist_id, new Set());
    map.get(a.therapist_id).add(a.room_id);
  });
  return map;
}

function genderPrefMismatch(guestProfile, therapistGender) {
  return guestProfile?.spa?.therapist_pref === "female_only" && therapistGender !== "female";
}

// Read-merge-write into guest_profile.spa — same shape/pattern as
// spaActivitiesSyncEngine.js's buildGuestSpaProfilePatch, but only touches
// therapist_pref so it never wipes date/time/room/treatment_type etc.
function buildGuestSpaPrefPatch(existingProfile, therapistPref) {
  const profile = existingProfile && typeof existingProfile === "object" ? existingProfile : {};
  const spa = profile.spa && typeof profile.spa === "object" ? profile.spa : {};
  return { ...profile, spa: { ...spa, therapist_pref: therapistPref } };
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
      .select("id, name, phone, room, status, guest_profile")
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
  const [genderSavingId, setGenderSavingId] = useState(null);
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

  // Immediate-save on change — same one-tap pattern as ColorDots, no dirty gate.
  async function handleGenderChange(id, gender) {
    setErr(null);
    setGenderSavingId(id);
    const { error } = await supabase.from("spa_therapists").update({ gender }).eq("id", id);
    setGenderSavingId(null);
    if (error) { setErr("⚠ שגיאה: " + error.message); return; }
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
                <select
                  value={t.gender ?? "unknown"}
                  disabled={genderSavingId === t.id}
                  onChange={(e) => handleGenderChange(t.id, e.target.value)}
                  title="מגדר המטפל/ת — משפיע על אזהרת העדפת «רק מטפלת»"
                  style={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", padding: "6px" }}
                >
                  <option value="unknown">לא הוגדר</option>
                  <option value="female">אישה</option>
                  <option value="male">גבר</option>
                </select>
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

// ── Unmatched Activities panel — FAIL VISIBLE, always shown when non-empty ──
function UnmatchedPanel({ rows, rooms, onAssignRoom, onDismiss, onDismissAll }) {
  const [roomChoice, setRoomChoice] = useState({}); // unmatchedId -> room_id draft
  const [dismissAllBusy, setDismissAllBusy] = useState(false);

  if (!rows.length) return null;

  async function handleDismissAll() {
    if (!onDismissAll || dismissAllBusy) return;
    if (!window.confirm(`לסמן את כל ${rows.length} השורות כטופלו?\n(לא מוחק תורים — רק מנקה את רשימת האזהרות)`)) return;
    setDismissAllBusy(true);
    try {
      await onDismissAll();
    } finally {
      setDismissAllBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 10, marginBottom: 10,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#A32D2D" }}>
          ⚠ שורות ללא שיוך מלא מהייבוא האחרון ({rows.length})
        </div>
        {onDismissAll && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={dismissAllBusy}
            onClick={handleDismissAll}
            title="סמן את כל השורות כטופלו — מנקה את הבאנר בלי למחוק תורים"
            style={{ fontWeight: 700, color: "#A32D2D", border: "1px solid #E24B4A" }}
          >
            {dismissAllBusy ? "מנקה..." : `✕ נקה הכל (${rows.length})`}
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => (
          <div key={row.id} style={{
            background: "#FFF5F5", border: "1px solid #E24B4A", borderRadius: 10,
            padding: "10px 14px", display: "flex", justifyContent: "space-between",
            alignItems: "center", flexWrap: "wrap", gap: 10,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {row.guest_name || "אורח לא ידוע"}
                {row.phone ? ` · ${row.phone.replace(/^972/, "0")}` : ""}
                {row.start_time ? ` · ${row.start_time}` : ""}
                {row.room_raw ? ` · ${row.room_raw}` : ""}
              </div>
              <div style={{ fontSize: 12, color: "#A32D2D", fontWeight: 700, marginTop: 2 }}>
                {UNMATCHED_REASON_LABELS[row.reason] ?? row.reason}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {row.reason === "room_unmapped" && (
                <>
                  <select
                    value={roomChoice[row.id] ?? ""}
                    onChange={(e) => setRoomChoice((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    style={{ fontSize: 12 }}
                  >
                    <option value="">— שייך לחדר —</option>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button
                    className="btn btn-sm"
                    disabled={!roomChoice[row.id]}
                    onClick={() => onAssignRoom(row, roomChoice[row.id])}
                    title="ישויך לחדר מהיום — ייבוא הבא יזהה את השם הזה אוטומטית (הרשומה הנוכחית לא נוצרת רטרואקטיבית)"
                    style={{ background: roomChoice[row.id] ? "var(--gold)" : "var(--border)", color: "#412402", fontWeight: 700 }}
                  >
                    ✓ שייך
                  </button>
                </>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => onDismiss(row.id)} title="סמן כטופל ידנית">
                ✕ טופל
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Color dots — one tap = save (used in quick-edit + assign modal) ────────
function ColorDots({ value, onChange, disabled }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {BOARD_COLORS.map((c) => {
        const selected = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            disabled={disabled}
            title={c.label}
            aria-label={c.label}
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : c.key)}
            style={{
              width: 28, height: 28, borderRadius: "50%", padding: 0,
              background: c.bg, border: selected ? `3px solid ${c.border}` : `2px solid ${c.border}`,
              boxShadow: selected ? `0 0 0 2px ${c.border}44` : "none",
              cursor: disabled ? "not-allowed" : "pointer", flexShrink: 0,
              transform: selected ? "scale(1.08)" : "none", transition: "transform 0.12s",
            }}
          />
        );
      })}
      <button
        type="button"
        disabled={disabled || !value}
        onClick={() => onChange(null)}
        title="הסר צבע"
        style={{
          minHeight: 28, padding: "0 10px", borderRadius: 14, border: "1px solid var(--border)",
          background: "var(--ivory)", color: value ? "var(--text-muted)" : "#ccc",
          fontSize: 11, fontWeight: 700, cursor: disabled || !value ? "not-allowed" : "pointer",
          fontFamily: "Heebo, sans-serif",
        }}
      >
        ללא
      </button>
    </div>
  );
}

// ── Quick edit — color + staff note without reopening full AssignModal ─────
function ApptQuickEdit({ appt, roomName, onClose, onPatched }) {
  const [color, setColor] = useState(appt?.board_color ?? null);
  const [staffNote, setStaffNote] = useState(appt?.staff_note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const noteDirty = (staffNote.trim() || "") !== (appt?.staff_note ?? "").trim();

  if (!appt) return null;

  async function patch(fields) {
    setErr(null);
    setSaving(true);
    const { error } = await supabase.from("spa_appointments").update(fields).eq("id", appt.id);
    setSaving(false);
    if (error) {
      setErr("⚠ שגיאה: " + error.message);
      return false;
    }
    onPatched({ ...appt, ...fields });
    return true;
  }

  async function handleColor(next) {
    setColor(next);
    const ok = await patch({ board_color: next });
    if (!ok) setColor(appt.board_color ?? null);
  }

  async function handleSaveNote() {
    const ok = await patch({ staff_note: staffNote.trim() || null });
    if (ok) onClose();
  }

  const cStyle = boardColorStyle(color);

  return (
    <div
      onClick={() => !saving && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)", borderRadius: 16, padding: 24, maxWidth: 420, width: "100%",
          direction: "rtl", textAlign: "right", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          fontFamily: "Heebo, sans-serif",
          borderTop: cStyle ? `5px solid ${cStyle.border}` : "5px solid transparent",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: "var(--gold-dark)", fontSize: 17 }}>✏️ תור · צבע והערה</h3>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ minWidth: 36, minHeight: 36, border: "none", background: "var(--ivory)", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ background: cStyle?.bg ?? "var(--ivory)", border: `1px solid ${cStyle?.border ?? "var(--border)"}`, borderRadius: 10, padding: "10px 12px", marginBottom: 16, fontSize: 13 }}>
          <div style={{ fontWeight: 800 }}>{roomName} · {appt.start_time?.slice(0, 5)}–{appt.end_time?.slice(0, 5)}</div>
          <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{appt.guests?.name ?? "—"}{appt.spa_therapists?.name ? ` · 👤 ${appt.spa_therapists.name}` : ""}</div>
          {appt.treatment_type && (
            <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600 }}>{appt.treatment_type}</div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>צבע בלוח</label>
          <ColorDots value={color} onChange={handleColor} disabled={saving} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
            הערת צוות <span style={{ opacity: 0.6 }}>(נשמרת גם אחרי ייבוא EZGO)</span>
          </label>
          <textarea
            value={staffNote}
            onChange={(e) => setStaffNote(e.target.value)}
            rows={3}
            placeholder="למשל: אלרגיה לשמן · להגיע 10 דק׳ מוקדם · VIP"
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", padding: 10, fontFamily: "Heebo, sans-serif", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
          />
        </div>

        {appt.notes && (
          <div style={{ marginBottom: 14, fontSize: 12, color: "var(--text-muted)", background: "var(--ivory)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>מהייבוא (Ezgo):</div>
            {appt.notes}
          </div>
        )}

        {err && (
          <div style={{ background: "#FFF0EE", border: "1px solid #E24B4A", color: "#A32D2D", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving} style={{ background: "var(--ivory)" }}>
            {noteDirty ? "סגור בלי לשמור הערה" : "סגור"}
          </button>
          <button
            className="btn btn-sm"
            onClick={handleSaveNote}
            disabled={saving || !noteDirty}
            title={noteDirty ? "שמור הערת צוות" : "אין שינוי בהערה"}
            style={{ background: noteDirty ? "var(--gold)" : "var(--border)", color: "#412402", fontWeight: 700 }}
          >
            {saving ? "שומר…" : "✓ שמור הערה"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Assign / create appointment modal ──────────────────────────────────────
function AssignModal({ draft, rooms, therapists, shiftRoster, homeRoomByTherapist, onClose, onSaved }) {
  const [guest, setGuest] = useState(draft?.guest ?? null);
  const [roomId, setRoomId] = useState(draft?.roomId ?? "");
  const [therapistId, setTherapistId] = useState("");
  const [date, setDate] = useState(draft?.date ?? todayYmd());
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(addMinutesToHm(DEFAULT_START_TIME, DEFAULT_DURATION_MIN));
  const [staffNote, setStaffNote] = useState("");
  const [boardColor, setBoardColor] = useState(null);
  const [femaleOnly, setFemaleOnly] = useState(draft?.guest?.guest_profile?.spa?.therapist_pref === "female_only");
  const [overrideSticky, setOverrideSticky] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Re-derive the guest's saved preference whenever a different guest is picked
  // (search select or preloaded from an alert) — not on every unrelated re-render.
  useEffect(() => {
    setFemaleOnly(guest?.guest_profile?.spa?.therapist_pref === "female_only");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest?.id]);

  const rosterHomeTherapistIds = useMemo(() => {
    if (!roomId) return new Set();
    return new Set(
      (shiftRoster ?? [])
        .filter((r) => String(r.room_id) === String(roomId) && r.appointment_date === date)
        .map((r) => r.therapist_id)
    );
  }, [shiftRoster, roomId, date]);

  // Hard sticky gate (migration 193 companion, Mike 2026-07-13): a therapist
  // with a known home room today may not be assigned into a different room
  // without an explicit Override — surfaced at save-time as FAIL VISIBLE,
  // never by hiding the Save button.
  const stickyHomeRoomId = therapistId ? homeRoomByTherapist?.get(Number(therapistId)) : null;
  const stickyConflict = !!(stickyHomeRoomId && roomId && String(stickyHomeRoomId) !== String(roomId));
  const stickyHomeRoomName = stickyConflict ? rooms.find((r) => String(r.id) === String(stickyHomeRoomId))?.name : null;

  useEffect(() => { setOverrideSticky(false); }, [therapistId, roomId]);

  // Sort: roster home-room match first, then (when guest wants female_only)
  // female therapists first — still all selectable (Disable-Don't-Hide), just
  // reordered + labeled so staff sees the best fit at the top.
  const sortedTherapists = useMemo(() => {
    return [...therapists].sort((a, b) => {
      const aHome = rosterHomeTherapistIds.has(a.id) ? 1 : 0;
      const bHome = rosterHomeTherapistIds.has(b.id) ? 1 : 0;
      if (aHome !== bHome) return bHome - aHome;
      if (femaleOnly) {
        const aFem = a.gender === "female" ? 1 : 0;
        const bFem = b.gender === "female" ? 1 : 0;
        if (aFem !== bFem) return bFem - aFem;
      }
      return a.name.localeCompare(b.name, "he");
    });
  }, [therapists, rosterHomeTherapistIds, femaleOnly]);

  if (!draft) return null;

  async function handleSave() {
    setErr(null);
    if (!guest) return setErr("נא לבחור אורח");
    if (!roomId) return setErr("נא לבחור חדר");
    if (!startTime || !endTime) return setErr("נא למלא שעת התחלה וסיום");
    if (endTime <= startTime) return setErr("שעת הסיום חייבת להיות אחרי שעת ההתחלה");
    if (stickyConflict && !overrideSticky) {
      const tName = therapists.find((t) => String(t.id) === String(therapistId))?.name ?? "המטפל/ת";
      return setErr(`⚠ ל${tName} חדר בית קבוע היום (${stickyHomeRoomName}) — שיבוץ כאן יפר את הקביעות. סמן/י «חריג — שבץ בכל זאת» למטה כדי להמשיך.`);
    }

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
        staff_note: staffNote.trim() || null,
        board_color: boardColor,
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

    // Read-merge-write the therapist_pref toggle — fresh read (not the possibly
    // stale client-side `guest` copy) so we never clobber spa.date/time/room
    // etc. written by the EZGO import sync engine.
    const { data: freshGuestRow } = await supabase.from("guests").select("guest_profile").eq("id", guest.id).maybeSingle();
    const prefPatch = buildGuestSpaPrefPatch(freshGuestRow?.guest_profile, femaleOnly ? "female_only" : null);
    const { error: prefErr } = await supabase.from("guests").update({ guest_profile: prefPatch }).eq("id", guest.id);
    if (prefErr) {
      console.warn("[SpaBoard] guest_profile.spa.therapist_pref write-through failed:", prefErr.message);
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
              {sortedTherapists.map((t) => {
                const isHome = rosterHomeTherapistIds.has(t.id);
                const mismatch = femaleOnly && t.gender !== "female";
                const suffix = [isHome ? "חדר משמרת" : null, mismatch ? `⚠ ${genderLabel(t.gender)}` : null].filter(Boolean).join(" · ");
                return (
                  <option key={t.id} value={t.id} style={mismatch ? { color: "#8A6A00" } : undefined}>
                    {t.name}{suffix ? ` (${suffix})` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={femaleOnly} onChange={(e) => setFemaleOnly(e.target.checked)} />
            רק מטפלת <span style={{ opacity: 0.6, fontSize: 11 }}>(העדפת אורח/ת — נשמר בפרופיל, לא חוסם שיבוץ)</span>
          </label>
        </div>

        {stickyConflict && (
          <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 12, color: "#7A4A00" }}>
            ⚠ חדר הבית של המטפל/ת היום הוא <strong>{stickyHomeRoomName}</strong> — שיבוץ בחדר הזה יחרוג מהקביעות.
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: "pointer", fontWeight: 700 }}>
              <input type="checkbox" checked={overrideSticky} onChange={(e) => setOverrideSticky(e.target.checked)} />
              חריג — שבץ בכל זאת
            </label>
          </div>
        )}

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
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>
            צבע בלוח <span style={{ opacity: 0.6 }}>(אופציונלי)</span>
          </label>
          <ColorDots value={boardColor} onChange={setBoardColor} disabled={saving} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
            הערת צוות <span style={{ opacity: 0.6 }}>(אופציונלי)</span>
          </label>
          <textarea
            value={staffNote} onChange={(e) => setStaffNote(e.target.value)} rows={2}
            placeholder="למשל: אלרגיה · VIP · להקדים"
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
          <h3 style={{ margin: 0, color: "var(--gold-dark)" }}>🔄 החלפת מטפל/ת (חריג)</h3>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ minWidth: 36, minHeight: 36, border: "none", background: "var(--ivory)", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
          עדיף להעביר את האורח/ת לחדר הבית של המטפל/ת («➡️ העבר אורח») — החלפת מטפלים היא חריג לשימוש נדיר.
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

// ── Move guest — primary sticky-room fix path (Architecture A+B, Mike 2026-07-13) ──
// Changes room_id (optionally therapist_id) on ONE appointment row via a
// single UPDATE — unlike SwapTherapistModal's two-row exchange, one row never
// trips the therapist-overlap exclusion mid-statement, so no RPC is needed.
// Room picker is availability-aware for the appointment's time window
// (reuses roomOccupancyAtSlot) — free rooms first, full rooms greyed but
// still visible (Disable-Don't-Hide) with an Override path.
function MoveGuestModal({ appt, rooms, therapists, appointments, homeRoomByTherapist, onClose, onSaved }) {
  const homeRoomId = appt?.therapist_id ? homeRoomByTherapist?.get(appt.therapist_id) : null;
  const [roomId, setRoomId] = useState("");
  const [overrideFull, setOverrideFull] = useState(false);
  const [reassignTherapist, setReassignTherapist] = useState(false);
  const [targetTherapistId, setTargetTherapistId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const roomTypeById = useMemo(
    () => Object.fromEntries((rooms ?? []).map((r) => [r.id, r.room_type])),
    [rooms]
  );

  const roomOptions = useMemo(() => {
    if (!appt) return [];
    return (rooms ?? []).map((r) => {
      const occ = roomOccupancyAtSlot(appointments, appt, r.id, roomTypeById);
      const isCurrent = r.id === appt.room_id;
      const isHome = homeRoomId != null && r.id === homeRoomId;
      return { ...r, ...occ, isCurrent, isHome };
    }).sort((a, b) => {
      // Home free → other free → current → full; within group couple/single then name
      const rank = (r) => {
        if (r.isHome && r.free) return 0;
        if (r.free && !r.isCurrent) return 1;
        if (r.isCurrent) return 2;
        if (r.free) return 3;
        return 4;
      };
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      if (a.room_type !== b.room_type) return a.room_type === "couple" ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "", "he");
    });
  }, [rooms, appointments, appt, roomTypeById, homeRoomId]);

  const freeCount = roomOptions.filter((r) => r.free && !r.isCurrent).length;
  const selectedMeta = roomOptions.find((r) => String(r.id) === String(roomId));
  const selectedIsFull = selectedMeta && !selectedMeta.free && !selectedMeta.isCurrent;

  useEffect(() => {
    setOverrideFull(false);
    setReassignTherapist(false);
    setTargetTherapistId("");
    setErr(null);
    if (!appt) return;
    // Smart default: home if free (and not current) → else first free ≠ current → else home if away
    const homeOpt = roomOptions.find((r) => r.isHome);
    const firstFree = roomOptions.find((r) => r.free && !r.isCurrent);
    if (homeOpt?.free && !homeOpt.isCurrent) setRoomId(String(homeOpt.id));
    else if (firstFree) setRoomId(String(firstFree.id));
    else if (homeOpt && !homeOpt.isCurrent) setRoomId(String(homeOpt.id));
    else setRoomId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appt?.id]);

  if (!appt) return null;

  const currentTherapistName = therapists.find((t) => t.id === appt.therapist_id)?.name ?? "—";
  const timeLabel = `${appt.start_time?.slice(0, 5) ?? "—"}–${appt.end_time?.slice(0, 5) ?? "—"}`;

  async function handleMove() {
    setErr(null);
    if (!roomId) return setErr("נא לבחור חדר יעד");
    if (String(roomId) === String(appt.room_id) && !(reassignTherapist && targetTherapistId)) {
      return setErr("החדר שנבחר זהה לחדר הנוכחי");
    }
    if (selectedIsFull && !overrideFull) {
      return setErr("⚠ החדר מלא בשעת הטיפול — סמן/י «חריג — העבר בכל זאת» או בחר/י חדר פנוי");
    }
    setSaving(true);
    const patch = { room_id: Number(roomId) };
    if (reassignTherapist && targetTherapistId) patch.therapist_id = Number(targetTherapistId);
    const { error } = await supabase.from("spa_appointments").update(patch).eq("id", appt.id);
    setSaving(false);
    if (error) {
      setErr(error.code === "23P01" ? "⚠ התנגשות בלוח הזמנים בחדר היעד" : "⚠ שגיאה: " + error.message);
      return;
    }
    onSaved();
  }

  function statusBadge(r) {
    if (r.isCurrent) return "נוכחי";
    if (r.free && r.capacity > 1) return `פנוי (${r.openSlots}/${r.capacity})`;
    if (r.free) return "פנוי";
    return "מלא";
  }

  return (
    <div
      onClick={() => !saving && onClose()}
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
          <h3 style={{ margin: 0, color: "var(--gold-dark)" }}>➡️ העבר אורח</h3>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ minWidth: 36, minHeight: 36, border: "none", background: "var(--ivory)", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ background: "var(--ivory)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>{rooms.find((r) => r.id === appt.room_id)?.name ?? "—"} · {timeLabel}</div>
          <div style={{ color: "var(--text-muted)", marginTop: 2 }}>👤 {currentTherapistName} · {appt.guests?.name ?? "—"}</div>
          {homeRoomId && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              חדר הבית של {currentTherapistName} היום: {rooms.find((r) => r.id === homeRoomId)?.name ?? "—"}
            </div>
          )}
          <div style={{ fontSize: 11, marginTop: 6, fontWeight: 600, color: freeCount > 0 ? "#2F6B3A" : "#A32D2D" }}>
            {freeCount > 0
              ? `✓ ${freeCount} חדרי יעד פנויים בשעת הטיפול (${timeLabel})`
              : `⚠ אין חדר פנוי בשעת הטיפול (${timeLabel}) — רק חריג ידני`}
          </div>
        </div>

        {err && (
          <div style={{ background: "#FFF0EE", border: "1px solid #E24B4A", color: "#A32D2D", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <div style={{ marginBottom: 14, overflowY: "auto", flex: 1, minHeight: 0 }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>
            חדר יעד לפי זמינות בשעה זו
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {roomOptions.map((r) => {
              const selected = String(r.id) === String(roomId);
              const muted = !r.free && !r.isCurrent;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { setRoomId(String(r.id)); setOverrideFull(false); setErr(null); }}
                  title={muted ? "מלא בשעת הטיפול — ניתן לבחור כחריג" : r.isHome ? "חדר הבית של המטפל/ת" : "פנוי בשעת הטיפול"}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                    width: "100%", textAlign: "right", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    border: selected ? "2px solid var(--gold)" : "1px solid var(--border)",
                    background: selected ? "#FFF8E8" : muted ? "#F7F5F2" : "var(--card-bg)",
                    opacity: muted ? 0.72 : 1,
                    fontFamily: "inherit", fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {r.name}
                    {r.isHome ? " · חדר בית" : ""}
                    {r.isCurrent ? " · נוכחי" : ""}
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                    color: r.free ? "#2F6B3A" : muted ? "#A32D2D" : "var(--text-muted)",
                  }}>
                    {statusBadge(r)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {selectedIsFull && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 12, color: "#A32D2D", fontWeight: 600 }}>
            <input type="checkbox" checked={overrideFull} onChange={(e) => setOverrideFull(e.target.checked)} />
            חריג — העבר בכל זאת (החדר מלא בשעה זו)
          </label>
        )}

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={reassignTherapist} onChange={(e) => setReassignTherapist(e.target.checked)} />
            לשבץ גם מטפל/ת אחר/ת <span style={{ opacity: 0.6, fontSize: 11 }}>(ברירת מחדל: {currentTherapistName} נשאר/ת)</span>
          </label>
          {reassignTherapist && (
            <select value={targetTherapistId} onChange={(e) => setTargetTherapistId(e.target.value)} style={{ width: "100%", marginTop: 8 }}>
              <option value="">— בחר מטפל/ת —</option>
              {therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: "auto" }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving} style={{ background: "var(--ivory)" }}>ביטול</button>
          <button
            className="btn btn-sm" onClick={handleMove} disabled={saving}
            style={{ background: "var(--gold)", color: "#412402", fontWeight: 700 }}
          >
            {saving ? "מעביר…" : "✓ העבר אורח"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shift roster — "home room for the day" per therapist (Architecture B) ──
// Full-day replace on save: delete every spa_shift_roster row for this date,
// then insert the picked set. Not atomic across the two calls — same
// tolerance level already accepted elsewhere on this board (e.g. AssignModal's
// appointment insert + guests write-through are two sequential calls too).
function ShiftRosterModal({ date, rooms, therapists, existingRoster, bookedTherapistIds, onClose, onSaved }) {
  const initial = useMemo(() => {
    const map = {};
    (existingRoster ?? []).forEach((r) => {
      const key = String(r.room_id);
      if (!map[key]) map[key] = [];
      map[key].push(String(r.therapist_id));
    });
    return map;
  }, [existingRoster]);

  const [assignments, setAssignments] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function setSlot(roomId, slotIndex, therapistId, slotsCount) {
    setAssignments((prev) => {
      const key = String(roomId);
      const arr = [...(prev[key] ?? [])];
      while (arr.length < slotsCount) arr.push("");
      arr[slotIndex] = therapistId;
      return { ...prev, [key]: arr };
    });
  }

  async function handleSave() {
    setErr(null);

    const chosenIds = Object.values(assignments).flat().filter(Boolean);
    const dupId = chosenIds.find((id, i) => chosenIds.indexOf(id) !== i);
    if (dupId) {
      // Catch this client-side BEFORE the destructive delete below — otherwise
      // a same-therapist-twice mistake would wipe the day's working roster
      // and only then fail on the DB's UNIQUE(date, therapist_id), losing the
      // previous good state for nothing.
      const dupName = therapists.find((t) => String(t.id) === dupId)?.name ?? "מטפל/ת";
      setErr(`⚠ ${dupName} נבחר/ה ליותר מחדר אחד — מטפל/ת יכול/ה להיות בית קבוע של חדר אחד בלבד ביום זה`);
      return;
    }

    setSaving(true);

    const rows = [];
    Object.entries(assignments).forEach(([roomId, ids]) => {
      (ids ?? []).filter(Boolean).forEach((therapistId) => {
        rows.push({ appointment_date: date, room_id: Number(roomId), therapist_id: Number(therapistId) });
      });
    });

    const { error: delErr } = await supabase.from("spa_shift_roster").delete().eq("appointment_date", date);
    if (delErr) {
      setSaving(false);
      setErr("⚠ שגיאה במחיקת הסידור הקודם: " + delErr.message);
      return;
    }

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("spa_shift_roster").insert(rows);
      setSaving(false);
      if (insErr) {
        // UNIQUE(appointment_date, therapist_id) — same therapist picked as home for 2 rooms.
        setErr(insErr.code === "23505" ? "⚠ מטפל/ת אחד/ת לא יכול/ה להיות בית קבוע של יותר מחדר אחד באותו יום" : "⚠ שגיאה: " + insErr.message);
        return;
      }
    } else {
      setSaving(false);
    }

    onSaved();
  }

  const couples = rooms.filter((r) => r.room_type === "couple");
  const singles = rooms.filter((r) => r.room_type === "single");
  const rosteredTherapistIds = new Set(Object.values(assignments).flat().filter(Boolean));
  const unrosteredBooked = therapists.filter((t) => bookedTherapistIds.has(t.id) && !rosteredTherapistIds.has(String(t.id)));

  function renderRoomRow(room) {
    const slotsCount = room.room_type === "couple" ? 2 : 1;
    const current = assignments[String(room.id)] ?? [];
    return (
      <div key={room.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ minWidth: 100, fontWeight: 700, fontSize: 13 }}>{room.name}</div>
        {Array.from({ length: slotsCount }).map((_, i) => (
          <select
            key={i}
            value={current[i] ?? ""}
            onChange={(e) => setSlot(room.id, i, e.target.value, slotsCount)}
            style={{ fontSize: 12, flex: 1, minWidth: 130 }}
          >
            <option value="">— ללא —</option>
            {therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        ))}
      </div>
    );
  }

  return (
    <div
      onClick={() => !saving && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)", borderRadius: 16, padding: 24, maxWidth: 560, width: "100%",
          direction: "rtl", textAlign: "right", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          fontFamily: "Heebo, sans-serif", maxHeight: "88vh", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, color: "var(--gold-dark)" }}>🗓️ סידור משמרת — {date}</h3>
          <button type="button" onClick={onClose} aria-label="סגור" style={{ minWidth: 36, minHeight: 36, border: "none", background: "var(--ivory)", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
          חדר הבית של המטפל/ת ליום זה — עוזר למיין את רשימת המטפלים בקביעת תור. לא חוסם שיבוץ בפועל.
        </div>

        {err && (
          <div style={{ background: "#FFF0EE", border: "1px solid #E24B4A", color: "#A32D2D", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            {err}
          </div>
        )}

        <div style={{ overflowY: "auto", flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginTop: 6, marginBottom: 4 }}>חדרי זוגות</div>
          {couples.map(renderRoomRow)}
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginTop: 12, marginBottom: 4 }}>חדרי יחיד</div>
          {singles.map(renderRoomRow)}

          {unrosteredBooked.length > 0 && (
            <div style={{ marginTop: 16, background: "var(--ivory)", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>משובצים היום בלי בית קבוע:</div>
              {unrosteredBooked.map((t) => t.name).join(" · ")}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving} style={{ background: "var(--ivory)" }}>ביטול</button>
          <button className="btn btn-sm" onClick={handleSave} disabled={saving} style={{ background: "var(--gold)", color: "#412402", fontWeight: 700 }}>
            {saving ? "שומר…" : "✓ שמור סידור"}
          </button>
        </div>
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
  const [editAppt, setEditAppt] = useState(null); // appointment for color/note quick-edit
  const [unmatchedRows, setUnmatchedRows] = useState([]);
  const [showImportZone, setShowImportZone] = useState(false);
  const [shiftRoster, setShiftRoster] = useState([]);
  const [showShiftRosterPanel, setShowShiftRosterPanel] = useState(false);
  const [moveDraft, setMoveDraft] = useState(null); // appointment being moved to its home room
  const [alignBlocked, setAlignBlocked] = useState([]); // moves that hit a scheduling conflict
  const [alignRunning, setAlignRunning] = useState(false);
  // Hour agenda is the default view (Mike, locked decision) — room-columns
  // stays available as a secondary tab, same data/handlers, just a different
  // grouping of the same `appointments` state.
  const [viewMode, setViewMode] = useState("agenda");

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const fetchStatic = useCallback(async () => {
    if (!supabase) return;
    const [{ data: roomRows }, { data: therapistRows }] = await Promise.all([
      supabase.from("spa_rooms").select("id, name, room_type, display_order, active").eq("active", true).order("room_type").order("display_order"),
      supabase.from("spa_therapists").select("id, name, active, gender").eq("active", true).order("name"),
    ]);
    setRooms(roomRows ?? []);
    setTherapists(therapistRows ?? []);
  }, []);

  const fetchAppointments = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("spa_appointments")
      .select("*, guests(name, phone, room, guest_profile), spa_therapists(name, gender)")
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
      .select("*, guests(name, phone, room, arrival_date, departure_date, status, guest_profile)")
      .eq("alert_type", "spa_request")
      .eq("resolved", false)
      .order("created_at", { ascending: false });
    if (error) showToast("שגיאה בטעינת בקשות ספא: " + error.message, "err");
    setSpaAlerts(data ?? []);
  }, []);

  const fetchShiftRoster = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("spa_shift_roster")
      .select("id, appointment_date, room_id, therapist_id")
      .eq("appointment_date", selectedDate);
    if (error) showToast("שגיאה בטעינת סידור המשמרת: " + error.message, "err");
    setShiftRoster(data ?? []);
  }, [selectedDate]);

  const fetchUnmatched = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("spa_import_unmatched")
      .select("*")
      .eq("appointment_date", selectedDate)
      .eq("resolved", false)
      .order("created_at", { ascending: false });
    if (error) showToast("שגיאה בטעינת שורות לא-משויכות: " + error.message, "err");
    setUnmatchedRows(data ?? []);
  }, [selectedDate]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStatic(), fetchAppointments(), fetchSpaAlerts(), fetchUnmatched(), fetchShiftRoster()]);
    setLoading(false);
  }, [fetchStatic, fetchAppointments, fetchSpaAlerts, fetchUnmatched, fetchShiftRoster]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("spa-board-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "spa_appointments" }, fetchAppointments)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_alerts" }, fetchSpaAlerts)
      .on("postgres_changes", { event: "*", schema: "public", table: "spa_import_unmatched" }, fetchUnmatched)
      .on("postgres_changes", { event: "*", schema: "public", table: "spa_shift_roster" }, fetchShiftRoster)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [fetchAppointments, fetchSpaAlerts, fetchUnmatched, fetchShiftRoster]);

  const apptsByRoom = useMemo(() => {
    const map = {};
    appointments.forEach((a) => {
      if (!map[a.room_id]) map[a.room_id] = [];
      map[a.room_id].push(a);
    });
    return map;
  }, [appointments]);

  const roomsById = useMemo(() => Object.fromEntries(rooms.map((r) => [r.id, r.name])), [rooms]);

  const multiRoomMap = useMemo(() => therapistsMultiRoomToday(appointments), [appointments]);
  const homeRoomByTherapist = useMemo(() => resolveHomeRoomMap(appointments, shiftRoster), [appointments, shiftRoster]);
  const bookedTherapistIdsToday = useMemo(
    () => new Set(appointments.filter((a) => a.therapist_id).map((a) => a.therapist_id)),
    [appointments]
  );

  // Soft ⚠ reasons for a card — never blocks save, purely informational (title tooltip).
  function apptWarnings(a) {
    const reasons = [];
    if (a.therapist_id && (multiRoomMap.get(a.therapist_id)?.size ?? 0) > 1) {
      reasons.push("מטפל/ת זה/ו משובץ/ת במספר חדרים היום");
    }
    if (genderPrefMismatch(a.guests?.guest_profile, a.spa_therapists?.gender)) {
      reasons.push("האורח/ת ביקש/ה «רק מטפלת» — המטפל/ת המשובץ/ת אינה מוגדרת כאישה");
    }
    return reasons;
  }

  // Agenda = flat chronological list of the day's appointments — no new
  // bucketing algorithm, just a sort on the already-loaded `appointments`
  // state (same TIME string comparison the room-columns view already relies
  // on implicitly via `.order("start_time")` in fetchAppointments).
  const agendaRows = useMemo(
    () => [...appointments].sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "")),
    [appointments]
  );

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
      guest: alert.guests
        ? { id: alert.guest_id, name: alert.guests.name, phone: alert.guests.phone, room: alert.guests.room, guest_profile: alert.guests.guest_profile }
        : null,
    });
  }

  function handleSaved() {
    setAssignDraft(null);
    showToast("✓ התור נקבע בהצלחה");
    fetchAppointments();
    fetchSpaAlerts();
  }

  function handleMoveSaved() {
    setMoveDraft(null);
    showToast("✓ האורח/ת הועבר/ה לחדר");
    setAlignBlocked((prev) => prev.filter((b) => b.apptId !== moveDraft?.id));
    fetchAppointments();
  }

  // «יישור יום» — seeds spa_shift_roster (existing rows win), then applies
  // only SAFE room_id moves (sim + cascade in planAlignDay). Blocked leftovers
  // never hit the DB — FAIL VISIBLE list for manual «העבר אורח». No EZGO /
  // cancel side effects. Race 23P01 on a "safe" move still surfaces in list.
  async function handleAlignDay() {
    setAlignRunning(true);
    setAlignBlocked([]);
    const roomTypeById = Object.fromEntries(rooms.map((r) => [r.id, r.room_type]));
    const allRoomIds = rooms.map((r) => r.id);
    const { rosterUpserts, safeMoves, swapPairs, blockedMoves } = planAlignDay(
      appointments,
      shiftRoster,
      roomTypeById,
      allRoomIds
    );

    if (rosterUpserts.length > 0) {
      const { error: rosterErr } = await supabase.from("spa_shift_roster").insert(rosterUpserts);
      if (rosterErr) {
        setAlignRunning(false);
        showToast("⚠ שגיאה בעדכון סידור המשמרת: " + rosterErr.message, "err");
        return;
      }
    }

    const therapistsById = Object.fromEntries(therapists.map((t) => [t.id, t.name]));
    const enrichBlocked = (move, reason) => {
      const appt = appointments.find((a) => a.id === move.apptId);
      return {
        apptId: move.apptId,
        guestName: appt?.guests?.name ?? "—",
        therapistName: therapistsById[move.therapistId] ?? "—",
        timeLabel: appt?.start_time ? `${appt.start_time.slice(0, 5)}${appt.end_time ? `–${appt.end_time.slice(0, 5)}` : ""}` : "—",
        fromRoomName: roomsById[move.fromRoomId] ?? "—",
        toRoomName: roomsById[move.toRoomId] ?? "—",
        reason: reason || move.reason || "room_full",
      };
    };

    let movedCount = 0;
    const blocked = blockedMoves.map((m) => enrichBlocked(m, "room_full"));

    for (const move of safeMoves) {
      const { error } = await supabase.from("spa_appointments").update({ room_id: move.toRoomId }).eq("id", move.apptId);
      if (error) blocked.push(enrichBlocked(move, "db_conflict"));
      else movedCount += 1;
    }

    // Mutual home-room swap: A→parking → B→A's home → A→B's former (= A's home target).
    // Three sequential UPDATEs never double-book the same single room mid-flight.
    for (const pair of swapPairs ?? []) {
      const { a, b, parkingRoomId } = pair;
      const step1 = await supabase.from("spa_appointments").update({ room_id: parkingRoomId }).eq("id", a.apptId);
      if (step1.error) {
        blocked.push(enrichBlocked(a, "db_conflict"), enrichBlocked(b, "db_conflict"));
        continue;
      }
      const step2 = await supabase.from("spa_appointments").update({ room_id: b.toRoomId }).eq("id", b.apptId);
      if (step2.error) {
        // Roll A back to original room so we don't leave a half-applied swap.
        await supabase.from("spa_appointments").update({ room_id: a.fromRoomId }).eq("id", a.apptId);
        blocked.push(enrichBlocked(a, "db_conflict"), enrichBlocked(b, "db_conflict"));
        continue;
      }
      const step3 = await supabase.from("spa_appointments").update({ room_id: a.toRoomId }).eq("id", a.apptId);
      if (step3.error) {
        await supabase.from("spa_appointments").update({ room_id: b.fromRoomId }).eq("id", b.apptId);
        await supabase.from("spa_appointments").update({ room_id: a.fromRoomId }).eq("id", a.apptId);
        blocked.push(enrichBlocked(a, "db_conflict"), enrichBlocked(b, "db_conflict"));
        continue;
      }
      movedCount += 2;
    }

    blocked.sort((a, b) => (a.timeLabel || "").localeCompare(b.timeLabel || ""));
    setAlignRunning(false);
    setAlignBlocked(blocked);
    fetchShiftRoster();
    fetchAppointments();
    if (movedCount === 0 && blocked.length === 0) {
      showToast("✓ כל התורים כבר בחדר הבית של המטפל/ת");
    } else {
      showToast(
        `✓ יושרו בבטחה ${movedCount} תורים${blocked.length ? ` · ⚠ ${blocked.length} ממתינים להעברה ידנית (למטה)` : ""}`,
        blocked.length ? "err" : "ok"
      );
    }
  }

  function handleImportDone(summary) {
    setShowImportZone(false);
    const parts = [];
    if (summary.created) parts.push(`${summary.created} תורים נוצרו`);
    if (summary.updated) parts.push(`${summary.updated} עודכנו`);
    if (summary.guests_created) parts.push(`${summary.guests_created} אורחי-יום נוצרו`);
    if (summary.meal_time_set) parts.push(`${summary.meal_time_set} שעת ארוחה נקלטה`);
    if (summary.skipped_cancelled) parts.push(`${summary.skipped_cancelled} מבוטלים ב-EZGO`);
    if (summary.date_from_file) parts.push(`תאריך מהקובץ ${summary.date_from_file}`);
    if (summary.date_mixed) parts.push("⚠ כמה תאריכים בקובץ — השתמשתי בתאריך שנבחר");
    if (summary.room_unmapped) parts.push(`${summary.room_unmapped} חדר לא מזוהה`);
    if (summary.conflicts) parts.push(`${summary.conflicts} התנגשויות`);
    if (summary.unmatched) parts.push(`${summary.unmatched} ללא שיוך`);
    if (summary.not_in_file) parts.push(`${summary.not_in_file} לא בקובץ (לא בוטלו)`);
    showToast(`✓ ייבוא הושלם — ${parts.join(" · ") || "אין שינויים"}`);
    if (summary.date_from_file && summary.date_from_file !== selectedDate) {
      setSelectedDate(summary.date_from_file);
    }
    fetchAppointments();
    fetchUnmatched();
  }

  async function handleDismissUnmatched(id) {
    const { error } = await supabase
      .from("spa_import_unmatched")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { showToast("⚠ שגיאה: " + error.message, "err"); return; }
    fetchUnmatched();
  }

  async function handleDismissAllUnmatched() {
    if (!unmatchedRows.length) return;
    const ids = unmatchedRows.map((r) => r.id);
    const { error } = await supabase
      .from("spa_import_unmatched")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .in("id", ids);
    if (error) { showToast("⚠ שגיאה בניקוי: " + error.message, "err"); return; }
    showToast(`✓ נוקו ${ids.length} שורות אזהרה`);
    fetchUnmatched();
  }

  async function handleAssignRoomAlias(row, roomId) {
    if (!roomId || !row.room_raw) return;
    const { error: aliasErr } = await supabase
      .from("spa_room_aliases")
      .insert({ ezgo_name: row.room_raw, room_id: Number(roomId) });
    if (aliasErr) {
      showToast(aliasErr.code === "23505" ? "⚠ השם הזה כבר משויך לחדר אחר" : "⚠ שגיאה בשיוך: " + aliasErr.message, "err");
      return;
    }
    await supabase.from("spa_import_unmatched").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", row.id);
    showToast("✓ החדר שויך — ייבוא הבא יזהה את השם הזה אוטומטית");
    fetchUnmatched();
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
        shiftRoster={shiftRoster}
        homeRoomByTherapist={homeRoomByTherapist}
        onClose={() => setAssignDraft(null)}
        onSaved={handleSaved}
      />

      {showShiftRosterPanel && (
        <ShiftRosterModal
          date={selectedDate}
          rooms={rooms}
          therapists={therapists}
          existingRoster={shiftRoster}
          bookedTherapistIds={bookedTherapistIdsToday}
          onClose={() => setShowShiftRosterPanel(false)}
          onSaved={() => { setShowShiftRosterPanel(false); showToast("✓ סידור המשמרת נשמר"); fetchShiftRoster(); }}
        />
      )}

      <SwapTherapistModal
        sourceAppt={swapSource}
        candidates={swapCandidates}
        onClose={() => setSwapDraft(null)}
        onSaved={() => { setSwapDraft(null); showToast("✓ המטפלים הוחלפו בהצלחה"); fetchAppointments(); }}
      />

      <MoveGuestModal
        appt={moveDraft}
        rooms={rooms}
        therapists={therapists}
        appointments={appointments}
        homeRoomByTherapist={homeRoomByTherapist}
        onClose={() => setMoveDraft(null)}
        onSaved={handleMoveSaved}
      />

      <ApptQuickEdit
        key={editAppt?.id ?? "closed"}
        appt={editAppt}
        roomName={editAppt ? (roomsById[editAppt.room_id] ?? "—") : ""}
        onClose={() => setEditAppt(null)}
        onPatched={(next) => {
          setAppointments((prev) => prev.map((a) => (a.id === next.id ? { ...a, ...next } : a)));
          setEditAppt((cur) => (cur && cur.id === next.id ? { ...cur, ...next } : cur));
        }}
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: "var(--black)" }}>תאריך:</label>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate(todayYmd())}>היום</button>
        <button className="btn btn-sm" onClick={() => setShowImportZone((v) => !v)} style={{ marginRight: "auto", background: showImportZone ? "var(--gold)" : "var(--ivory)", fontWeight: 700 }}>
          📊 ייבוא דוח פעילויות
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowTherapistPanel(true)}>
          ✏️ עריכת שמות מטפלים
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowShiftRosterPanel(true)}>
          🗓️ סידור משמרת
        </button>
        <button
          className="btn btn-sm"
          onClick={handleAlignDay}
          disabled={alignRunning}
          title="מיישר בבטחה: מעביר אורחים לחדר־בית רק כשהיעד פנוי (+ cascade). זוגות תקועים מחליפים דרך חדר ביניים. השאר — רשימה להעברה ידנית."
          style={{ background: "var(--gold)", color: "#412402", fontWeight: 700 }}
        >
          {alignRunning ? "מיישר…" : "🧭 יישור יום"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
        <span style={{ fontWeight: 700 }}>טיפ:</span>
        <span>לחיצה על תור → צבע + הערת צוות</span>
        <span style={{ opacity: 0.5 }}>·</span>
        {BOARD_COLORS.map((c) => (
          <span key={c.key} title={c.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.bg, border: `1.5px solid ${c.border}`, display: "inline-block" }} />
            {c.label}
          </span>
        ))}
      </div>

      {showImportZone && (
        <div style={{ marginBottom: 18 }}>
          <ActivitiesImportZone
            selectedDate={selectedDate}
            onImportDone={handleImportDone}
            onError={(msg) => showToast(msg, "err")}
          />
        </div>
      )}

      <UnmatchedPanel
        rows={unmatchedRows}
        rooms={rooms}
        onAssignRoom={handleAssignRoomAlias}
        onDismiss={handleDismissUnmatched}
        onDismissAll={handleDismissAllUnmatched}
      />

      {/* ── יישור יום blockers — FAIL VISIBLE, resolved via «העבר אורח» per row ── */}
      {alignBlocked.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#A32D2D" }}>
              ⚠ יישור יום — {alignBlocked.length} תורים ממתינים (חדר הבית מלא באותה שעה)
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setAlignBlocked([])}
              title="מסתיר את הרשימה בלי לשנות תורים"
              style={{ background: "var(--ivory)", color: "var(--text-muted)", fontWeight: 600 }}
            >
              סגור רשימה
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            היישור העביר רק תורים בטוחים. כאן נשארו מקרים שדורשים בחירה ידנית (החלפת חדר / העברת אורח אחר קודם).
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alignBlocked.map((b) => (
              <div key={b.apptId} style={{
                background: "#FFF5F5", border: "1px solid #E24B4A", borderRadius: 10,
                padding: "10px 14px", display: "flex", justifyContent: "space-between",
                alignItems: "center", flexWrap: "wrap", gap: 10,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {b.timeLabel} · {b.guestName}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    👤 {b.therapistName} · {b.fromRoomName} ← יעד: {b.toRoomName}
                    {b.reason === "db_conflict" ? " · ⚠ נחסם גם בשרת" : " · חדר מלא"}
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const appt = appointments.find((a) => a.id === b.apptId);
                    if (appt) setMoveDraft(appt);
                  }}
                  style={{ background: "var(--gold)", color: "#412402", fontWeight: 700 }}
                >
                  ➡️ העבר אורח
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── View tabs — agenda (default) / room-columns (secondary) ─────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, background: "var(--ivory)", borderRadius: 10, padding: 4 }}>
          <button
            className="btn btn-sm"
            onClick={() => setViewMode("agenda")}
            style={{ background: viewMode === "agenda" ? "var(--gold)" : "transparent", color: viewMode === "agenda" ? "#412402" : "var(--text-muted)", fontWeight: 700 }}
          >
            🕐 אג׳נדה שעתית
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setViewMode("rooms")}
            style={{ background: viewMode === "rooms" ? "var(--gold)" : "transparent", color: viewMode === "rooms" ? "#412402" : "var(--text-muted)", fontWeight: 700 }}
          >
            🚪 לפי חדרים
          </button>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setAssignDraft({ date: selectedDate, guest: null, roomId: "" })}
          style={{ marginRight: "auto" }}
        >
          + קבע תור
        </button>
      </div>

      {/* ── Agenda view — flat chronological list, default (Mike, locked) ───── */}
      {viewMode === "agenda" && (
        <div style={{ marginBottom: 24 }}>
          {agendaRows.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              אין תורים ליום זה
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {agendaRows.map((a) => {
                const cStyle = boardColorStyle(a.board_color);
                const hasNote = !!(a.staff_note || a.notes);
                const warnings = apptWarnings(a);
                return (
                  <div
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditAppt(a)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditAppt(a); } }}
                    title="לחץ לעריכת צבע והערה"
                    style={{
                      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                      background: cStyle?.bg ?? "var(--card-bg)",
                      border: `1.5px solid ${cStyle?.border ?? (a.therapist_id ? "var(--border)" : "#E8AE0A")}`,
                      borderRight: `4px solid ${cStyle?.border ?? (a.therapist_id ? "var(--border)" : "#E8AE0A")}`,
                      borderRadius: 10, padding: "10px 14px", cursor: "pointer", transition: "box-shadow 0.12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
                  >
                    <div style={{ minWidth: 92, fontWeight: 800, fontSize: 14, color: cStyle?.text }}>
                      {a.start_time?.slice(0, 5)}–{a.end_time?.slice(0, 5)}
                    </div>
                    <div style={{ minWidth: 120, fontWeight: 700, fontSize: 13 }}>{roomsById[a.room_id] ?? "—"}</div>
                    <div style={{ minWidth: 140, fontSize: 13 }}>{a.guests?.name ?? "—"}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.treatment_type || ""}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: "auto" }}>
                      {hasNote && <span title={a.staff_note || a.notes}>📝</span>}
                      {warnings.length > 0 && (
                        <span title={warnings.join(" · ")} style={{ fontSize: 11, color: "#A32D2D", fontWeight: 700 }}>⚠</span>
                      )}
                      {a.spa_therapists?.name ? (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>👤 {a.spa_therapists.name}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#8A6A00", fontWeight: 700 }}>⚠ טרם שובץ מטפל/ת</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Room-columns board — secondary tab ───────────────────────────────── */}
      {viewMode === "rooms" && [{ label: "חדרי זוגות", list: couples }, { label: "חדרי יחיד", list: singles }].map((group) => (
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
                      ) : roomAppts.map((a) => {
                        const cStyle = boardColorStyle(a.board_color);
                        const hasNote = !!(a.staff_note || a.notes);
                        const warnings = apptWarnings(a);
                        return (
                          <div
                            key={a.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setEditAppt(a)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditAppt(a); } }}
                            title="לחץ לעריכת צבע והערה"
                            style={{
                              background: cStyle?.bg ?? "var(--ivory)",
                              borderRadius: 8, padding: "7px 8px",
                              border: `1.5px solid ${cStyle?.border ?? (a.therapist_id ? "var(--border)" : "#E8AE0A")}`,
                              borderRight: `4px solid ${cStyle?.border ?? (a.therapist_id ? "var(--border)" : "#E8AE0A")}`,
                              cursor: "pointer", transition: "box-shadow 0.12s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 700, color: cStyle?.text }}>
                              {a.start_time?.slice(0, 5)}–{a.end_time?.slice(0, 5)}
                              {hasNote ? " 📝" : ""}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{a.guests?.name ?? "—"}</div>
                            {a.staff_note && (
                              <div style={{
                                fontSize: 11, marginTop: 3, color: cStyle?.text ?? "var(--text-muted)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                opacity: 0.9,
                              }}>
                                {a.staff_note}
                              </div>
                            )}
                            {!a.staff_note && a.notes && (
                              <div style={{ fontSize: 11, marginTop: 3, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {a.notes}
                              </div>
                            )}
                            {a.spa_therapists?.name ? (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, marginTop: 2 }}>
                                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                  👤 {a.spa_therapists.name}
                                  {warnings.length > 0 && (
                                    <span title={warnings.join(" · ")} style={{ marginRight: 4, color: "#A32D2D", fontWeight: 700 }}>⚠</span>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setMoveDraft(a); }}
                                    title="העבר אורח לחדר הבית של המטפל/ת"
                                    style={{
                                      minHeight: 26, minWidth: 26, padding: 0, borderRadius: 6,
                                      border: "1px solid var(--border)", background: "var(--card-bg)",
                                      cursor: "pointer", fontSize: 12, lineHeight: 1,
                                    }}
                                  >
                                    ➡️
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSwapDraft(a); }}
                                    title="החלפת מטפל/ת (חריג — עדיף להעביר את האורח)"
                                    style={{
                                      minHeight: 26, minWidth: 26, padding: 0, borderRadius: 6,
                                      border: "1px solid var(--border)", background: "var(--card-bg)",
                                      cursor: "pointer", fontSize: 12, lineHeight: 1,
                                    }}
                                  >
                                    🔄
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: "#8A6A00", fontWeight: 700, marginTop: 2 }}>⚠ טרם שובץ מטפל/ת</div>
                            )}
                          </div>
                        );
                      })}
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
