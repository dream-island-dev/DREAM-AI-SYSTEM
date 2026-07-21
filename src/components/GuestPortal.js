// src/components/GuestPortal.js
// Dynamic Experience Hub — Conditional Router + Pre-Order Module.
// (session: "MASTER INTEGRATION: DYNAMIC UPSALE & EXPERIENCE HUB")
//
// Conditional Router (server-authoritative):
//   room_type === 'suite'     → SuiteView: full portal, all sections
//   room_type === 'day_guest' → DayUseView: focused (Spa/Meals/Activities only)
//   unknown room_type         → SuiteView (safe default — shows more, not less)
//
// Pre-Order Module:
//   • upsell_items fetched server-side by guest-portal-data (filtered by room_type)
//     — the client never receives items it isn't entitled to.
//   • Checklist UI: quantity selector per item, grouped by category
//   • Submit → guest-portal-order Edge Function → guest_orders + Whapi alert
//   • Spa request CTA → guest-portal-spa-request (guest flags + Whapi auto-reply)
//
// Public, password-less. Mounted from index.js for /portal/:token.
// XOS palette: #0f172a / #09090b / #D4AF37 (distinct from staff-app CSS vars).

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import PhotoTour from "./PhotoTour";
import GuestSurveyForm from "./GuestSurveyForm";
import GuestClubOfferCard from "./GuestClubOfferCard";
import { formatSpaSchedule } from "../utils/israeliTime";
import { DEFAULT_GUEST_SURVEY_UI, normalizeGuestSurveyUi, serializeGuestSurveyUi } from "../utils/guestSurveyUi";
import { DEFAULT_GUEST_CLUB_UI, normalizeGuestClubUi } from "../utils/guestClubUi";

const XOS_GOLD    = "#D4AF37";
const XOS_BG_TOP  = "#0f172a";
const XOS_BG_BOTTOM = "#09090b";
const XOS_GLASS   = "rgba(255,255,255,0.04)";
const XOS_BORDER  = "rgba(212,175,55,0.2)";
const XOS_MUTED   = "#9CA3AF";
const XOS_TEXT    = "#F3F4F6";

// Mirrors bot_config.hotel_checkin_time seeded default
const DEFAULT_CHECKIN_TIME = "15:00";

// Hotel's WhatsApp concierge line — replace with the actual Meta Business number
// (same format as other wa.me links in the codebase, e.g. "972546294885")
const CONCIERGE_WA = "https://wa.me/972553083521";

// ── Category display config ───────────────────────────────────────────────────
const CATEGORY_META = {
  spa:      { icon: "💆", label: "ספא וטיפולים" },
  food:     { icon: "🍽️", label: "אוכל ושתייה" },
  amenity:  { icon: "🛁", label: "פינוקים לחדר" },
  activity: { icon: "🎾", label: "פעילויות" },
  workshop: { icon: "📚", label: "סדנאות" },
  general:  { icon: "✨", label: "נוספות" },
};

// ── Hooks ─────────────────────────────────────────────────────────────────────
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

// ── Small presentational components ──────────────────────────────────────────
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
        fontFamily: "Heebo, system-ui, sans-serif", fontSize: 30, fontWeight: 800,
        color: XOS_GOLD, lineHeight: 1,
      }}>
        {String(value).padStart(2, "0")}
      </div>
      <div style={{ fontSize: 11, color: XOS_MUTED, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function ItineraryRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px", borderBottom: `1px solid ${XOS_BORDER}`,
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div style={{ textAlign: "right", flex: 1 }}>
        <div style={{ fontSize: 11, color: XOS_MUTED }}>{label}</div>
        <div style={{ fontSize: 14, color: XOS_TEXT, fontWeight: 600, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

function GlassPanel({ title, children, style }) {
  return (
    <div style={{
      maxWidth: 420, margin: "0 auto",
      background: XOS_GLASS, backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      border: `1px solid ${XOS_BORDER}`, borderRadius: 18,
      overflow: "hidden", ...style,
    }}>
      {title && (
        <div style={{
          padding: "12px 16px", fontSize: 12, fontWeight: 700, color: XOS_GOLD,
          borderBottom: `1px solid ${XOS_BORDER}`, textAlign: "right",
        }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

const SPA_PORTAL_UPSELL_RE = /בקשת טיפול|טיפול בספא/i;

function SpaRequestButton({ onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        width: "100%", marginTop: 14, padding: "13px 20px", borderRadius: 14,
        background: busy ? "rgba(212,175,55,0.08)" : "rgba(212,175,55,0.14)",
        border: `1px solid ${XOS_GOLD}`,
        color: busy ? XOS_MUTED : XOS_GOLD,
        fontSize: 14, fontWeight: 700, fontFamily: "Heebo,sans-serif",
        cursor: busy ? "not-allowed" : "pointer",
      }}
    >
      {busy ? "⏳ שולחים את הבקשה…" : "💆 בקשת טיפול בספא"}
    </button>
  );
}

function SpaRequestConfirmModal({ open, busy, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spa-request-confirm-title"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(9,9,11,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
      onClick={busy ? undefined : onCancel}
    >
      <div
        style={{
          width: "100%", maxWidth: 360, borderRadius: 18,
          background: "linear-gradient(180deg, #1a2235 0%, #0f172a 100%)",
          border: `1px solid ${XOS_GOLD}`,
          padding: "22px 20px 18px",
          boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div id="spa-request-confirm-title" style={{ fontSize: 17, fontWeight: 800, color: "#f8fafc", marginBottom: 10 }}>
          לשלוח בקשה לטיפול בספא?
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.7, color: XOS_MUTED }}>
          נעביר את הבקשה לצוות הספא ונשלח לכם הודעה בוואטסאפ לתיאום.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1, padding: "12px 14px", borderRadius: 12, border: "none",
              background: busy ? "rgba(212,175,55,0.35)" : XOS_GOLD,
              color: "#0f172a", fontWeight: 800, fontSize: 14, cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "שולחים…" : "כן, שלחו"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1, padding: "12px 14px", borderRadius: 12,
              border: `1px solid rgba(148,163,184,0.35)`,
              background: "transparent", color: "#e2e8f0", fontWeight: 600, fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Guest Experience Survey ────────────────────────────────────────────────
// MVP audience: day-pass + spa that day (guest.survey_eligible, server-
// authoritative — guest-portal-data). Labels from portalConfig.survey_ui
// (bot_config) with shared GuestSurveyForm (staff preview uses the same UI).
function SurveySection({ guest, token, onToast, surveyUi, clubUi }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // thank-you payload after successful submit
  const [clubStatus, setClubStatus] = useState(guest?.club_status ?? null); // active | declined | null
  const [clubBusy, setClubBusy] = useState(false);
  const [waReviewSent, setWaReviewSent] = useState(false);
  const ui = normalizeGuestSurveyUi(surveyUi ?? DEFAULT_GUEST_SURVEY_UI);
  const club = normalizeGuestClubUi(clubUi ?? DEFAULT_GUEST_CLUB_UI);

  if (!guest?.survey_eligible) return null;

  const persistedThankYou = guest?.survey_thank_you ?? null;
  const thankYou = result ?? persistedThankYou;

  if (guest.survey_completed && !thankYou) {
    return (
      <div id="survey" style={{ padding: "0 16px 36px", scrollMarginTop: 24 }}>
        <GlassPanel title="📊 סקר חוויית אורח">
          <div style={{ padding: "22px 16px", textAlign: "center", color: XOS_MUTED, fontSize: 13, lineHeight: 1.8 }}>
            תודה! כבר מילאתם את הסקר עבור הביקור הזה. 🙏
          </div>
        </GlassPanel>
      </div>
    );
  }

  async function handleSubmit(scoresPayload) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("guest-portal-survey", {
        body: { token, scores: scoresPayload },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      setResult({
        positiveReview: !!data.positiveReview,
        googleCta: !!data.googleCta,
        reviewUrl: data.reviewUrl ?? null,
        suitesCta: !!data.suitesCta,
        suitesUrl: data.suitesUrl ?? null,
        suitesCtaLabel: data.suitesCtaLabel ?? null,
        clubOffer: !!data.clubOffer,
      });
    } catch (e) {
      onToast(
        e?.message === "already_submitted"
          ? "כבר מילאתם את הסקר עבור הביקור הזה."
          : "⚠️ לא הצלחנו לשלוח את הסקר — נסו שוב מאוחר יותר",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClubAction(action, profile) {
    if (clubBusy) return;
    setClubBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("guest-portal-club", {
        body: { token, action, ...profile },
      });
      if (error || !data?.ok) {
        if (data?.error === "guest_birthday_required") {
          throw new Error("guest_birthday_required");
        }
        throw new Error(data?.error ?? error?.message ?? "שגיאה");
      }
      setClubStatus(data.status || (action === "join" ? "active" : "declined"));
      if (data.waFollowUpSent) setWaReviewSent(true);
      onToast(
        action === "join"
          ? "✅ נרשמתם למועדון — נשמח לעדכן אתכם בהצעות והטבות בלעדיות"
          : "בסדר גמור — תודה בכל זאת 🙏",
      );
    } catch (e) {
      onToast(
        e?.message === "guest_birthday_required"
          ? "נא למלא תאריך לידה כדי להצטרף למועדון"
          : "⚠️ לא הצלחנו לעדכן — נסו שוב מאוחר יותר",
      );
    } finally {
      setClubBusy(false);
    }
  }

  if (thankYou) {
    const hasGoogle = thankYou.googleCta && thankYou.reviewUrl;
    const showClub = thankYou.clubOffer && !clubStatus;
    const showSuitesAfterJoin =
      thankYou.suitesCta && thankYou.suitesUrl
      && (clubStatus === "active" || clubStatus === "declined" || !thankYou.clubOffer);
    const suitesHref = thankYou.suitesUrl?.startsWith("http")
      ? thankYou.suitesUrl
      : `https://${thankYou.suitesUrl}`;

    return (
      <div id="survey" style={{ padding: "0 16px 36px", scrollMarginTop: 24 }}>
        <GlassPanel title="📊 סקר חוויית אורח">
          <div style={{ padding: "22px 16px", textAlign: "center" }}>
            <div style={{
              fontSize: 14, color: XOS_TEXT, lineHeight: 1.8,
              marginBottom: (hasGoogle || showClub || clubStatus || showSuitesAfterJoin) ? 16 : 0,
            }}>
              תודה רבה על המשוב! 🙏 זה עוזר לנו להמשיך ולהשתפר.
            </div>
            {hasGoogle && (
              <a
                href={thankYou.reviewUrl.startsWith("http") ? thankYou.reviewUrl : `https://${thankYou.reviewUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", maxWidth: 320, boxSizing: "border-box",
                  marginBottom: (showClub || clubStatus || showSuitesAfterJoin) ? 12 : 0,
                  padding: "12px 22px", borderRadius: 14,
                  background: `linear-gradient(135deg, ${XOS_GOLD}, #B8960C)`,
                  color: "#0f172a", fontSize: 14, fontWeight: 700, textDecoration: "none",
                }}
              >
                ⭐ נשמח לביקורת קצרה בגוגל
              </a>
            )}
            {showClub && (
              <GuestClubOfferCard
                ui={club}
                busy={clubBusy}
                onAction={handleClubAction}
              />
            )}
            {clubStatus === "active" && (
              <GuestClubOfferCard ui={club} status="active" showWaHint={waReviewSent} />
            )}
            {clubStatus === "declined" && waReviewSent && club.wa_review_hint && (
              <div style={{ fontSize: 11, color: XOS_MUTED, marginTop: 10, lineHeight: 1.6 }}>
                {club.wa_review_hint}
              </div>
            )}
            {showSuitesAfterJoin && (
              <a
                href={suitesHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", maxWidth: 320, boxSizing: "border-box",
                  marginTop: clubStatus === "active" ? 12 : 0,
                  padding: "12px 22px", borderRadius: 14,
                  background: `linear-gradient(135deg, ${XOS_GOLD}, #B8960C)`,
                  color: "#0f172a", fontSize: 14, fontWeight: 700, textDecoration: "none",
                }}
              >
                {thankYou.suitesCtaLabel || "🛏️ רוצים לחוות לינה בסוויטה?"}
              </a>
            )}
          </div>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div id="survey" style={{ padding: "0 16px 36px", scrollMarginTop: 24 }}>
      <GlassPanel title={ui.panel_title}>
        <div style={{ padding: "18px 16px 16px" }}>
          <GuestSurveyForm
            key={serializeGuestSurveyUi(ui)}
            ui={ui}
            variant="portal"
            panelTitleOverride=""
            submitting={submitting}
            onSubmit={handleSubmit}
          />
        </div>
      </GlassPanel>
    </div>
  );
}

// ── Pre-Order Module ──────────────────────────────────────────────────────────
// Groups upsell_items by category, renders a qty-stepper per item, and
// submits to guest-portal-order edge function.
function PreOrderModule({ token, items, onToast }) {
  // cart: { [item_id]: { qty, notes } }
  const [cart, setCart]       = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);

  const totalItems = Object.values(cart).filter(c => c.qty > 0).length;

  function setQty(itemId, delta) {
    setCart(prev => {
      const cur = prev[itemId]?.qty ?? 0;
      const next = Math.max(0, Math.min(10, cur + delta));
      if (next === 0) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: { ...prev[itemId], qty: next } };
    });
  }

  async function handleSubmit() {
    if (submitting || totalItems === 0) return;
    setSubmitting(true);
    const cartPayload = Object.entries(cart)
      .filter(([, v]) => v.qty > 0)
      .map(([item_id, v]) => ({ item_id, quantity: v.qty, notes: v.notes }));
    try {
      const { data, error } = await supabase.functions.invoke("guest-portal-order", {
        body: { token, cart: cartPayload },
      });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      setSubmitted(true);
      setCart({});
      onToast("✅ הזמנתך התקבלה! נחזור אליך בהקדם לאישור.");
    } catch (e) {
      onToast("⚠️ לא הצלחנו לשלוח את ההזמנה — נסו שוב או פנו לקבלה");
    } finally {
      setSubmitting(false);
    }
  }

  if (items.length === 0) return null;

  // Separate orderable items (qty stepper) from link items (external button).
  // link_url items (e.g. workshops) are informational — they open an external
  // page; they never go into the cart and are excluded from the submit button.
  const orderableItems = items.filter((i) => !i.link_url);

  // Group all items by category for display
  const groups = {};
  for (const item of items) {
    const cat = item.category || "general";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  if (submitted) {
    return (
      <div style={{ padding: "0 16px 36px" }}>
        <GlassPanel title="✅ ההזמנה שלכם התקבלה">
          <div style={{ padding: "20px 16px", textAlign: "center", color: XOS_MUTED, fontSize: 13 }}>
            נציג מנוסה יאשר את הפרטים ויצור עמכם קשר בהקדם. 🌴
          </div>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 16px 36px" }}>
      <GlassPanel title="🛎️ שירותים ופינוקים">
        {Object.entries(groups).map(([cat, catItems]) => {
          const meta = CATEGORY_META[cat] ?? CATEGORY_META.general;
          return (
            <div key={cat}>
              {/* Category header */}
              <div style={{
                padding: "8px 16px", fontSize: 11, fontWeight: 700,
                color: XOS_GOLD, borderBottom: `1px solid ${XOS_BORDER}`,
                background: "rgba(212,175,55,0.06)", textAlign: "right",
              }}>
                {meta.icon} {meta.label}
              </div>
              {catItems.map(item => {
                const qty = cart[item.id]?.qty ?? 0;
                const hasLink = !!item.link_url;
                return (
                  <div key={item.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "12px 16px", borderBottom: `1px solid ${XOS_BORDER}`,
                  }}>
                    {/* Info */}
                    <div style={{ flex: 1, textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: XOS_TEXT }}>
                        {item.name}
                        {item.price && (
                          <span style={{ fontSize: 12, color: XOS_GOLD, marginRight: 8 }}>
                            ₪{item.price}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <div style={{ fontSize: 11, color: XOS_MUTED, marginTop: 2, lineHeight: 1.5 }}>
                          {item.description}
                        </div>
                      )}
                    </div>

                    {/* External link button (workshops) OR qty stepper (orderable items) */}
                    {hasLink ? (
                      <a
                        href={item.link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
                          padding: "7px 13px", borderRadius: 20,
                          border: `1px solid ${XOS_GOLD}`,
                          background: "rgba(212,175,55,0.12)",
                          color: XOS_GOLD, fontSize: 12, fontWeight: 700,
                          textDecoration: "none", whiteSpace: "nowrap",
                        }}
                      >
                        📅 לפרטים
                      </a>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
                        <button
                          onClick={() => setQty(item.id, -1)}
                          disabled={qty === 0}
                          style={{
                            width: 32, height: 32, borderRadius: "50%",
                            border: `1px solid ${qty > 0 ? XOS_GOLD : XOS_BORDER}`,
                            background: qty > 0 ? "rgba(212,175,55,0.15)" : "transparent",
                            color: qty > 0 ? XOS_GOLD : XOS_MUTED,
                            fontSize: 18, lineHeight: 1, cursor: qty > 0 ? "pointer" : "default",
                            fontFamily: "inherit", display: "flex", alignItems: "center",
                            justifyContent: "center",
                          }}
                        >−</button>
                        <div style={{
                          minWidth: 28, textAlign: "center", fontSize: 15, fontWeight: 700,
                          color: qty > 0 ? XOS_TEXT : XOS_MUTED,
                        }}>
                          {qty}
                        </div>
                        <button
                          onClick={() => setQty(item.id, +1)}
                          disabled={qty >= 10}
                          style={{
                            width: 32, height: 32, borderRadius: "50%",
                            border: `1px solid ${XOS_GOLD}`,
                            background: "rgba(212,175,55,0.15)",
                            color: XOS_GOLD, fontSize: 18, lineHeight: 1, cursor: "pointer",
                            fontFamily: "inherit", display: "flex", alignItems: "center",
                            justifyContent: "center",
                          }}
                        >+</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Submit — only shown when there are orderable (non-link) items */}
        {orderableItems.length > 0 && (
          <div style={{ padding: "16px" }}>
            <button
              onClick={handleSubmit}
              disabled={totalItems === 0 || submitting}
              title={totalItems === 0 ? "בחרו לפחות פריט אחד להזמנה" : ""}
              style={{
                width: "100%", padding: "14px", borderRadius: 12,
                border: "none", cursor: totalItems > 0 && !submitting ? "pointer" : "not-allowed",
                background: totalItems > 0
                  ? `linear-gradient(135deg, ${XOS_GOLD}, #B8960C)`
                  : "rgba(255,255,255,0.08)",
                color: totalItems > 0 ? "#0f172a" : XOS_MUTED,
                fontSize: 15, fontWeight: 700, fontFamily: "Heebo, sans-serif",
                transition: "opacity 0.2s", opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting
                ? "שולחים…"
                : totalItems > 0
                  ? `📨 שליחת הזמנה (${totalItems} פריט${totalItems > 1 ? "ים" : ""})`
                  : "בחרו פריטים מהרשימה"}
            </button>
            {totalItems === 0 && (
              <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: XOS_MUTED }}>
                הכפתור יתאפשר לאחר שתבחרו לפחות פריט אחד
              </div>
            )}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

// ── Shared Hero (used by both views) ─────────────────────────────────────────
function PortalHero({ guest, phase, countdown }) {
  return (
    <div style={{ padding: "36px 20px 28px", textAlign: "center" }}>
      <img
        src="/logo.png"
        alt="Dream Island"
        style={{ height: 52, marginBottom: 10, objectFit: "contain" }}
        onError={(e) => { e.target.style.display = "none"; }}
      />
      <div style={{
        fontFamily: "Heebo, system-ui, sans-serif", fontSize: 13, letterSpacing: 2,
        color: XOS_MUTED, textTransform: "uppercase", marginBottom: 22,
      }}>
        Dream Island Resort &amp; Spa
      </div>

      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
        {phase === "past"
          ? `תודה שבחרתם בנו, ${guest.name}! 🙏`
          : `שלום ${guest.name}, ברוכים הבאים! 🌴`}
      </div>

      {/* Room badge */}
      {guest.room && (
        <div style={{
          display: "inline-block", marginTop: 4, padding: "6px 16px", borderRadius: 20,
          background: "rgba(212,175,55,0.12)", border: `1px solid ${XOS_GOLD}55`,
          color: XOS_GOLD, fontSize: 13, fontWeight: 700,
        }}>
          🏨 {guest.room}
        </div>
      )}

      {/* Guest-type badge for day-use */}
      {(guest.room_type === "day_guest" || guest.room_type === "premium_day_guest") && (
        <div style={{
          display: "inline-block", marginTop: 4, marginRight: guest.room ? 8 : 0,
          padding: "5px 12px", borderRadius: 20,
          background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)",
          color: "#A5B4FC", fontSize: 12, fontWeight: 600,
        }}>
          ☀️ יום כיף
        </div>
      )}

      {/* Countdown / phase message */}
      {phase === "upcoming" && countdown && !countdown.expired && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 12, color: XOS_MUTED, marginBottom: 10 }}>
            נשארו עד ההגעה שלכם ({fmtDateHe(guest.arrival_date)})
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
            <CountdownUnit value={countdown.days}    label="ימים" />
            <CountdownUnit value={countdown.hours}   label="שעות" />
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
  );
}

// ── Secure payment CTA — below itinerary, token-gated URL from guest-portal-data
function SecurePaymentButton({ guest }) {
  const url = (guest.payment_url ?? "").trim();
  if (!url) return null;

  const status = String(guest.payment_status ?? "").toLowerCase();
  if (status === "paid") return null;

  const balance = guest.payment_amount != null ? Number(guest.payment_amount) : null;
  if (balance != null && !Number.isNaN(balance) && balance <= 0) return null;

  return (
    <div style={{ padding: "0 16px 20px" }}>
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
            width: "100%", padding: "16px 22px", borderRadius: 14,
            background: "linear-gradient(135deg, rgba(245,230,200,0.12), rgba(212,175,55,0.07))",
            border: "1px solid rgba(212,175,55,0.32)",
            color: "#F5E6C8",
            fontSize: 14, fontWeight: 700, textDecoration: "none", textAlign: "center",
            boxShadow: "0 4px 20px rgba(212,175,55,0.10)",
          }}
        >
          <span>💳 להסדרת תשלום מאובטח לחץ כאן</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: XOS_GOLD, opacity: 0.92 }}>
            הסדרת תשלום עבור האירוח
            {balance != null && balance > 0
              ? ` · ₪${balance.toLocaleString("he-IL")}`
              : ""}
          </span>
        </a>
      </div>
    </div>
  );
}

function spaItineraryLabel(guest) {
  return formatSpaSchedule(guest.spa_date, guest.spa_time)
    || guest.spa_schedule_display
    || guest.spa_time
    || null;
}

// ── Itinerary glass panel (suite + day-use) ───────────────────────────────────
// Always renders — shows a concierge CTA fallback instead of returning null when
// no spa/meal data exists (FAIL VISIBLE §0.3: guest never sees a blank section).
function ItineraryPanel({ guest, onSpaRequest, spaBusy, showSpaRequest }) {
  const spaLabel = spaItineraryLabel(guest);
  const mealRows = Array.isArray(guest.meals_itinerary) ? guest.meals_itinerary : [];
  const hasSchedule = !!(spaLabel || mealRows.length > 0 || guest.meal_time || (guest.meal_location ?? "").trim());
  return (
    <div style={{ padding: "0 16px 36px" }}>
      <GlassPanel title="📋 התוכנית שלכם">
        {hasSchedule ? (
          <>
            {spaLabel && <ItineraryRow icon="💆" label="ספא" value={spaLabel} />}
            {mealRows.length > 0
              ? mealRows.map((row, i) => (
                <ItineraryRow key={`${row.label}-${i}`} icon={row.icon} label={row.label} value={row.value} />
              ))
              : (
                <>
                  <ItineraryRow icon="🍴" label="בסיס אירוח" value={(guest.meal_location ?? "").trim() || null} />
                  <ItineraryRow icon="🍽️" label="ארוחה" value={guest.meal_time} />
                </>
              )}
          </>
        ) : (
          <div style={{ padding: "20px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: XOS_MUTED, lineHeight: 1.8 }}>
              אין פעילויות מתוכננות כרגע.
              <br />
              דברו איתנו כדי לתאם טיפול ספא
              <br />
              או שולחן במסעדה.
            </div>
          </div>
        )}
        {showSpaRequest && (
          <div style={{ padding: "0 16px 16px" }}>
            <SpaRequestButton onClick={onSpaRequest} busy={spaBusy} />
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

// ── Suite quick actions — always visible (concierge WA) ───────────────────────
function SuiteQuickActions() {
  return (
    <div style={{ padding: "0 16px 28px" }}>
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <a
          href={CONCIERGE_WA}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%", padding: "14px 22px", borderRadius: 14,
            background: "rgba(37,211,102,0.10)",
            border: "1px solid rgba(37,211,102,0.30)",
            color: "#4ADE80",
            fontSize: 14, fontWeight: 700, textDecoration: "none",
          }}
        >
          💬 שוחחו עם הקונסיירז' שלנו
        </a>
      </div>
    </div>
  );
}

// ── SUITE VIEW — full portal ──────────────────────────────────────────────────
function SuiteView({ guest, phase, countdown, upsellItems, token, onToast, onUpsell, upsellBusy, onSpaRequest, spaBusy, showSpaRequest, scenes, surveyUi, clubUi }) {
  return (
    <>
      <PortalHero guest={guest} phase={phase} countdown={countdown} />
      <ItineraryPanel guest={guest} onSpaRequest={onSpaRequest} spaBusy={spaBusy} showSpaRequest={showSpaRequest} />
      <SecurePaymentButton guest={guest} />
      <SurveySection guest={guest} token={token} onToast={onToast} surveyUi={surveyUi} clubUi={clubUi} />
      <SuiteQuickActions />

      {/* Pre-Order module (DB-driven, suite + all items) */}
      <PreOrderModule token={token} items={upsellItems} onToast={onToast} />

      {/* Scrollytelling photo tour with legacy PhotoTour upsells */}
      <PhotoTour onUpsell={onUpsell} busyLabel={upsellBusy} scenes={scenes} />
    </>
  );
}

// ── DAY-USE VIEW — focused (Spa / Meals / Activities) ────────────────────────
function DayUseView({ guest, phase, countdown, upsellItems, token, onToast, onUpsell, upsellBusy, onSpaRequest, spaBusy, showSpaRequest, scenes, surveyUi, clubUi }) {

  return (
    <>
      <PortalHero guest={guest} phase={phase} countdown={countdown} />

      {/* Day-use focused itinerary — always rendered; shows concierge CTA when empty */}
      <div style={{ padding: "0 16px 28px" }}>
        <GlassPanel title="⚡ היום שלכם — בקצרה">
          {(guest.spa_time || guest.spa_date || (Array.isArray(guest.meals_itinerary) && guest.meals_itinerary.length) || guest.meal_time || (guest.meal_location ?? "").trim()) ? (
            <>
              <ItineraryRow icon="💆" label="טיפול ספא" value={spaItineraryLabel(guest)} />
              {Array.isArray(guest.meals_itinerary) && guest.meals_itinerary.length > 0
                ? guest.meals_itinerary.map((row, i) => (
                  <ItineraryRow key={`${row.label}-${i}`} icon={row.icon} label={row.label} value={row.value} />
                ))
                : (
                  <>
                    <ItineraryRow
                      icon="🍴"
                      label="בסיס אירוח"
                      value={(guest.meal_location ?? "").trim() || null}
                    />
                    <ItineraryRow icon="🍽️" label="ארוחה" value={guest.meal_time} />
                  </>
                )}
            </>
          ) : (
            <div style={{ padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: XOS_MUTED, lineHeight: 1.8, marginBottom: 18 }}>
                אין פעילויות מתוכננות כרגע.
                <br />
                דברו איתנו כדי לתאם טיפול ספא
                <br />
                או שולחן במסעדה.
              </div>
              <a
                href={CONCIERGE_WA}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "10px 22px", borderRadius: 24,
                  background: "rgba(37,211,102,0.10)",
                  border: "1px solid rgba(37,211,102,0.30)",
                  color: "#4ADE80",
                  fontSize: 13, fontWeight: 700, textDecoration: "none",
                }}
              >
                💬 שוחחו עם הקונסיירז' שלנו
              </a>
            </div>
          )}
          {showSpaRequest && (
            <div style={{ padding: "0 16px 16px" }}>
              <SpaRequestButton onClick={onSpaRequest} busy={spaBusy} />
            </div>
          )}
        </GlassPanel>
      </div>

      <SecurePaymentButton guest={guest} />
      <SurveySection guest={guest} token={token} onToast={onToast} surveyUi={surveyUi} clubUi={clubUi} />

      {/* Focused activity info panel */}
      <div style={{ padding: "0 16px 20px" }}>
        <GlassPanel title={null} style={{ padding: "16px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: XOS_GOLD, marginBottom: 10 }}>
              ☀️ יום כיף — מה מחכה לכם?
            </div>
            <div style={{ fontSize: 13, color: XOS_TEXT, lineHeight: 1.8 }}>
              {(guest.spa_time || guest.spa_date) && <div>💆 ספא & טיפולים מפנקים</div>}
              <div>🍽️ ארוחה במסעדת הריזורט</div>
              <div>🏊 בריכה ואזורי הרפיה</div>
              <div>🎾 פעילויות ספורט ובידור</div>
            </div>
          </div>
        </GlassPanel>
      </div>

      {/* Pre-Order module — only day_use + all items */}
      <PreOrderModule token={token} items={upsellItems} onToast={onToast} />

      {/* Photo tour is shown for day-use too, but kept shorter contextually */}
      <PhotoTour onUpsell={onUpsell} busyLabel={upsellBusy} scenes={scenes} />
    </>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
export default function GuestPortal({ token }) {
  const [guest, setGuest]               = useState(null);
  const [upsellItems, setUpsellItems]   = useState([]);
  const [portalScenes, setPortalScenes] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(null);
  const [portalConfig, setPortalConfig]   = useState({
    has_spa_booking: false,
    enable_spa_request_button: true,
    survey_ui: DEFAULT_GUEST_SURVEY_UI,
    club_ui: DEFAULT_GUEST_CLUB_UI,
  });
  const [upsellBusy, setUpsellBusy]       = useState(null);
  const [spaBusy, setSpaBusy]           = useState(false);
  const [spaConfirmOpen, setSpaConfirmOpen] = useState(false);
  const [toast, setToast]               = useState(null);
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
          setLoadError(
            data?.error === "guest_not_found"
              ? "לא מצאנו הזמנה התואמת לקישור הזה."
              : "שגיאה בטעינת הפרופיל."
          );
        } else {
          setGuest(data.guest);
          setUpsellItems(Array.isArray(data.upsellItems) ? data.upsellItems : []);
          setPortalScenes(Array.isArray(data.scenes) ? data.scenes : []);
          if (data.portalConfig) {
            setPortalConfig({
              has_spa_booking: !!data.portalConfig.has_spa_booking,
              enable_spa_request_button: data.portalConfig.enable_spa_request_button !== false,
              survey_ui: normalizeGuestSurveyUi(data.portalConfig.survey_ui),
              club_ui: normalizeGuestClubUi(data.portalConfig.club_ui),
            });
          }
        }
      } catch (e) {
        if (active) setLoadError(e?.message ?? "שגיאה בטעינה.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  function openSpaRequestConfirm() {
    if (spaBusy || portalConfig.has_spa_booking || portalConfig.enable_spa_request_button === false) return;
    setSpaConfirmOpen(true);
  }

  async function submitSpaRequest() {
    if (spaBusy || portalConfig.has_spa_booking || portalConfig.enable_spa_request_button === false) return;
    setSpaBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("guest-portal-spa-request", { body: { token } });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      setSpaConfirmOpen(false);
      showToast("הבקשה נשלחה. נשלח לכם הודעה בוואטסאפ לתיאום.");
    } catch {
      showToast("⚠️ לא הצלחנו לשלוח את הבקשה — נסו שוב או התקשרו ל-08-6705600");
    } finally {
      setSpaBusy(false);
    }
  }

  // Legacy PhotoTour upsell handler — routes spa REQUEST CTAs to guest-portal-spa-request.
  async function handlePhotoTourUpsell(upsellLabel, actionType) {
    if (upsellBusy || spaBusy) return;
    if (actionType !== "OPS_REQUEST" && SPA_PORTAL_UPSELL_RE.test(upsellLabel ?? "")) {
      if (portalConfig.has_spa_booking || portalConfig.enable_spa_request_button === false) return;
      openSpaRequestConfirm();
      return;
    }
    setUpsellBusy(upsellLabel);
    const fnName = actionType === "OPS_REQUEST" ? "guest-portal-ops-request" : "guest-portal-upsell";
    try {
      const { data, error } = await supabase.functions.invoke(fnName, { body: { token, upsellLabel } });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה");
      showToast("בקשתך התקבלה בהצלחה. נציג מנוסה יצור עמך קשר בהקדם.");
    } catch {
      showToast("⚠️ לא הצלחנו לשלוח את הבקשה — נסו שוב או פנו לקבלה");
    } finally {
      setUpsellBusy(null);
    }
  }

  // ── Stay-phase logic — computed BEFORE early-returns (hooks rule) ──────────
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  let phase = "unknown";
  if (guest?.departure_date && guest.departure_date < today)  phase = "past";
  else if (guest?.arrival_date && guest.arrival_date > today) phase = "upcoming";
  else if (guest?.arrival_date)                               phase = "in_stay";

  const countdownTarget = phase === "upcoming"
    ? `${guest.arrival_date}T${DEFAULT_CHECKIN_TIME}:00`
    : null;
  const countdown = useCountdown(countdownTarget);

  const showSpaRequest =
    portalConfig.enable_spa_request_button !== false && !portalConfig.has_spa_booking;

  // ── Shared page wrapper ────────────────────────────────────────────────────
  const pageStyle = {
    minHeight: "100vh",
    background: `linear-gradient(180deg, ${XOS_BG_TOP} 0%, ${XOS_BG_BOTTOM} 100%)`,
    fontFamily: "Heebo, sans-serif",
    color: XOS_TEXT,
    direction: "rtl",
  };

  // Loading state
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

  // Error state (FAIL VISIBLE — never a blank white screen)
  if (loadError || !guest) {
    return (
      <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏝️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: XOS_GOLD }}>Dream Island</div>
          <div style={{ fontSize: 13, color: XOS_MUTED, lineHeight: 1.7 }}>
            {loadError ?? "הקישור אינו תקין או פג תוקף."}<br />לפרטים נוספים פנו לדלפק הקבלה.
          </div>
        </div>
      </div>
    );
  }

  // ── Conditional Router — server-authoritative, client executes ────────────
  // guest.room_type is set by the server (guest-portal-data) and cannot be
  // spoofed (the client has no way to change what room_type the server returned
  // or which upsell_items were filtered-in for it).
  const isSuite  = guest.room_type === "suite";
  // Both regular and premium day-pass guests get the DayUseView (focused portal).
  // Unknown room_type falls through to SuiteView (safe default — shows more).
  const isDayUse = guest.room_type === "day_guest" || guest.room_type === "premium_day_guest";

  return (
    <div style={pageStyle}>
      {isSuite ? (
        <SuiteView
          guest={guest}
          phase={phase}
          countdown={countdown}
          upsellItems={upsellItems}
          token={token}
          onToast={showToast}
          onUpsell={handlePhotoTourUpsell}
          upsellBusy={upsellBusy}
          onSpaRequest={openSpaRequestConfirm}
          spaBusy={spaBusy}
          showSpaRequest={showSpaRequest}
          scenes={portalScenes}
          surveyUi={portalConfig.survey_ui}
          clubUi={portalConfig.club_ui}
        />
      ) : isDayUse ? (
        <DayUseView
          guest={guest}
          phase={phase}
          countdown={countdown}
          upsellItems={upsellItems}
          token={token}
          onToast={showToast}
          onUpsell={handlePhotoTourUpsell}
          upsellBusy={upsellBusy}
          onSpaRequest={openSpaRequestConfirm}
          spaBusy={spaBusy}
          showSpaRequest={showSpaRequest}
          scenes={portalScenes}
          surveyUi={portalConfig.survey_ui}
          clubUi={portalConfig.club_ui}
        />
      ) : (
        /* Unknown room_type: safe default = SuiteView (shows more, not less) */
        <SuiteView
          guest={guest}
          phase={phase}
          countdown={countdown}
          upsellItems={upsellItems}
          token={token}
          onToast={showToast}
          onUpsell={handlePhotoTourUpsell}
          upsellBusy={upsellBusy}
          onSpaRequest={openSpaRequestConfirm}
          spaBusy={spaBusy}
          showSpaRequest={showSpaRequest}
          scenes={portalScenes}
          surveyUi={portalConfig.survey_ui}
          clubUi={portalConfig.club_ui}
        />
      )}

      <SpaRequestConfirmModal
        open={spaConfirmOpen}
        busy={spaBusy}
        onConfirm={submitSpaRequest}
        onCancel={() => { if (!spaBusy) setSpaConfirmOpen(false); }}
      />

      {/* Luxury toast — shared across all views */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, insetInlineStart: 16, insetInlineEnd: 16,
          zIndex: 50, display: "flex", justifyContent: "center",
        }}>
          <div style={{
            maxWidth: 360, padding: "14px 22px", borderRadius: 16,
            background: "rgba(15,23,42,0.92)", backdropFilter: "blur(12px)",
            border: `1px solid ${XOS_GOLD}66`, color: XOS_TEXT,
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
