// src/components/GuestAttentionBadge.js
// Shared "needs attention" badge + note modal for guests.requires_attention /
// guests.guest_notes. Used by both GuestsPage.js ("צ'ק-אין") and
// GuestDashboard.js ("ניהול אורחים") so both surfaces show identical guest
// state — Single Source of Truth principle, CLAUDE.md §0.5.
import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function GuestAttentionBadge({ guest, onUpdated, showToast }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!guest?.requires_attention) return null;

  // attention_reason distinguishes WHY (migration 057) — date_change and
  // human_callback both used to collapse into the same generic red dot.
  const REASON_META = {
    date_change:    { icon: "🗓️", title: "ביקש/ה שינוי בתאריך הגעה — לחץ לפרטים", heading: "🗓️ ביקש/ה שינוי בתאריך" },
    human_callback: { icon: "📞", title: "ביקש/ה לדבר עם נציג — לחץ לפרטים",       heading: "📞 ביקש/ה לדבר עם נציג" },
  };
  const reasonMeta = REASON_META[guest.attention_reason] ?? {
    icon: "🔴", title: "דורש טיפול — לחץ לצפייה בהערה", heading: "🔴 דורש טיפול",
  };

  const handleMarkHandled = async () => {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase
      .from("guests")
      .update({ requires_attention: false, attention_reason: null })
      .eq("id", guest.id);
    setSaving(false);
    if (error) {
      showToast?.("err", "שגיאה: " + error.message);
      return;
    }
    onUpdated?.({ ...guest, requires_attention: false, attention_reason: null });
    setOpen(false);
  };

  return (
    <>
      <span
        onClick={() => setOpen(true)}
        title={reasonMeta.title}
        style={{ fontSize: 11, marginRight: 4, verticalAlign: "middle", cursor: "pointer" }}
      >
        {reasonMeta.icon}
      </span>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card-bg)", borderRadius: 12, padding: 24,
              maxWidth: 420, width: "90%", direction: "rtl", textAlign: "right",
              boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "var(--gold-dark)" }}>
              {reasonMeta.heading} — {guest.name || "אורח"}
            </h3>
            <div
              style={{
                whiteSpace: "pre-wrap", background: "var(--ivory)", borderRadius: 8,
                padding: 12, fontSize: 14, color: "#333", maxHeight: 240, overflowY: "auto",
                border: "1px solid var(--border)",
              }}
            >
              {guest.guest_notes || "אין הערות רשומות."}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-sm" onClick={() => setOpen(false)} style={{ background: "var(--ivory)" }}>
                סגור
              </button>
              <button
                className="btn btn-sm"
                disabled={saving}
                onClick={handleMarkHandled}
                style={{ background: "#E8F5EF", color: "#1A7A4A", fontWeight: 700 }}
              >
                {saving ? "שומר…" : "✓ סמן כטופל"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
