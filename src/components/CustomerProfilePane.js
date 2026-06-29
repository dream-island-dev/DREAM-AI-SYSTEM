// src/components/CustomerProfilePane.js
// Slide-out guest drawer — stay summary + Smart Guest Profile (session 62/64).
import { useState, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import GuestAttentionBadge from "./GuestAttentionBadge";
import GuestProfileModal from "./GuestProfileModal";
import {
  getProfileDisplayChips,
  hasMeaningfulProfile,
} from "../data/guestProfileSchema";

const DEFAULT_CHECKOUT_TIME = "11:00";

function nightsBetween(arrivalDate, departureDate) {
  if (!arrivalDate || !departureDate) return null;
  const ms = new Date(departureDate).getTime() - new Date(arrivalDate).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.round(ms / 86400000);
}

function fmtDateHe(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("he-IL", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function CustomerProfilePane({ guest, onClose, onGuestUpdated, showToast }) {
  const [liveGuest, setLiveGuest] = useState(guest);
  const [profileOpen, setProfileOpen] = useState(false);
  const [checkoutTime, setCheckoutTime] = useState(null);
  const [loadingCheckout, setLoadingCheckout] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    setLiveGuest(guest);
  }, [guest]);

  const handleGuestUpdated = (updated) => {
    setLiveGuest(updated);
    onGuestUpdated?.(updated);
  };

  async function copyPortalLink() {
    if (!liveGuest?.portal_token) return;
    const url = `${window.location.origin}/portal/${liveGuest.portal_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      window.prompt("העתיקו את הקישור לפורטל האורח:", url);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingCheckout(true);
      if (isSupabaseConfigured && supabase && liveGuest?.phone) {
        const { data } = await supabase
          .from("suite_rooms")
          .select("checkout_time")
          .eq("guest_phone", liveGuest.phone)
          .not("checkout_time", "is", null)
          .limit(1)
          .maybeSingle();
        if (active) setCheckoutTime(data?.checkout_time ?? null);
      }
      if (active) setLoadingCheckout(false);
    })();
    return () => { active = false; };
  }, [liveGuest?.phone]);

  if (!liveGuest) return null;

  const nights = nightsBetween(liveGuest.arrival_date, liveGuest.departure_date);
  const effectiveCheckoutTime = checkoutTime || DEFAULT_CHECKOUT_TIME;
  const profileChips = getProfileDisplayChips(liveGuest.guest_profile, liveGuest.arrival_time);
  const p = liveGuest.guest_profile && typeof liveGuest.guest_profile === "object"
    ? liveGuest.guest_profile
    : {};
  const staffNote = typeof p.staff_note === "string" ? p.staff_note.trim() : "";
  const dietaryNote = p.dietary?.note?.trim?.() ?? "";
  const arrivalNote = p.arrival_context?.note?.trim?.() ?? "";
  const occasionNote = p.occasion?.note?.trim?.() ?? "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9998, direction: "ltr",
        background: "rgba(0,0,0,0.45)", display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 380, height: "100%", background: "var(--card-bg)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.18)", direction: "rtl", overflowY: "auto",
          padding: "24px 22px", fontFamily: "Heebo, sans-serif",
          animation: "cpp-slide-in 0.2s ease-out",
        }}
      >
        <style>{`@keyframes cpp-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 19, fontWeight: 800, color: "var(--black)" }}>{liveGuest.name}</span>
              <GuestAttentionBadge
                guest={liveGuest}
                onUpdated={handleGuestUpdated}
                showToast={showToast}
              />
              {liveGuest.arrival_confirmed && (
                <span style={{
                  fontSize: 10, background: "#E8F5EF", color: "#1A7A4A",
                  padding: "2px 6px", borderRadius: 8, fontWeight: 700,
                }}>✓ אישר הגעה</span>
              )}
            </div>
            {liveGuest.phone && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>📞 {liveGuest.phone}</div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)",
              background: "var(--ivory)", cursor: "pointer", fontSize: 14, color: "var(--text-muted)",
            }}
          >✕</button>
        </div>

        {liveGuest.room && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
            🚪 {liveGuest.room}
          </div>
        )}

        {/* Smart Guest Profile — same data as red-alert modal */}
        <div style={{
          background: "var(--ivory)", borderRadius: 12, padding: "12px 14px",
          marginBottom: 14, border: "1px solid var(--border)",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: profileChips.length || staffNote ? 10 : 0,
          }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)" }}>📋 פרופיל אורח</span>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              style={{
                padding: "4px 10px", borderRadius: 8, border: "1px solid var(--gold)",
                background: "rgba(201,169,110,0.12)", color: "var(--gold-dark)",
                fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "Heebo,sans-serif",
              }}
            >
              {hasMeaningfulProfile(liveGuest.guest_profile) || liveGuest.arrival_time ? "✏️ ערוך" : "+ הוסף"}
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
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>אין תגיות פרופיל — לחץ הוסף</div>
          )}
          {(staffNote || dietaryNote || arrivalNote || occasionNote) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#444", lineHeight: 1.5 }}>
              {[staffNote, dietaryNote, arrivalNote, occasionNote].filter(Boolean).map((line, i) => (
                <div key={i} style={{ marginTop: i ? 4 : 0 }}>{line}</div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={copyPortalLink}
          disabled={!liveGuest.portal_token}
          title={!liveGuest.portal_token ? "אין קישור פורטל לאורח זה" : undefined}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            width: "100%", padding: "9px 12px", borderRadius: 10, marginBottom: 16,
            border: `1px solid ${linkCopied ? "#16A34A" : "var(--gold)"}`,
            background: linkCopied ? "#ECFDF5" : "var(--ivory)",
            color: linkCopied ? "#16A34A" : "var(--gold-dark)",
            fontSize: 13, fontWeight: 700, fontFamily: "Heebo, sans-serif",
            cursor: liveGuest.portal_token ? "pointer" : "not-allowed",
            opacity: liveGuest.portal_token ? 1 : 0.5,
          }}
        >
          {linkCopied ? "✓ הקישור הועתק" : "🔗 העתק קישור לפורטל האורח"}
        </button>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20,
        }}>
          <div style={{ background: "var(--ivory)", borderRadius: 12, padding: "14px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--gold-dark)" }}>
              {nights != null ? nights : "—"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>סה״כ לילות</div>
          </div>
          <div style={{ background: "var(--ivory)", borderRadius: 12, padding: "14px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--gold-dark)" }}>
              {loadingCheckout ? "⏳" : effectiveCheckoutTime}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>שעת צ׳ק-אאוט</div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-muted)" }}>תאריך הגעה</span>
            <span style={{ fontWeight: 700 }}>{fmtDateHe(liveGuest.arrival_date)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-muted)" }}>תאריך עזיבה רשמי</span>
            <span style={{ fontWeight: 700 }}>{fmtDateHe(liveGuest.departure_date)}</span>
          </div>
          {!checkoutTime && !loadingCheckout && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              ⚠ לא נמצאה שעת צ׳ק-אאוט ספציפית להזמנה זו — מוצגת שעת ברירת המחדל של המלון.
            </div>
          )}
        </div>
      </div>

      {profileOpen && (
        <GuestProfileModal
          guest={liveGuest}
          onClose={() => setProfileOpen(false)}
          onUpdated={handleGuestUpdated}
          showToast={showToast}
          showMarkHandled={!!liveGuest.requires_attention}
          heading="📋 פרופיל אורח חכם"
        />
      )}
    </div>
  );
}
