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

const ALERT_TYPE_META = {
  complaint:           { label: "🔴 תקלה",        bg: "#FFF0EE", color: "#C0392B" },
  date_change_request: { label: "🗓️ שינוי תאריך", bg: "#E8F0FE", color: "#1A56DB" },
  request:             { label: "📝 בקשה",         bg: "#FFF5E8", color: "#B5600A" },
  upsell_opportunity:  { label: "🌴 מהפורטל",     bg: "#E8F5EF", color: "#1A7A4A" },
};

function alertTypeMeta(alertType) {
  return ALERT_TYPE_META[alertType] ?? {
    label: `⚠ ${alertType ?? "ללא סוג"}`,
    bg: "#F5F5F5",
    color: "#888888",
  };
}

function phoneLookupVariants(phone) {
  if (!phone) return [];
  const variants = new Set([phone]);
  const digits = phone.replace(/\D/g, "");
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
    if (digits.startsWith("972")) variants.add(`+${digits}`);
    else if (digits.startsWith("0")) variants.add(`+972${digits.slice(1)}`);
  }
  if (phone.startsWith("+")) variants.add(phone.slice(1));
  return [...variants];
}

function fmtAlertTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : `${d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
}

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
  const [guestAlerts, setGuestAlerts] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [showResolvedAlerts, setShowResolvedAlerts] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

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

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase || (!liveGuest?.id && !liveGuest?.phone)) {
        if (active) { setGuestAlerts([]); setLoadingAlerts(false); }
        return;
      }
      setLoadingAlerts(true);
      const select = "id, alert_type, message, resolved, resolved_at, resolution_notes, created_at";
      const variants = phoneLookupVariants(liveGuest.phone);
      const byId = liveGuest.id
        ? await supabase.from("guest_alerts").select(select).eq("guest_id", liveGuest.id).order("created_at", { ascending: false }).limit(25)
        : { data: [], error: null };
      const byPhone = variants.length
        ? await supabase.from("guest_alerts").select(select).in("phone", variants).order("created_at", { ascending: false }).limit(25)
        : { data: [], error: null };
      if (!active) return;
      if (byId.error || byPhone.error) {
        console.warn("[CustomerProfilePane] guest_alerts:", byId.error?.message || byPhone.error?.message);
        setGuestAlerts([]);
      } else {
        const seen = new Set();
        const merged = [...(byId.data ?? []), ...(byPhone.data ?? [])]
          .filter((row) => {
            if (seen.has(row.id)) return false;
            seen.add(row.id);
            return true;
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 25);
        setGuestAlerts(merged);
      }
      setLoadingAlerts(false);
    })();
    return () => { active = false; };
  }, [liveGuest?.id, liveGuest?.phone]);

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
  const systemNotes = typeof liveGuest.guest_notes === "string" ? liveGuest.guest_notes.trim() : "";
  const visibleAlerts = showResolvedAlerts ? guestAlerts : guestAlerts.filter((a) => !a.resolved);
  const openAlertCount = guestAlerts.filter((a) => !a.resolved).length;

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

        {/* Guest context — bot/portal requests + system audit log */}
        <div style={{
          background: "var(--ivory)", borderRadius: 12, padding: "12px 14px",
          marginBottom: 14, border: "1px solid var(--border)",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10, flexWrap: "wrap", gap: 6,
          }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)" }}>
              💬 הערות ובקשות
              {openAlertCount > 0 && (
                <span style={{
                  marginRight: 6, fontSize: 10, background: "#FFF0EE", color: "#C0392B",
                  padding: "2px 7px", borderRadius: 10, fontWeight: 800,
                }}>
                  {openAlertCount} פתוחות
                </span>
              )}
            </span>
            {guestAlerts.some((a) => a.resolved) && (
              <label style={{
                fontSize: 10, color: "var(--text-muted)", display: "flex",
                alignItems: "center", gap: 4, cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={showResolvedAlerts}
                  onChange={(e) => setShowResolvedAlerts(e.target.checked)}
                  style={{ accentColor: "var(--gold)" }}
                />
                הצג גם טופלו
              </label>
            )}
          </div>

          {loadingAlerts ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>טוען בקשות…</div>
          ) : visibleAlerts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: systemNotes ? 12 : 0 }}>
              {visibleAlerts.map((alert) => {
                const tm = alertTypeMeta(alert.alert_type);
                return (
                  <div
                    key={alert.id}
                    style={{
                      background: "var(--card-bg)", borderRadius: 10, padding: "10px 11px",
                      border: `1px solid ${alert.resolved ? "var(--border)" : tm.color + "55"}`,
                      opacity: alert.resolved ? 0.75 : 1,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
                        background: tm.bg, color: tm.color,
                      }}>
                        {tm.label}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {fmtAlertTime(alert.created_at)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#333", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                      {alert.message}
                    </div>
                    {alert.resolved && alert.resolution_notes && (
                      <div style={{ fontSize: 11, color: "#1A7A4A", marginTop: 6 }}>
                        ✓ {alert.resolution_notes}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                      {alert.resolved ? "✓ טופל" : "ממתין לטיפול"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: systemNotes ? 12 : 0 }}>
              {guestAlerts.length > 0 && !showResolvedAlerts
                ? "אין בקשות פתוחות — סמן «הצג גם טופלו» להיסטוריה"
                : "אין בקשות מתועדות לאורח זה"}
            </div>
          )}

          {systemNotes && (
            <div style={{ borderTop: guestAlerts.length ? "1px solid var(--border)" : "none", paddingTop: guestAlerts.length ? 10 : 0 }}>
              <button
                type="button"
                onClick={() => setAuditOpen((o) => !o)}
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                  fontFamily: "Heebo,sans-serif",
                }}
              >
                {auditOpen ? "▼ הסתר לוג מערכת" : "▶ לוג מערכת (הערות אוטומטיות מהבוט)"}
              </button>
              {auditOpen && (
                <div style={{
                  marginTop: 8, whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.5,
                  background: "var(--card-bg)", borderRadius: 8, padding: 10,
                  border: "1px solid var(--border)", maxHeight: 160, overflowY: "auto",
                  color: "#555",
                }}>
                  {systemNotes}
                </div>
              )}
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
