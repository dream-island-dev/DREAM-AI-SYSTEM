// Quick walk-in / manual guest for Restaurant Board — minimal fields.

import { useState } from "react";
import { supabase } from "../supabaseClient";
import { MEAL_PLANS, normalizeMealPlan } from "../data/stayMealsSchema";
import { normalizeWhatsAppPhone } from "../utils/ezgoParser";
import { israelTodayStr } from "../utils/guestTiming";
import { SUITE_REGISTRY } from "../data/suiteRegistry";

const GOLD = "#C9A96E";
const GOLD_DARK = "#A8843A";

export default function RestaurantWalkInModal({ dayYmd, onClose, onSaved, onError }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [room, setRoom] = useState("");
  const [mealPlan, setMealPlan] = useState("half_board");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      onError?.("שם אורח חובה");
      return;
    }
    if (!supabase) return;

    let normalizedPhone = null;
    if (phone.trim()) {
      normalizedPhone = normalizeWhatsAppPhone(phone.trim());
      if (!normalizedPhone) {
        onError?.("מספר טלפון לא תקין");
        return;
      }
    }

    const roomVal = room.trim() || null;
    const roomType = roomVal && SUITE_REGISTRY.includes(roomVal) ? "suite" : null;
    const today = israelTodayStr();
    const status = dayYmd === today ? "checked_in" : "expected";

    setSaving(true);
    try {
      const guest_profile = {
        restaurant: {
          walk_in: true,
          added_at: new Date().toISOString(),
        },
      };

      const { data, error } = await supabase
        .from("guests")
        .insert({
          name: trimmedName,
          phone: normalizedPhone,
          room: roomVal,
          room_type: roomType,
          meal_plan: normalizeMealPlan(mealPlan),
          meal_location: "מסעדת ערמונים",
          arrival_date: dayYmd,
          departure_date: dayYmd,
          status,
          guest_profile,
        })
        .select(
          "id, name, phone, room, room_type, status, arrival_date, departure_date, meal_plan, " +
          "breakfast_time, lunch_time, dinner_time, meal_time, meal_location, guest_profile",
        )
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("לא נוצר אורח");

      onSaved?.(data);
      onClose?.();
    } catch (e) {
      onError?.(e?.message ?? "שגיאה ביצירת אורח");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 420, background: "#fff", borderRadius: 14,
          padding: "20px 22px", boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
        }}
      >
        <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 800, color: "#9A7209" }}>
          + אורח ידני
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          ללא הזמנה ב-EZGO — מופיע בלוח ליום {dayYmd}. שעות ארוחה יסונכרנו לפורטל אחרי שמירה.
        </p>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>שם *</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            style={{
              display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
              padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border, #ddd)", fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>טלפון (אופציונלי)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="05X-XXXXXXX"
            dir="ltr"
            style={{
              display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
              padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border, #ddd)", fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>חדר / שולחן (אופציונלי)</span>
          <input
            type="text"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="סוויטה / שולחן 12"
            style={{
              display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
              padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border, #ddd)", fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "block", marginBottom: 18 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>פנסיון</span>
          <select
            value={mealPlan}
            onChange={(e) => setMealPlan(e.target.value)}
            style={{
              display: "block", width: "100%", boxSizing: "border-box", marginTop: 4,
              padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border, #ddd)", fontSize: 14,
            }}
          >
            {MEAL_PLANS.filter((p) => p.id !== "none").map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)",
              background: "#fff", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "Heebo, sans-serif",
            }}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`,
              color: "#0F0F0F", fontWeight: 800, cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "Heebo, sans-serif",
            }}
          >
            {saving ? "שומר…" : "הוסף ללוח"}
          </button>
        </div>
      </div>
    </div>
  );
}
