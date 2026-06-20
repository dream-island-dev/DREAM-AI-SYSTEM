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
import { useState } from "react";
import { supabase } from "../supabaseClient";
import { SUITE_REGISTRY, SUITE_SECTIONS } from "../data/suiteRegistry";

export default function AddGuestModal({ guest, onClose, onSaved, showToast }) {
  const isEdit = !!guest.id;
  const [form, setForm] = useState({
    phone:              guest.phone               ?? "",
    name:               guest.name                ?? "",
    arrival_date:       guest.arrival_date         ?? "",
    departure_date:     guest.departure_date       ?? "",
    spa_time:           guest.spa_time             ?? "",
    treatment_count:    guest.treatment_count != null ? String(guest.treatment_count) : "",
    order_number:       guest.order_number         ?? "",
    status:             guest.status               ?? (isEdit ? "expected" : "pending"),
    requires_attention: !!guest.requires_attention,
    needs_callback:     !!guest.needs_callback,
    room:               guest.room                 ?? "",
    room_type:          guest.room_type            ?? "standard",
  });
  const [saving, setSaving] = useState(false);

  const setField = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    if (!supabase) return;
    if (form.departure_date && form.arrival_date && form.departure_date < form.arrival_date) {
      showToast?.("err", "תאריך עזיבה לא יכול להיות לפני תאריך ההגעה");
      return;
    }
    setSaving(true);
    try {
      const patch = {
        name:               form.name.trim() || null,
        arrival_date:       form.arrival_date  || null,
        departure_date:     form.departure_date || null,
        spa_time:           form.spa_time       || null,
        treatment_count:    form.treatment_count !== "" ? parseInt(form.treatment_count, 10) : null,
        order_number:       (form.order_number ?? "").trim() || null,
        status:             form.status,
        requires_attention: !!form.requires_attention,
        needs_callback:     !!form.needs_callback,
        room:               form.room || null,
        room_type:          form.room_type || null,
      };

      if (isEdit) {
        const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
        if (error) throw error;
        onSaved?.({ ...guest, ...patch });
        showToast?.("ok", "✅ פרופיל אורח עודכן בהצלחה");
      } else {
        const phone = (form.phone ?? "").trim();
        if (!phone) { showToast?.("err", "מספר טלפון הוא שדה חובה"); setSaving(false); return; }
        const { data: created, error } = await supabase
          .from("guests").insert({ ...patch, phone }).select().maybeSingle();
        if (error) throw error;
        onSaved?.(created);
        showToast?.("ok", "✅ אורח נוסף בהצלחה");
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
      onClick={() => !saving && onClose?.()}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg,#fff)", borderRadius: 18,
          padding: "28px 24px 22px", width: "100%", maxWidth: 480,
          boxShadow: "0 24px 64px rgba(0,0,0,0.25)", direction: "rtl",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
          {isEdit ? "✏️ עריכת פרופיל אורח" : "➕ הוספת אורח ידני"}
        </div>
        {isEdit && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, direction: "ltr" }}>
            {guest.phone}
          </div>
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
          { label: "שעת ספא",      field: "spa_time",        type: "time"   },
          { label: "מספר טיפולים", field: "treatment_count", type: "number" },
          { label: "מספר הזמנה",   field: "order_number",    type: "text"   },
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

        {/* Room / suite selector — SUITE_REGISTRY is the single source for every
            "assign a room" UI in the app (this modal + ArrivalImportPanel's grid). */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>חדר / חבילה</label>
          <select
            value={form.room ?? ""}
            onChange={(e) => setField("room", e.target.value)}
            disabled={saving}
            style={{
              width: "100%", padding: "9px 12px", border: "1px solid var(--border,#ddd)",
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
        </div>

        {/* Room type — drives day_guest/standard/suite badges + tab bucketing
            in GuestDashboard.js. Independent of the room/suite name above so
            staff can still flag a guest as a day guest without clearing room. */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>סוג שיוך</label>
          <select
            value={form.room_type ?? "standard"}
            onChange={(e) => setField("room_type", e.target.value)}
            disabled={saving}
            style={{
              width: "100%", padding: "9px 12px", border: "1px solid var(--border,#ddd)",
              borderRadius: 8, fontSize: 14, fontFamily: "Heebo,sans-serif",
              background: "var(--card-bg,#fff)", cursor: "pointer",
            }}
          >
            <option value="day_guest">🏊 בילוי יומי</option>
            <option value="standard">🏨 חדר רגיל</option>
            <option value="suite">👑 סוויטה</option>
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
          </select>
        </div>

        {[
          { label: "דורש תשומת לב 🔴",              field: "requires_attention" },
          { label: "הועבר לטיפול אנושי (בוט שותק)", field: "needs_callback"     },
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
