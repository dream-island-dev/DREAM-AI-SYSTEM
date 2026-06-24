// src/components/CustomerProfilePane.js
// Slide-out guest profile drawer — Session 27 Sprint 4.5.2.
// Read-only stay summary: total nights + official departure date/time.
// Departure TIME isn't a guests column (departure_date is DATE-only) — the
// real per-booking value lives on suite_rooms.checkout_time (EZGO import,
// migration 046), looked up here by phone, same join pattern GuestsPage.js
// already uses for room/suite_type. Falls back to bot_config's seeded
// 'hotel_checkout_time' default ("11:00", migration 015) when no per-booking
// row exists, instead of inventing a time that isn't in the data anywhere.
import { useState, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const DEFAULT_CHECKOUT_TIME = "11:00"; // mirrors bot_config.hotel_checkout_time's seeded default

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

export default function CustomerProfilePane({ guest, onClose }) {
  const [checkoutTime, setCheckoutTime] = useState(null);
  const [loadingCheckout, setLoadingCheckout] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingCheckout(true);
      if (isSupabaseConfigured && supabase && guest?.phone) {
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

  if (!guest) return null;

  const nights = nightsBetween(guest.arrival_date, guest.departure_date);
  const effectiveCheckoutTime = checkoutTime || DEFAULT_CHECKOUT_TIME;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
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
            <div style={{ fontSize: 19, fontWeight: 800, color: "var(--black)" }}>{guest.name}</div>
            {guest.phone && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>📞 {guest.phone}</div>
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

        {guest.room && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            🚪 {guest.room}
          </div>
        )}

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
            <span style={{ fontWeight: 700 }}>{fmtDateHe(guest.arrival_date)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-muted)" }}>תאריך עזיבה רשמי</span>
            <span style={{ fontWeight: 700 }}>{fmtDateHe(guest.departure_date)}</span>
          </div>
          {!checkoutTime && !loadingCheckout && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              ⚠ לא נמצאה שעת צ׳ק-אאוט ספציפית להזמנה זו — מוצגת שעת ברירת המחדל של המלון.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
