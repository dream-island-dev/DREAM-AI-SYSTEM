// Structured Smart Guest Profile editor — VIP, occasion, dietary, stay & meals.
// Opened from GuestAttentionBadge (red alert) or AddGuestModal (edit flow).
import { useEffect, useMemo, useState } from "react";
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
import {
  MEAL_PLANS,
  BOOKING_TYPES,
  MEAL_SLOTS_BY_PLAN,
  MEAL_SLOT_LABELS,
  normalizeMealPlan,
  mealTimesFromGuest,
  applyLegacyMealColumns,
} from "../data/stayMealsSchema";
import IsraeliTimeSelect from "./IsraeliTimeSelect";
import { formatSpaSchedule } from "../utils/israeliTime";
import {
  inferBookingTypeFromGuest,
  bookingTypeLabel,
  fetchGuestSuiteRooms,
  formatSuiteRoomLine,
} from "../utils/guestStaySummary";
import { isSuiteRoomReadySent, resolveSuiteRoomDisplayLabel } from "../utils/suiteRoomReady";

const ATTENTION_HEADINGS = {
  date_change:    "🗓️ ביקש/ה שינוי בתאריך",
  human_callback: "📞 ביקש/ה לדבר עם נציג",
  "בקשת טיפול בספא": "💆 ביקש/ה טיפול בספא מהפורטל",
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
  onOpenDreamBotChat,
}) {
  const [profile, setProfile] = useState(() => normalizeGuestProfile(guest?.guest_profile));
  const [arrivalTime, setArrivalTime] = useState(guest?.arrival_time ?? "");
  const [mealPlan, setMealPlan] = useState(() => normalizeMealPlan(guest?.meal_plan));
  const [mealLocation, setMealLocation] = useState(guest?.meal_location ?? "מסעדת ערמונים");
  const [mealTimes, setMealTimes] = useState(() => mealTimesFromGuest(guest));
  const [suiteRooms, setSuiteRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const resolvedBookingType = useMemo(
    () => inferBookingTypeFromGuest({ ...guest, guest_profile: profile }),
    [guest, profile],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase || !guest?.id) {
        setSuiteRooms([]);
        return;
      }
      setRoomsLoading(true);
      const rows = await fetchGuestSuiteRooms(supabase, guest);
      if (!cancelled) {
        setSuiteRooms(rows);
        setRoomsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when identity keys change
  }, [guest?.id, guest?.order_number, guest?.arrival_date, guest?.phone]);

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
      } else if (path.startsWith("stay.")) {
        const key = path.split(".")[1];
        next.stay = { ...next.stay, [key]: value };
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
      ...applyLegacyMealColumns(mealPlan, mealTimes, mealLocation),
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
              width: "100%",
              minHeight: 48,
              marginBottom: 18,
              padding: "12px 16px",
              borderRadius: 10,
              border: "2px solid var(--gold, #C9A96E)",
              background: "linear-gradient(135deg, var(--ivory, #F5F0E8), rgba(201,169,110,0.22))",
              color: "var(--gold-dark, #A8843A)",
              fontFamily: "Heebo, sans-serif",
              fontSize: 14,
              fontWeight: 800,
              cursor: saving ? "not-allowed" : "pointer",
              transition: "background 0.15s, transform 0.1s",
            }}
            onMouseEnter={(e) => {
              if (!saving) e.currentTarget.style.background = "linear-gradient(135deg, rgba(232,201,138,0.45), rgba(201,169,110,0.35))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "linear-gradient(135deg, var(--ivory, #F5F0E8), rgba(201,169,110,0.22))";
            }}
          >
            💬 פתח שיחה ב-DREAM BOT
          </button>
        )}

        <Section title="סיכום שהייה">
          <div style={{
            padding: "12px 14px", borderRadius: 10, marginBottom: 10,
            background: "var(--ivory,#F5F0E8)", border: "1px solid var(--border,#E0D5C5)",
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
              {bookingTypeLabel(resolvedBookingType)}
              {profile.stay.booking_type === "auto" && guest?.guest_notes && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginRight: 8 }}>
                  (זוהה מהערות)
                </span>
              )}
            </div>
            {guest?.order_number && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
                הזמנה #{guest.order_number}
                {guest.arrival_date ? ` · הגעה ${guest.arrival_date}` : ""}
              </div>
            )}
            {guest?.room && suiteRooms.length <= 1 && (
              <div style={{ fontSize: 12 }}>🛏️ {guest.room}</div>
            )}
            {roomsLoading && (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>טוען חדרים…</div>
            )}
            {!roomsLoading && suiteRooms.length > 1 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold-dark)", marginBottom: 4 }}>
                  {suiteRooms.length} חדרים בהזמנה
                </div>
                {suiteRooms.map((row) => {
                  const roomLabel = resolveSuiteRoomDisplayLabel(row);
                  const sent = isSuiteRoomReadySent(row);
                  return (
                    <div key={row.res_line_id} style={{ fontSize: 12, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                      🛏️ {formatSuiteRoomLine(row)}
                      {sent && (
                        <span style={{ fontSize: 10, color: "#16A34A", fontWeight: 700, marginRight: 6 }}>
                          · ✅ חדר מוכן נשלח
                        </span>
                      )}
                      {!sent && roomLabel && (
                        <span style={{ fontSize: 10, color: "var(--text-muted)", marginRight: 6 }}>
                          · ממתין לשליחה
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {!roomsLoading && suiteRooms.length === 1 && (
              <div style={{ fontSize: 12, marginTop: 4 }}>🛏️ {formatSuiteRoomLine(suiteRooms[0])}</div>
            )}
            {formatSpaSchedule(guest?.spa_date, guest?.spa_time) && (
              <div style={{ fontSize: 12, marginTop: 6 }}>💆 {formatSpaSchedule(guest.spa_date, guest.spa_time)}</div>
            )}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>סוג הזמנה (ידני)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {BOOKING_TYPES.map(({ id, label }) => (
              <Chip
                key={id}
                label={label}
                active={profile.stay.booking_type === id}
                disabled={saving}
                onClick={() => setProfileField("stay.booking_type", id)}
              />
            ))}
          </div>
          {resolvedBookingType === "group" && guest?.guest_notes && (
            <div style={{
              fontSize: 11, lineHeight: 1.5, padding: 10, borderRadius: 8,
              background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E",
            }}>
              <strong>פרטי אורח מהערות:</strong>
              <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{guest.guest_notes}</div>
            </div>
          )}
        </Section>

        <Section title="פנסיון וארוחות">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {MEAL_PLANS.map(({ id, label }) => (
              <Chip
                key={id}
                label={label}
                active={mealPlan === id}
                disabled={saving}
                onClick={() => setMealPlan(id)}
              />
            ))}
          </div>
          <label style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>
            מיקום ארוחות
          </label>
          <input
            type="text"
            value={mealLocation}
            onChange={(e) => setMealLocation(e.target.value)}
            disabled={saving}
            placeholder="מסעדת ערמונים"
            style={{
              width: "100%", padding: "8px 10px", marginBottom: 12, boxSizing: "border-box",
              border: "1px solid var(--border)", borderRadius: 8,
            }}
          />
          {(MEAL_SLOTS_BY_PLAN[mealPlan] ?? []).map((slot) => (
            <div key={slot} style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>
                {MEAL_SLOT_LABELS[slot]}
              </label>
              <IsraeliTimeSelect
                value={mealTimes[slot]}
                onChange={(v) => setMealTimes((prev) => ({ ...prev, [slot]: v }))}
                disabled={saving}
                emptyLabel="ללא שעה"
              />
            </div>
          ))}
          {mealPlan === "none" && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, display: "block", marginBottom: 4 }}>
                שעת ארוחה (כללי)
              </label>
              <IsraeliTimeSelect
                value={mealTimes.dinner}
                onChange={(v) => setMealTimes((prev) => ({ ...prev, dinner: v }))}
                disabled={saving}
                emptyLabel="ללא שעה"
              />
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
