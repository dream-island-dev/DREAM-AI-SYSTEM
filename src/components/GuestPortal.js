// src/components/GuestPortal.js
// Pre-Arrival Guest Portal — Sprint 10.1 (Magic Link & Itinerary Hero).
//
// Public, password-less, mobile-first. Mounted directly from index.js for
// any /portal/:token URL — BEFORE <App/> — so the entire staff-auth hook
// chain (Supabase session listener, push subscription, etc.) never runs for
// an unauthenticated guest opening their own link. No react-router-dom in
// this project (CLAUDE.md §2); this is the one public route, so a single
// path check in index.js is simpler/safer than adding a routing library.
//
// SECURITY: `token` is the magic-link credential (guests.portal_token,
// migration 083) — NOT the guest's phone number. See that migration's
// comment for why /portal/:phone (as the directive literally asked for)
// would have been a real PII-exposure bug.
//
// Dream Island "XOS" guest-facing palette — deliberately distinct from the
// staff app's --gold/--ivory CSS variables (§11 of CLAUDE.md): deep dark
// (#0f172a/#09090b) + champagne gold (#D4AF37), glassmorphism panels, per
// the directive's GLOBAL LUXURY BRANDING PROTOCOL.
import { useEffect, useState, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import PhotoTour from "./PhotoTour";

const XOS_GOLD = "#D4AF37";
const XOS_BG_TOP = "#0f172a";
const XOS_BG_BOTTOM = "#09090b";

// Mirrors bot_config.hotel_checkin_time's seeded default ("15:00", migration
// 015) — kept as a constant here rather than an extra fetch so the public
// portal stays a single round-trip. If Mike changes the real check-in time
// in BotConfigPanel, this countdown target won't auto-follow; low-stakes
// drift for a "the room will likely be ready around then" estimate, not
// worth a second public Edge Function call to avoid.
const DEFAULT_CHECKIN_TIME = "15:00";

function useCountdown(targetIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  if (!targetIso) return null;
  const diffMs = new Date(targetIso).getTime() - now;
  if (diffMs <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  const seconds = Math.floor(diffMs / 1000) % 60;
  const minutes = Math.floor(diffMs / 60000) % 60;
  const hours   = Math.floor(diffMs / 3600000) % 24;
  const days    = Math.floor(diffMs / 86400000);
  return { days, hours, minutes, seconds, expired: false };
}

function fmtDateHe(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("he-IL", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function CountdownUnit({ value, label }) {
  return (
    <div style={{ textAlign: "center", minWidth: 56 }}>
      <div style={{
        fontFamily: "Playfair Display, serif", fontSize: 30, fontWeight: 700,
        color: XOS_GOLD, lineHeight: 1,
      }}>
        {String(value).padStart(2, "0")}
      </div>
      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>{label}</div>
    </div>
  );
}

function ItineraryRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px", borderBottom: "1px solid rgba(212,175,55,0.15)",
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div style={{ textAlign: "right", flex: 1 }}>
        <div style={{ fontSize: 11, color: "#9CA3AF" }}>{label}</div>
        <div style={{ fontSize: 14, color: "#F3F4F6", fontWeight: 600, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

export default function GuestPortal({ token }) {
  const [guest, setGuest]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [upsellBusy, setUpsellBusy] = useState(null);
  const [toast, setToast]       = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase || !token) {
        setLoadError("הקישור אינו תקין.");
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("guest-portal-data", { body: { token } });
        if (!active) return;
        if (error || !data?.ok) {
          setLoadError(data?.error === "guest_not_found" ? "לא מצאנו הזמנה התואמת לקישור הזה." : "שגיאה בטעינת הפרופיל.");
        } else {
          setGuest(data.guest);
        }
      } catch (e) {
        if (active) setLoadError(e?.message ?? "שגיאה בטעינה.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }

  async function handleUpsell(upsellLabel) {
    if (upsellBusy) return;
    setUpsellBusy(upsellLabel);
    try {
      const { data, error } = await supabase.functions.invoke("guest-portal-upsell", { body: { token, upsellLabel } });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      showToast("בקשתך הועברה בהצלחה ✨ הצוות שלנו כבר בדרך");
    } catch (e) {
      showToast("⚠️ לא הצלחנו לשלוח את הבקשה — נסו שוב או פנו לקבלה");
    } finally {
      setUpsellBusy(null);
    }
  }

  // ── Stay-phase logic — computed (and useCountdown called) BEFORE the
  // loading/error early-returns below, unconditionally on every render, so
  // this hook never violates the Rules of Hooks (guest is null during/after
  // a failed load — every field access below is optional-chained for that). ──
  const today = new Date().toISOString().slice(0, 10);
  let phase = "unknown";
  if (guest?.departure_date && guest.departure_date < today)      phase = "past";
  else if (guest?.arrival_date && guest.arrival_date > today)     phase = "upcoming";
  else if (guest?.arrival_date)                                   phase = "in_stay";

  const countdownTarget = phase === "upcoming" ? `${guest.arrival_date}T${DEFAULT_CHECKIN_TIME}:00` : null;
  const countdown = useCountdown(countdownTarget);

  const pageStyle = {
    minHeight: "100vh",
    background: `linear-gradient(180deg, ${XOS_BG_TOP} 0%, ${XOS_BG_BOTTOM} 100%)`,
    fontFamily: "Heebo, sans-serif",
    color: "#F3F4F6",
    direction: "rtl",
  };

  if (loading) {
    return (
      <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          border: "3px solid rgba(212,175,55,0.25)", borderTop: `3px solid ${XOS_GOLD}`,
          animation: "gp-spin 0.9s linear infinite",
        }} />
        <style>{`@keyframes gp-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (loadError || !guest) {
    return (
      <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏝️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: XOS_GOLD }}>Dream Island</div>
          <div style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.7 }}>
            {loadError ?? "הקישור אינו תקין או פג תוקף."}<br />לפרטים נוספים פנו לדלפק הקבלה.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* ── Hero ── */}
      <div style={{ padding: "36px 20px 28px", textAlign: "center" }}>
        <img
          src="/logo.png"
          alt="Dream Island"
          style={{ height: 52, marginBottom: 10, objectFit: "contain" }}
          onError={(e) => { e.target.style.display = "none"; }}
        />
        <div style={{
          fontFamily: "Playfair Display, serif", fontSize: 13, letterSpacing: 2,
          color: "#9CA3AF", textTransform: "uppercase", marginBottom: 22,
        }}>
          Dream Island Resort &amp; Spa
        </div>

        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          {phase === "past" ? `תודה שבחרתם בנו, ${guest.name}! 🙏` : `שלום ${guest.name}, ברוכים הבאים! 🌴`}
        </div>

        {guest.room && (
          <div style={{
            display: "inline-block", marginTop: 4, padding: "6px 16px", borderRadius: 20,
            background: "rgba(212,175,55,0.12)", border: `1px solid ${XOS_GOLD}55`,
            color: XOS_GOLD, fontSize: 13, fontWeight: 700,
          }}>
            🏨 {guest.room}
          </div>
        )}

        {/* Countdown / phase message */}
        {phase === "upcoming" && countdown && !countdown.expired && (
          <div style={{ marginTop: 26 }}>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 10 }}>
              נשארו עד ההגעה שלכם ({fmtDateHe(guest.arrival_date)})
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
              <CountdownUnit value={countdown.days} label="ימים" />
              <CountdownUnit value={countdown.hours} label="שעות" />
              <CountdownUnit value={countdown.minutes} label="דקות" />
              <CountdownUnit value={countdown.seconds} label="שניות" />
            </div>
          </div>
        )}
        {phase === "in_stay" && (
          <div style={{ marginTop: 18, fontSize: 14, color: "#D1D5DB" }}>
            ✨ אתם איתנו כרגע — מקווים שאתם נהנים בכל רגע!
          </div>
        )}
        {phase === "past" && (
          <div style={{ marginTop: 18, fontSize: 14, color: "#D1D5DB" }}>
            מחכים לראותכם שוב בקרוב 💛
          </div>
        )}
      </div>

      {/* ── Itinerary glass panel ── */}
      {(guest.spa_time || guest.meal_time) && (
        <div style={{ padding: "0 16px 36px" }}>
          <div style={{
            maxWidth: 420, margin: "0 auto",
            background: "rgba(255,255,255,0.04)", backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: "1px solid rgba(212,175,55,0.2)", borderRadius: 18,
            overflow: "hidden",
          }}>
            <div style={{
              padding: "12px 16px", fontSize: 12, fontWeight: 700, color: XOS_GOLD,
              borderBottom: "1px solid rgba(212,175,55,0.2)", textAlign: "right",
            }}>
              📋 התוכנית שלכם
            </div>
            <ItineraryRow icon="💆" label="ספא" value={guest.spa_time} />
            <ItineraryRow
              icon="🍽️"
              label="ארוחה"
              value={guest.meal_time ? `${guest.meal_time}${guest.meal_location ? " · " + guest.meal_location : ""}` : null}
            />
          </div>
        </div>
      )}

      {/* ── Scrollytelling photo tour + in-scroll upsells ── */}
      <PhotoTour onUpsell={handleUpsell} busyLabel={upsellBusy} />

      {/* ── Luxury toast ── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, insetInlineStart: 16, insetInlineEnd: 16,
          zIndex: 50, display: "flex", justifyContent: "center",
        }}>
          <div style={{
            maxWidth: 360, padding: "14px 22px", borderRadius: 16,
            background: "rgba(15,23,42,0.92)", backdropFilter: "blur(12px)",
            border: `1px solid ${XOS_GOLD}66`, color: "#F3F4F6",
            fontSize: 13, fontWeight: 600, textAlign: "center",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          }}>
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
