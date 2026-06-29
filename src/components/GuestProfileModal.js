// src/components/GuestProfileModal.js
// Structured Smart Guest Profile editor — VIP, occasion, dietary, arrival context.
// Opened from GuestAttentionBadge (red alert) or AddGuestModal (edit flow).
import { useState } from "react";
import { supabase } from "../supabaseClient";
import {
  VIP_STATUSES,
  OCCASION_TYPES,
  DIETARY_TAGS,
  ARRIVAL_CONTEXT_TAGS,
  normalizeGuestProfile,
  serializeGuestProfile,
  toggleTag,
} from "../data/guestProfileSchema";

const ATTENTION_HEADINGS = {
  date_change:    "🗓️ ביקש/ה שינוי בתאריך",
  human_callback: "📞 ביקש/ה לדבר עם נציג",
};

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

export default function GuestProfileModal({
  guest,
  onClose,
  onUpdated,
  showToast,
  heading,
  showMarkHandled = !!guest?.requires_attention,
}) {
  const [profile, setProfile] = useState(() => normalizeGuestProfile(guest?.guest_profile));
  const [arrivalTime, setArrivalTime] = useState(guest?.arrival_time ?? "");
  const [auditOpen, setAuditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!guest?.id) return null;

  const title =
    heading
    ?? ATTENTION_HEADINGS[guest.attention_reason]
    ?? "📋 פרופיל אורח חכם";

  const setProfileField = (path, value) => {
    setProfile((prev) => {
      const next = { ...prev };
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
      }
      return next;
    });
  };

  const handleSave = async (markHandled = false) => {
    if (!supabase) return;
    setSaving(true);
    const patch = {
      guest_profile: serializeGuestProfile(profile),
      arrival_time: (arrivalTime ?? "").trim() || null,
    };
    if (markHandled) {
      patch.requires_attention = false;
      patch.attention_reason = null;
    }
    const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
    setSaving(false);
    if (error) {
      showToast?.("err", "שגיאה: " + error.message);
      return;
    }
    const updated = { ...guest, ...patch };
    onUpdated?.(updated);
    showToast?.("ok", markHandled ? "✓ פרופיל נשמר והתראה נסגרה" : "✓ פרופיל אורח נשמר");
    onClose?.();
  };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (!saving) onClose?.();
      }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1100, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)", borderRadius: 14, padding: "22px 24px",
          maxWidth: 520, width: "100%", maxHeight: "92vh", overflowY: "auto",
          direction: "rtl", textAlign: "right",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
        }}
      >
        <h3 style={{ margin: "0 0 4px", color: "var(--gold-dark)", fontSize: 17 }}>
          {title} — {guest.name || "אורח"}
        </h3>
        {guest.phone && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16, direction: "ltr" }}>
            {guest.phone}
          </div>
        )}

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
                active={profile.occasion.type === id}
                disabled={saving}
                onClick={() => setProfileField("occasion.type", id)}
              />
            ))}
          </div>
          {profile.occasion.type !== "none" && (
            <>
              <label style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>
                תאריך האירוע
              </label>
              <input
                type="date"
                value={profile.occasion.date ?? ""}
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
                value={profile.occasion.note ?? ""}
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
                active={profile.dietary.tags.includes(id)}
                disabled={saving}
                onClick={() =>
                  setProfileField("dietary.tags", toggleTag(profile.dietary.tags, id))
                }
              />
            ))}
          </div>
          <input
            type="text"
            placeholder="הערות תזונה נוספות"
            value={profile.dietary.note ?? ""}
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
                active={profile.arrival_context.tags.includes(id)}
                disabled={saving}
                onClick={() =>
                  setProfileField(
                    "arrival_context.tags",
                    toggleTag(profile.arrival_context.tags, id),
                  )
                }
              />
            ))}
          </div>
          <input
            type="text"
            placeholder="פרטי הגעה (מאוחר, חניה, וכו')"
            value={profile.arrival_context.note ?? ""}
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
            onChange={(e) => setArrivalTime(e.target.value)}
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

        {guest.guest_notes && (
          <div style={{ marginBottom: 16 }}>
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
                {guest.guest_notes}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onClose?.()}
            disabled={saving}
            style={{ background: "var(--ivory)" }}
          >
            סגור
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={saving}
            onClick={() => handleSave(false)}
            style={{
              background: "linear-gradient(135deg,var(--gold),var(--gold-dark))",
              color: "#0F0F0F", fontWeight: 800,
            }}
          >
            {saving ? "שומר…" : "💾 שמור פרופיל"}
          </button>
          {showMarkHandled && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving}
              onClick={() => handleSave(true)}
              style={{ background: "#E8F5EF", color: "#1A7A4A", fontWeight: 700 }}
            >
              {saving ? "שומר…" : "✓ שמור וסמן כטופל"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
