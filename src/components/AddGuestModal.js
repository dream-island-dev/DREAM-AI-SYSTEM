// src/components/AddGuestModal.js
// Universal Add/Edit Guest modal — single source of truth for the guest CRUD
// form (§0.5 — golden guests profile). Extracted from GuestsPage.js so every
// surface that can create a guest (GuestsPage, GuestDashboard) shares the same
// complete field set — incl. spa_time, treatment_count, order_number,
// room_type, departure_date — instead of each maintaining its own partial
// duplicate that the automation pipeline or GuestDashboard's tab bucketing
// then silently can't read from.
//
// Caller contract: only mount this when `guest` is truthy, e.g.
//   {editGuest && <AddGuestModal guest={editGuest} onClose={...} onSaved={...} showToast={...} />}
// guest = {} → new guest (no id); guest = {id, ...} → edit existing.
import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { SUITE_REGISTRY, SUITE_SECTIONS } from "../data/suiteRegistry";
import GuestSmartProfileFields from "./GuestSmartProfileFields";
import IsraeliTimeSelect from "./IsraeliTimeSelect";
import { normalizeGuestProfile, serializeGuestProfile } from "../data/guestProfileSchema";
import {
  MEAL_PLANS,
  MEAL_SLOTS_BY_PLAN,
  MEAL_SLOT_LABELS,
  normalizeMealPlan,
  applyLegacyMealColumns,
} from "../data/stayMealsSchema";
import { buildCombinedRoomLabel, splitCombinedRoomLabel } from "../utils/guestImportIntelligence";
import { fetchGuestSuiteRooms } from "../utils/guestStaySummary";
import {
  resolveSuiteRoomDisplayLabel,
  syncGuestSuiteRoomsFromSelection,
} from "../utils/suiteRoomReady";
import { ensureMissingDepartureAlert, isMissingSuiteDepartureDate } from "../utils/departureDateGuard";

// ── Smart room_type inference ─────────────────────────────────────────────────
// Deterministic mapping from the room <select> value to DB room_type.
// Returns null when the value is blank (no auto-change) so a manager who
// intentionally left room empty can still set room_type manually.
const _SUITE_SET = new Set(SUITE_REGISTRY);
const DAY_PACKAGE_ROOMS = new Set(["Premium Day 1", "Premium Day 2"]);
const MAX_SUITE_ROOMS = 8;

function isDayPackageRoom(roomValue) {
  return DAY_PACKAGE_ROOMS.has(roomValue) || String(roomValue ?? "").includes("Premium");
}
function inferRoomType(roomValue) {
  if (!roomValue) return null;
  // "Premium Day 1" / "Premium Day 2" — English values set by ArrivalImportPanel
  if (roomValue.includes("Premium")) return "premium_day_guest";
  // Any room in the 26-suite registry → suite
  if (_SUITE_SET.has(roomValue)) return "suite";
  // Free-text fallback (manual typing): check Hebrew keywords
  if (roomValue.includes("פרימיום")) return "premium_day_guest";
  if (roomValue.includes("בילוי יומי")) return "day_guest";
  // Unknown value — don't overwrite what the manager chose
  return null;
}

export default function AddGuestModal({
  guest, onClose, onSaved, showToast, dock, onOpenDreamBotChat, zIndex = 1000,
}) {
  const isEdit = !!guest.id;
  const isDrawer = dock === "right";
  const [form, setForm] = useState({
    phone:              guest.phone               ?? "",
    name:               guest.name                ?? "",
    arrival_date:       guest.arrival_date         ?? "",
    departure_date:     guest.departure_date       ?? "",
    spa_date:           guest.spa_date             ?? "",
    spa_time:           guest.spa_time             ?? "",
    treatment_count:    guest.treatment_count != null ? String(guest.treatment_count) : "",
    order_number:       guest.order_number         ?? "",
    payment_amount:     guest.payment_amount != null ? String(guest.payment_amount) : "",
    payment_link_url:   guest.payment_link_url     ?? "",
    status:             guest.status               ?? (isEdit ? "expected" : "pending"),
    requires_attention: !!guest.requires_attention,
    needs_callback:     !!guest.needs_callback,
    room:               guest.room                 ?? "",
    room_type:          guest.room_type            ?? "suite",
    meal_time:          guest.meal_time            ?? "",
    meal_plan:          normalizeMealPlan(guest.meal_plan),
    breakfast_time:     guest.breakfast_time       ?? "",
    lunch_time:         guest.lunch_time           ?? "",
    dinner_time:        guest.dinner_time          ?? guest.meal_time ?? "",
    // Default to Armonim for a NEW guest only — "ARMONIM RESTAURANT DEFAULT"
    // session, saves reception repetitive typing. An existing guest whose
    // meal_location is genuinely blank stays blank on edit (isEdit guard) —
    // never silently overwrite a deliberate value while editing.
    meal_location:      guest.meal_location        ?? (isEdit ? "" : "מסעדת ערמונים"),
    lead_source:        guest.lead_source          ?? "",
    automation_muted:   !!guest.automation_muted,
    arrival_time:       guest.arrival_time           ?? "",
  });
  const [smartProfile, setSmartProfile] = useState(() => normalizeGuestProfile(guest?.guest_profile));
  const [saving, setSaving] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState(() => {
    const split = splitCombinedRoomLabel(guest.room);
    return split.length > 0 ? split : [""];
  });

  useEffect(() => {
    if (!isEdit || !supabase || !guest?.id) return;
    let cancelled = false;
    (async () => {
      const rows = await fetchGuestSuiteRooms(supabase, guest);
      if (cancelled || !rows.length) return;
      const labels = rows.map(resolveSuiteRoomDisplayLabel).filter(Boolean);
      if (labels.length) setSelectedRooms(labels);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when identity keys change
  }, [isEdit, guest?.id, guest?.order_number, guest?.arrival_date, guest?.phone]);

  const setField = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const setRoomAt = (index, value) => {
    setSelectedRooms((prev) => {
      const next = [...prev];
      next[index] = value;
      if (isDayPackageRoom(value)) return [value];
      return next;
    });
    const inferred = inferRoomType(value);
    if (inferred) setForm((p) => ({ ...p, room_type: inferred }));
  };

  const addRoomSlot = () => {
    setSelectedRooms((prev) => {
      if (prev.some(isDayPackageRoom)) return prev;
      if (prev.length >= MAX_SUITE_ROOMS) return prev;
      return [...prev, ""];
    });
  };

  const removeRoomSlot = (index) => {
    setSelectedRooms((prev) => {
      if (prev.length <= 1) return [""];
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSave = async () => {
    if (!supabase) return;
    if (form.departure_date && form.arrival_date && form.departure_date < form.arrival_date) {
      showToast?.("err", "תאריך עזיבה לא יכול להיות לפני תאריך ההגעה");
      return;
    }
    const roomLabelsPre = splitCombinedRoomLabel(buildCombinedRoomLabel(selectedRooms));
    const isDayGuestRoomPre =
      roomLabelsPre.some(isDayPackageRoom)
      || form.room_type === "day_guest"
      || form.room_type === "premium_day_guest";
    const isSuiteGuestPre = !isDayGuestRoomPre && (
      form.room_type === "suite" || roomLabelsPre.some((r) => r && !isDayPackageRoom(r))
    );
    if (isSuiteGuestPre && form.arrival_date && !form.departure_date) {
      showToast?.("err", "תאריך עזיבה חובה לאורח סוויטה");
      return;
    }
    setSaving(true);
    try {
      let spaDate = form.spa_date || null;
      const spaTime = form.spa_time || null;
      if (spaTime && !spaDate && form.arrival_date) spaDate = form.arrival_date;
      const roomLabels = splitCombinedRoomLabel(buildCombinedRoomLabel(selectedRooms));
      const patch = {
        name:               form.name.trim() || null,
        arrival_date:       form.arrival_date  || null,
        departure_date:     form.departure_date || null,
        spa_date:           spaDate,
        spa_time:           spaTime,
        treatment_count:    form.treatment_count !== "" ? parseInt(form.treatment_count, 10) : 0,
        order_number:       (form.order_number ?? "").trim() || null,
        payment_amount:     form.payment_amount !== "" ? parseFloat(form.payment_amount) : null,
        payment_link_url:   (form.payment_link_url ?? "").trim() || null,
        status:             form.status,
        requires_attention: !!form.requires_attention,
        needs_callback:     !!form.needs_callback,
        ...(!form.requires_attention ? { attention_reason: null } : {}),
        room:               buildCombinedRoomLabel(roomLabels) || null,
        room_type:          form.room_type || null,
        lead_source:        (form.lead_source ?? "").trim() || null,
        guest_profile:      serializeGuestProfile(smartProfile),
        arrival_time:       (form.arrival_time ?? "").trim() || null,
        ...applyLegacyMealColumns(
          form.meal_plan,
          {
            breakfast: form.breakfast_time,
            lunch: form.lunch_time,
            dinner: form.dinner_time,
          },
          form.meal_location,
        ),
        automation_muted:   !!form.automation_muted,
      };
      if (form.status === "checked_out") {
        patch.checked_out_at = guest?.checked_out_at || new Date().toISOString();
        patch.room_ready_notified = false;
        patch.msg_room_ready_sent = false;
        patch.room_ready_at = null;
      }

      let savedGuest;
      if (isEdit) {
        const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
        if (error) throw error;
        savedGuest = { ...guest, ...patch };
        onSaved?.(savedGuest);
      } else {
        const phone = (form.phone ?? "").trim();
        if (!phone) { showToast?.("err", "מספר טלפון הוא שדה חובה"); setSaving(false); return; }
        const { data: created, error } = await supabase
          .from("guests").insert({ ...patch, phone }).select().maybeSingle();
        if (error) throw error;
        savedGuest = created;
        onSaved?.(created);
      }

      const isDayGuestRoom =
        roomLabels.some(isDayPackageRoom)
        || form.room_type === "day_guest"
        || form.room_type === "premium_day_guest";
      const syncResult = await syncGuestSuiteRoomsFromSelection(supabase, {
        guestId: savedGuest.id,
        guestPhone: savedGuest.phone,
        guestName: savedGuest.name,
        orderNumber: savedGuest.order_number,
        arrivalDate: savedGuest.arrival_date,
        roomLabels,
        isDayGuest: isDayGuestRoom,
      });
      if (!syncResult.ok) {
        showToast?.("err", `אורח נשמר — סנכרון suite_rooms נכשל: ${syncResult.error}`);
      } else {
        showToast?.("ok", isEdit ? "✅ פרופיל אורח עודכן בהצלחה" : "✅ אורח נוסף בהצלחה");
      }
      if (savedGuest?.id) {
        await ensureMissingDepartureAlert(supabase, savedGuest);
      }
      onClose?.();
    } catch (e) {
      showToast?.("err", "שגיאה: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (!saving) onClose?.();
      }}
      style={{
        position: "fixed", inset: 0,
        // direction explicitly "ltr" here (overriding the inherited global
        // <html dir="rtl">, see index.html) so justifyContent:"flex-end"
        // means screen-right, not flipped-by-RTL screen-left. The inner
        // panel below re-asserts direction:"rtl" for its own text content —
        // only this outer positioning container needs the override.
        direction: "ltr",
        background: isDrawer ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.5)",
        zIndex: zIndex, display: "flex",
        alignItems: isDrawer ? "stretch" : "center",
        justifyContent: isDrawer ? "flex-end" : "center",
        padding: isDrawer ? 0 : 16,
      }}
    >
      <style>{`@keyframes agm-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={isDrawer ? {
          background: "var(--card-bg,#fff)", borderRadius: 0,
          padding: "28px 24px 22px", width: "100%", maxWidth: 480, height: "100%",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.18)", direction: "rtl",
          overflowY: "auto", animation: "agm-drawer-in 0.2s ease-out",
        } : {
          background: "var(--card-bg,#fff)", borderRadius: 18,
          padding: "28px 24px 22px", width: "100%",           maxWidth: 480,
          boxShadow: "0 24px 64px rgba(0,0,0,0.25)", direction: "rtl",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
          {isEdit ? "✏️ עריכת פרופיל אורח" : "➕ הוספת אורח ידני"}
        </div>
        {isEdit && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, direction: "ltr" }}>
            {guest.phone}
          </div>
        )}

        {isEdit && guest.phone && onOpenDreamBotChat && (
          <button
            type="button"
            onClick={() => {
              onOpenDreamBotChat({ phone: guest.phone, guestName: guest.name });
              onClose?.();
            }}
            disabled={saving}
            style={{
              width: "100%", minHeight: 44, marginBottom: 16, padding: "10px 14px",
              borderRadius: 10, border: "2px solid var(--gold,#C9A96E)",
              background: "linear-gradient(135deg, var(--ivory, #F5F0E8), rgba(201,169,110,0.22))",
              color: "var(--gold-dark,#A8843A)", fontFamily: "Heebo, sans-serif",
              fontSize: 13, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            💬 פתח שיחה ב-DREAM BOT
          </button>
        )}

        {/* Phone — required for new guests only */}
        {!isEdit && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
              טלפון <span style={{ color: "#C0392B" }}>*</span>
            </label>
            <input
              type="tel"
              value={form.phone ?? ""}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="+972501234567"
              disabled={saving}
              style={{
                width: "100%", padding: "9px 12px", boxSizing: "border-box",
                border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 14,
                direction: "ltr", fontFamily: "Heebo,sans-serif",
              }}
            />
          </div>
        )}

        {/* Text fields */}
        {[
          { label: "שם מלא",       field: "name",            type: "text"   },
          { label: "תאריך הגעה",   field: "arrival_date",    type: "date"   },
          { label: "מספר טיפולים", field: "treatment_count", type: "number" },
          { label: "מספר הזמנה",   field: "order_number",    type: "text"   },
          // ★ Session 2 — payment fields, deliberately NOT gated behind status/
          // arrival_confirmed (DNA §0.5 single source of truth): a manager can
          // set these the moment a booking is created, so they're already
          // populated by the time Stage 2 Pay fires automatically on arrival
          // confirmation, instead of requiring the separate GuestsPage popup.
          { label: "מחיר לתשלום (₪)", field: "payment_amount",   type: "number" },
          { label: "קישור תשלום",     field: "payment_link_url", type: "url"    },
        ].map(({ label, field, type }) => (
          <div key={field} style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>{label}</label>
            <input
              type={type}
              value={form[field] ?? ""}
              onChange={(e) => setField(field, e.target.value)}
              disabled={saving}
              style={{
                width: "100%", padding: "9px 12px", boxSizing: "border-box",
                border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 14,
                direction: type === "text" ? "rtl" : "ltr", fontFamily: "Heebo,sans-serif",
              }}
            />
          </div>
        ))}

        {/* Spa — date + 24h time (Israeli, no AM/PM) */}
        <div style={{
          marginBottom: 14, padding: "12px 14px", borderRadius: 10,
          background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.22)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#7c3aed", marginBottom: 10 }}>
            💆 טיפול ספא
          </div>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
            תאריך טיפול
          </label>
          <input
            type="date"
            value={form.spa_date ?? ""}
            min={form.arrival_date || undefined}
            max={form.departure_date || undefined}
            onChange={(e) => setField("spa_date", e.target.value)}
            disabled={saving}
            style={{
              width: "100%", padding: "9px 12px", boxSizing: "border-box", marginBottom: 10,
              border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 14,
              direction: "ltr", fontFamily: "Heebo,sans-serif",
            }}
          />
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
            שעת טיפול (24 שעות)
          </label>
          <IsraeliTimeSelect
            value={form.spa_time}
            onChange={(v) => setField("spa_time", v)}
            disabled={saving}
          />
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.4 }}>
            פורמט ישראלי — למשל 14:30 (בלי AM/PM). ברירת מחדל: 07:00–22:00, צעדים של 15 דקות.
          </div>
        </div>

        {/* Meals — board basis + per-meal times */}
        <div style={{
          marginBottom: 14, padding: "12px 14px", borderRadius: 10,
          background: "rgba(180,83,9,0.06)", border: "1px solid rgba(180,83,9,0.22)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#b45309", marginBottom: 10 }}>
            🍽️ פנסיון וארוחות
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {MEAL_PLANS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                disabled={saving}
                onClick={() => setField("meal_plan", id)}
                style={{
                  padding: "5px 10px", borderRadius: 16, fontSize: 11, fontWeight: 700,
                  cursor: saving ? "not-allowed" : "pointer", fontFamily: "Heebo,sans-serif",
                  border: form.meal_plan === id ? "2px solid #b45309" : "1.5px solid #ddd",
                  background: form.meal_plan === id ? "rgba(180,83,9,0.15)" : "#fff",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
            מיקום ארוחות
          </label>
          <input
            type="text"
            value={form.meal_location ?? ""}
            onChange={(e) => setField("meal_location", e.target.value)}
            disabled={saving}
            placeholder="מסעדת ערמונים"
            style={{
              width: "100%", padding: "9px 12px", boxSizing: "border-box", marginBottom: 10,
              border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 14,
            }}
          />
          {(MEAL_SLOTS_BY_PLAN[form.meal_plan] ?? []).map((slot) => (
            <div key={slot} style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
                {MEAL_SLOT_LABELS[slot]}
              </label>
              <IsraeliTimeSelect
                value={form[`${slot}_time`]}
                onChange={(v) => setField(`${slot}_time`, v)}
                disabled={saving}
                emptyLabel="ללא שעה"
              />
            </div>
          ))}
          {form.meal_plan === "none" && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
                שעת ארוחה
              </label>
              <IsraeliTimeSelect
                value={form.dinner_time}
                onChange={(v) => setField("dinner_time", v)}
                disabled={saving}
                emptyLabel="ללא שעה"
              />
            </div>
          )}
        </div>

        {/* Departure date — kept separate from the generic text-field list so it
            can enforce a min of the arrival date. */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>תאריך עזיבה</label>
          <input
            type="date"
            value={form.departure_date ?? ""}
            min={form.arrival_date || undefined}
            onChange={(e) => setField("departure_date", e.target.value)}
            disabled={saving}
            style={{
              width: "100%", padding: "9px 12px", boxSizing: "border-box",
              border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 14,
              direction: "ltr", fontFamily: "Heebo,sans-serif",
            }}
          />
        </div>

        {/* Room / suite selector — SUITE_REGISTRY; multi-room → suite_rooms sync on save */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
            חדר / חבילה
            {selectedRooms.length > 1 && (
              <span style={{ fontWeight: 600, color: "var(--text-muted)", marginRight: 6 }}>
                ({selectedRooms.length} חדרים)
              </span>
            )}
          </label>
          {selectedRooms.map((roomValue, idx) => (
            <div key={`room-slot-${idx}`} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <select
                value={roomValue ?? ""}
                onChange={(e) => setRoomAt(idx, e.target.value)}
                disabled={saving}
                style={{
                  flex: 1, padding: "9px 12px", border: "1px solid var(--border,#ddd)",
                  borderRadius: 8, fontSize: 14, fontFamily: "Heebo,sans-serif",
                  background: "var(--card-bg,#fff)", cursor: "pointer",
                }}
              >
                <option value="">— ללא חדר —</option>
                <optgroup label="⭐ בילוי יומי">
                  <option value="Premium Day 1">חבילת פרימיום בילוי יומי 1</option>
                  <option value="Premium Day 2">חבילת פרימיום בילוי יומי 2</option>
                </optgroup>
                {SUITE_SECTIONS.map((sec) => (
                  <optgroup key={sec.label} label={`${sec.icon} ${sec.label}`}>
                    {SUITE_REGISTRY
                      .filter((s) => sec.prefix.some((p) => s.startsWith(p)))
                      .map((s) => <option key={s} value={s}>{s}</option>)}
                  </optgroup>
                ))}
              </select>
              {selectedRooms.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRoomSlot(idx)}
                  disabled={saving}
                  title="הסר חדר מההזמנה"
                  style={{
                    padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border,#ddd)",
                    background: "#FFF0EE", color: "#C0392B", cursor: saving ? "not-allowed" : "pointer",
                    fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {!selectedRooms.some(isDayPackageRoom) && selectedRooms.length < MAX_SUITE_ROOMS && (
            <button
              type="button"
              onClick={addRoomSlot}
              disabled={saving}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px dashed var(--gold,#C9A96E)",
                background: "transparent", color: "var(--gold-dark,#A8843A)",
                fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              + חדר נוסף
            </button>
          )}
        </div>

        {/* Room type — drives day_guest/premium_day_guest/suite badges + tab bucketing
            in GuestDashboard.js. Auto-inferred when a room is selected above;
            still fully editable so staff can correct an inference.
            "standard" (legacy DB value) is not shown as a selectable option —
            existing rows with that value display as ⚠ standard (FAIL VISIBLE §0.3). */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>סוג שיוך</label>
          <select
            value={form.room_type ?? "suite"}
            onChange={(e) => setField("room_type", e.target.value)}
            disabled={saving}
            style={{
              width: "100%", padding: "9px 12px", border: "1px solid var(--border,#ddd)",
              borderRadius: 8, fontSize: 14, fontFamily: "Heebo,sans-serif",
              background: "var(--card-bg,#fff)", cursor: "pointer",
            }}
          >
            <option value="day_guest">🏊 בילוי יומי</option>
            <option value="premium_day_guest">⭐ פרימיום בילוי יומי</option>
            <option value="suite">👑 סוויטה</option>
            {/* Render legacy value only when the loaded guest actually has it,
                so it appears in the dropdown instead of silently snapping to
                the first option — FAIL VISIBLE §0.3. */}
            {form.room_type === "standard" && (
              <option value="standard">⚠ standard (ישן)</option>
            )}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>סטטוס</label>
          <select
            value={form.status ?? "expected"}
            onChange={(e) => setField("status", e.target.value)}
            disabled={saving}
            style={{
              width: "100%", padding: "9px 12px", border: "1px solid var(--border,#ddd)",
              borderRadius: 8, fontSize: 14, fontFamily: "Heebo,sans-serif",
              background: "var(--card-bg,#fff)", cursor: "pointer",
            }}
          >
            <option value="pending">ממתין לייבוא</option>
            <option value="expected">ממתין</option>
            <option value="room_ready">חדר מוכן</option>
            <option value="checked_in">צ'ק-אין</option>
            <option value="checked_out">צ'ק-אאוט (עזב)</option>
            <option value="cancelled">❌ מבוטל</option>
          </select>
        </div>

        {[
          { label: "דורש תשומת לב 🔴",              field: "requires_attention" },
          { label: "ממתין לטיפול צוות 🔴",       field: "needs_callback"     },
        ].map(({ label, field }) => (
          <div key={field} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 0", borderBottom: "1px solid var(--border,#eee)",
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
            <input
              type="checkbox"
              checked={!!form[field]}
              onChange={(e) => setField(field, e.target.checked)}
              disabled={saving}
              style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--gold)" }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>מקור הגעה (Lead Source)</label>
          <input
            type="text"
            value={form.lead_source ?? ""}
            onChange={(e) => setField("lead_source", e.target.value)}
            disabled={saving}
            placeholder="המלצה / שוברים / מחלקת מכירות"
            style={{
              width: "100%", padding: "9px 12px", boxSizing: "border-box",
              border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 14,
              direction: "rtl", fontFamily: "Heebo,sans-serif",
            }}
          />
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 0", borderBottom: "1px solid var(--border,#eee)", marginBottom: 8,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }} title="חוסם שליחות אוטומטיות (cron + pipeline) — אורח נשאר גלוי בלוח">
            🔇 השתק אוטומציה (מכירות/ארגוני)
          </span>
          <input
            type="checkbox"
            checked={!!form.automation_muted}
            onChange={(e) => setField("automation_muted", e.target.checked)}
            disabled={saving}
            style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--gold)" }}
          />
        </div>

        {isEdit && (
          <GuestSmartProfileFields
            profile={smartProfile}
            onProfileChange={setSmartProfile}
            arrivalTime={form.arrival_time}
            onArrivalTimeChange={(v) => setField("arrival_time", v)}
            guest={guest}
            saving={saving}
          />
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <button
            onClick={() => onClose?.()}
            disabled={saving}
            style={{
              padding: "9px 18px", borderRadius: 8,
              border: "1px solid var(--border,#ddd)", background: "transparent",
              fontFamily: "Heebo,sans-serif", fontSize: 13, cursor: "pointer",
            }}>
            ביטול
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "9px 22px", borderRadius: 8, border: "none",
              background: "linear-gradient(135deg,var(--gold),var(--gold-dark))",
              color: "#0F0F0F", fontFamily: "Heebo,sans-serif",
              fontSize: 14, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer",
            }}>
            {saving ? "⏳ שומר..." : isEdit ? "💾 שמור שינויים" : "➕ הוסף אורח"}
          </button>
        </div>
      </div>
    </div>
  );
}
