// Shared smart-profile fields — VIP, occasion, dietary, arrival context, ETA.
// Single source for AddGuestModal (merged save) and GuestProfileModal (legacy modal).
import { useMemo, useState } from "react";
import {
  VIP_STATUSES,
  OCCASION_TYPES,
  DIETARY_TAGS,
  ARRIVAL_CONTEXT_TAGS,
  toggleTag,
} from "../data/guestProfileSchema";
import { BOOKING_TYPES } from "../data/stayMealsSchema";
import { inferBookingTypeFromGuest, bookingTypeLabel } from "../utils/guestStaySummary";

function Chip({ active, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: "Heebo,sans-serif",
        border: active ? "2px solid var(--gold,#C9A96E)" : "1.5px solid var(--border,#ddd)",
        background: active ? "rgba(201,169,110,0.18)" : "var(--card-bg,#fff)",
        color: active ? "var(--gold-dark,#A8843A)" : "var(--text-muted,#666)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/** Mutate normalized guest_profile state by dotted path. */
export function applyGuestProfileField(profile, path, value) {
  const next = { ...profile };
  if (path === "vip_status") next.vip_status = value;
  else if (path === "staff_note") next.staff_note = value;
  else if (path.startsWith("occasion.")) {
    const key = path.split(".")[1];
    next.occasion = { ...next.occasion, [key]: value };
  } else if (path.startsWith("dietary.")) {
    const key = path.split(".")[1];
    next.dietary = { ...next.dietary, [key]: value };
  } else if (path.startsWith("arrival_context.")) {
    const key = path.split(".")[1];
    next.arrival_context = { ...next.arrival_context, [key]: value };
  } else if (path.startsWith("stay.")) {
    const key = path.split(".")[1];
    next.stay = { ...next.stay, [key]: value };
  }
  return next;
}

export default function GuestSmartProfileFields({
  profile,
  onProfileChange,
  arrivalTime,
  onArrivalTimeChange,
  guest,
  saving = false,
  showGuestNotesAudit = true,
}) {
  const resolvedBookingType = useMemo(
    () => inferBookingTypeFromGuest({ ...guest, guest_profile: profile }),
    [guest, profile],
  );

  const setProfileField = (path, value) => {
    onProfileChange(applyGuestProfileField(profile, path, value));
  };

  return (
    <div style={{
      marginBottom: 14, padding: "12px 14px", borderRadius: 10,
      background: "rgba(27,58,50,0.04)", border: "1px solid rgba(27,58,50,0.15)",
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#1B3A32", marginBottom: 12 }}>
        📋 פרופיל אורח — VIP · אירוע · תזונה · הגעה
      </div>

      <Section title="סוג הזמנה">
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>
          {bookingTypeLabel(resolvedBookingType)}
          {profile.stay?.booking_type === "auto" && guest?.guest_notes && (
            <span style={{ marginRight: 6 }}> (זוהה מהערות)</span>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {BOOKING_TYPES.map(({ id, label }) => (
            <Chip
              key={id}
              label={label}
              active={profile.stay?.booking_type === id}
              disabled={saving}
              onClick={() => setProfileField("stay.booking_type", id)}
            />
          ))}
        </div>
        {resolvedBookingType === "group" && guest?.guest_notes && (
          <div style={{
            fontSize: 11, lineHeight: 1.5, padding: 10, borderRadius: 8, marginTop: 8,
            background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E",
          }}>
            <strong>פרטי אורח מהערות:</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{guest.guest_notes}</div>
          </div>
        )}
      </Section>

      <Section title="סטטוס VIP">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {VIP_STATUSES.map(({ id, label }) => (
            <Chip
              key={id}
              label={label}
              active={profile.vip_status === id}
              disabled={saving}
              onClick={() => setProfileField("vip_status", id)}
            />
          ))}
        </div>
      </Section>

      <Section title="אירוע מיוחד">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {OCCASION_TYPES.map(({ id, label }) => (
            <Chip
              key={id}
              label={label}
              active={profile.occasion?.type === id}
              disabled={saving}
              onClick={() => setProfileField("occasion.type", id)}
            />
          ))}
        </div>
        {profile.occasion?.type !== "none" && (
          <>
            <label style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>
              תאריך האירוע
            </label>
            <input
              type="date"
              value={profile.occasion?.date ?? ""}
              onChange={(e) => setProfileField("occasion.date", e.target.value)}
              disabled={saving}
              style={{
                width: "100%", padding: "8px 10px", marginBottom: 8, boxSizing: "border-box",
                border: "1px solid var(--border)", borderRadius: 8, direction: "ltr",
              }}
            />
            <input
              type="text"
              placeholder="פרטים (עוגה בחדר, פרחים...)"
              value={profile.occasion?.note ?? ""}
              onChange={(e) => setProfileField("occasion.note", e.target.value)}
              disabled={saving}
              style={{
                width: "100%", padding: "8px 10px", boxSizing: "border-box",
                border: "1px solid var(--border)", borderRadius: 8,
              }}
            />
          </>
        )}
      </Section>

      <Section title="צרכים תזונתיים">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {DIETARY_TAGS.map(({ id, label }) => (
            <Chip
              key={id}
              label={label}
              active={(profile.dietary?.tags ?? []).includes(id)}
              disabled={saving}
              onClick={() =>
                setProfileField("dietary.tags", toggleTag(profile.dietary?.tags ?? [], id))
              }
            />
          ))}
        </div>
        <input
          type="text"
          placeholder="הערות תזונה נוספות"
          value={profile.dietary?.note ?? ""}
          onChange={(e) => setProfileField("dietary.note", e.target.value)}
          disabled={saving}
          style={{
            width: "100%", padding: "8px 10px", boxSizing: "border-box",
            border: "1px solid var(--border)", borderRadius: 8,
          }}
        />
      </Section>

      <Section title="הקשר הגעה">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {ARRIVAL_CONTEXT_TAGS.map(({ id, label }) => (
            <Chip
              key={id}
              label={label}
              active={(profile.arrival_context?.tags ?? []).includes(id)}
              disabled={saving}
              onClick={() =>
                setProfileField(
                  "arrival_context.tags",
                  toggleTag(profile.arrival_context?.tags ?? [], id),
                )
              }
            />
          ))}
        </div>
        <input
          type="text"
          placeholder="פרטי הגעה (מאוחר, חניה, וכו')"
          value={profile.arrival_context?.note ?? ""}
          onChange={(e) => setProfileField("arrival_context.note", e.target.value)}
          disabled={saving}
          style={{
            width: "100%", padding: "8px 10px", boxSizing: "border-box",
            border: "1px solid var(--border)", borderRadius: 8,
          }}
        />
      </Section>

      <Section title="שעת הגעה משוערת (ETA)">
        <input
          type="time"
          value={arrivalTime ?? ""}
          onChange={(e) => onArrivalTimeChange(e.target.value)}
          disabled={saving}
          style={{
            width: "100%", padding: "8px 10px", boxSizing: "border-box",
            border: "1px solid var(--border)", borderRadius: 8, direction: "ltr",
          }}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          נכתב גם אוטומטית כשהאורח מדווח בוואטסאפ — ניתן לעריכה ידנית
        </div>
      </Section>

      <Section title="הערת צוות">
        <textarea
          rows={2}
          placeholder="הערה קצרה לצוות (לא לוג מערכת)"
          value={profile.staff_note ?? ""}
          onChange={(e) => setProfileField("staff_note", e.target.value)}
          disabled={saving}
          style={{
            width: "100%", padding: "8px 10px", boxSizing: "border-box",
            border: "1px solid var(--border)", borderRadius: 8, resize: "vertical",
          }}
        />
      </Section>

      {showGuestNotesAudit && guest?.guest_notes && (
        <GuestNotesAudit guestNotes={guest.guest_notes} />
      )}
    </div>
  );
}

function GuestNotesAudit({ guestNotes }) {
  const [auditOpen, setAuditOpen] = useState(false);
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        type="button"
        onClick={() => setAuditOpen((o) => !o)}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
          fontFamily: "Heebo,sans-serif",
        }}
      >
        {auditOpen ? "▼ הסתר היסטוריית מערכת" : "▶ היסטוריית מערכת (לוג בוט — לקריאה בלבד)"}
      </button>
      {auditOpen && (
        <div
          style={{
            marginTop: 8, whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.5,
            background: "var(--ivory)", borderRadius: 8, padding: 10,
            border: "1px solid var(--border)", maxHeight: 140, overflowY: "auto",
            color: "#555",
          }}
        >
          {guestNotes}
        </div>
      )}
    </div>
  );
}
