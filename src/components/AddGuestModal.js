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

export default function AddGuestModal({ guest, onClose, onSaved, showToast, dock }) {
  const isEdit = !!guest.id;
  const isDrawer = dock === "right";
  const [form, setForm] = useState({
    phone:              guest.phone               ?? "",
    name:               guest.name                ?? "",
    arrival_date:       guest.arrival_date         ?? "",
    departure_date:     guest.departure_date       ?? "",
    spa_time:           guest.spa_time             ?? "",
    treatment_count:    guest.treatment_count != null ? String(guest.treatment_count) : "",
    order_number:       guest.order_number         ?? "",
    payment_amount:     guest.payment_amount != null ? String(guest.payment_amount) : "",
    payment_link_url:   guest.payment_link_url     ?? "",
    status:             guest.status               ?? (isEdit ? "expected" : "pending"),
    requires_attention: !!guest.requires_attention,
    needs_callback:     !!guest.needs_callback,
    room:               guest.room                 ?? "",
    room_type:          guest.room_type            ?? "standard",
    meal_time:          guest.meal_time            ?? "",
    meal_location:      guest.meal_location        ?? "",
    guest_notes:        guest.guest_notes          ?? "",
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
        payment_amount:     form.payment_amount !== "" ? parseFloat(form.payment_amount) : null,
        payment_link_url:   (form.payment_link_url ?? "").trim() || null,
        status:             form.status,
        requires_attention: !!form.requires_attention,
        needs_callback:     !!form.needs_callback,
        room:               form.room || null,
        room_type:          form.room_type || null,
        meal_time:          form.meal_time || null,
        meal_location:      (form.meal_location ?? "").trim() || null,
        guest_notes:        (form.guest_notes ?? "").trim() || null,
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
        position: "fixed", inset: 0,
        // direction explicitly "ltr" here (overriding the inherited global
        // <html dir="rtl">, see index.html) so justifyContent:"flex-end"
        // means screen-right, not flipped-by-RTL screen-left. The inner
        // panel below re-asserts direction:"rtl" for its own text content —
        // only this outer positioning container needs the override.
        direction: "ltr",
        background: isDrawer ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.5)",
        zIndex: 1000, display: "flex",
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
          padding: "28px 24px 22px", width: "100%", maxWidth: 420, height: "100%",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.18)", direction: "rtl",
          overflowY: "auto", animation: "agm-drawer-in 0.2s ease-out",
        } : {
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
          { label: "שעת ארוחה",    field: "meal_time",       type: "time"   },
          { label: "מיקום ארוחה",  field: "meal_location",   type: "text"   },
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
            <option value="cancelled">❌ מבוטל</option>
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

        {/* guest_notes — append-only log written by whatsapp-webhook (migration
            053) for AI-captured free-text requests. Until now this had no edit
            surface anywhere in the app (read-only banner in WhatsAppInbox.js) —
            this is the first place staff can correct/clear it directly. */}
        <div style={{ marginTop: 4, marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
            📝 הערות אורח <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(נכתב גם אוטומטית ע״י הבוט)</span>
          </label>
          <textarea
            value={form.guest_notes ?? ""}
            onChange={(e) => setField("guest_notes", e.target.value)}
            disabled={saving}
            rows={3}
            style={{
              width: "100%", padding: "9px 12px", boxSizing: "border-box",
              border: "1px solid var(--border,#ddd)", borderRadius: 8, fontSize: 13,
              direction: "rtl", fontFamily: "Heebo,sans-serif", resize: "vertical",
            }}
          />
        </div>

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
