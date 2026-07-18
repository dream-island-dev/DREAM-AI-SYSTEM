// Legacy modal wrapper — prefer AddGuestModal (merged profile). Kept for CustomerProfilePane.
import { useState } from "react";
import { supabase } from "../supabaseClient";
import { normalizeGuestProfile, serializeGuestProfile } from "../data/guestProfileSchema";
import GuestSmartProfileFields from "./GuestSmartProfileFields";

const ATTENTION_HEADINGS = {
  date_change:    "🗓️ ביקש/ה שינוי בתאריך",
  human_callback: "📞 ביקש/ה לדבר עם נציג",
  "בקשת טיפול בספא": "💆 ביקש/ה טיפול בספא מהפורטל",
};

export default function GuestProfileModal({
  guest,
  onClose,
  onUpdated,
  showToast,
  heading,
  showMarkHandled = !!guest?.requires_attention,
  onOpenDreamBotChat,
}) {
  const [profile, setProfile] = useState(() => normalizeGuestProfile(guest?.guest_profile));
  const [arrivalTime, setArrivalTime] = useState(guest?.arrival_time ?? "");
  const [saving, setSaving] = useState(false);

  if (!guest?.id) return null;

  const title =
    heading
    ?? ATTENTION_HEADINGS[guest.attention_reason]
    ?? "📋 פרופיל אורח";

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
        zIndex: 1200, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)", borderRadius: 14, padding: "22px 24px",
          maxWidth: 560, width: "100%", maxHeight: "92vh", overflowY: "auto",
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

        {guest.phone && onOpenDreamBotChat && (
          <button
            type="button"
            onClick={() => {
              onOpenDreamBotChat({ phone: guest.phone, guestName: guest.name });
              onClose?.();
            }}
            disabled={saving}
            style={{
              width: "100%", minHeight: 48, marginBottom: 18, padding: "12px 16px",
              borderRadius: 10, border: "2px solid var(--gold, #C9A96E)",
              background: "linear-gradient(135deg, var(--ivory, #F5F0E8), rgba(201,169,110,0.22))",
              color: "var(--gold-dark, #A8843A)", fontFamily: "Heebo, sans-serif",
              fontSize: 14, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            💬 פתח שיחה ב-DREAM BOT
          </button>
        )}

        <GuestSmartProfileFields
          profile={profile}
          onProfileChange={setProfile}
          arrivalTime={arrivalTime}
          onArrivalTimeChange={setArrivalTime}
          guest={guest}
          saving={saving}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => onClose?.()} disabled={saving} style={{ background: "var(--ivory)" }}>
            סגור
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={saving}
            onClick={() => handleSave(false)}
            style={{ background: "linear-gradient(135deg,var(--gold),var(--gold-dark))", color: "#0F0F0F", fontWeight: 800 }}
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
