// Collapsible default message templates editor — Restaurant Dinner Board.

import { useState } from "react";
import { supabase } from "../supabaseClient";
import {
  BOT_CONFIG_RESTAURANT_DINNER_MESSAGES_KEY,
  DINNER_MESSAGE_PLACEHOLDER_HELP,
  cloneDefaultRestaurantDinnerMessages,
  normalizeRestaurantDinnerMessages,
  serializeRestaurantDinnerMessages,
} from "../utils/restaurantDinnerMessaging";

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border, #ddd)",
  fontFamily: "Heebo, sans-serif",
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: "right",
  resize: "vertical",
};

export default function RestaurantDinnerTemplatesPanel({ config, onChange, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(JSON.parse(JSON.stringify(normalizeRestaurantDinnerMessages(config))));
    setOpen(true);
  };

  const save = async () => {
    if (!supabase || !draft) return;
    setSaving(true);
    try {
      const normalized = normalizeRestaurantDinnerMessages(draft);
      const { error } = await supabase.from("bot_config").upsert({
        config_key: BOT_CONFIG_RESTAURANT_DINNER_MESSAGES_KEY,
        config_value: serializeRestaurantDinnerMessages(normalized),
        category: "general",
        label: "נוסחי וואטסאפ — לוח מסעדה (JSON)",
      }, { onConflict: "config_key" });
      if (error) throw new Error(error.message);
      onChange(normalized);
      onSaved?.("נוסחי ברירת המחדל נשמרו");
      setOpen(false);
      setDraft(null);
    } catch (e) {
      onError?.(e?.message ?? "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={startEdit}
        style={{
          marginBottom: 14, padding: "9px 14px", borderRadius: 10,
          border: "1px solid var(--border, #ddd)", background: "#fff",
          fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "Heebo, sans-serif",
        }}
      >
        ⚙️ עריכת נוסחי הודעות (ברירת מחדל)
      </button>
    );
  }

  const d = draft ?? normalizeRestaurantDinnerMessages(config);

  return (
    <div style={{
      marginBottom: 16, padding: 16, borderRadius: 12,
      border: "1px solid rgba(154,114,9,0.35)", background: "rgba(180,83,9,0.05)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#9A7209" }}>⚙️ נוסחי הודעות ברירת מחדל</div>
        <button type="button" onClick={() => { setOpen(false); setDraft(null); }} style={{ cursor: "pointer", fontFamily: "inherit" }}>
          סגור
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.55 }}>
        משתנים: {DINNER_MESSAGE_PLACEHOLDER_HELP.map((x) => x.key).join(" · ")} — לפני שליחה אפשר לערוך גם בכרטיס האורח.
      </p>

      {[
        ["ask_template", "שאלת תיאום (עם שעות מוצעות)"],
        ["ask_template_no_slots", "שאלת תיאום (בלי שעות ברשימה)"],
        ["confirm_template", "אישור שולחן (עם שעה)"],
        ["confirm_template_no_time", "אישור שולחן (בלי שעה)"],
        ["custom_template", "הודעה חופשית — פתיחה"],
      ].map(([key, label]) => (
        <label key={key} style={{ display: "block", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{label}</div>
          <textarea
            rows={4}
            value={d[key] ?? ""}
            onChange={(e) => setDraft({ ...d, [key]: e.target.value })}
            style={fieldStyle}
          />
        </label>
      ))}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          style={{
            padding: "10px 16px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg, #C9A96E, #A8843A)", fontWeight: 800,
            cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
          }}
        >
          {saving ? "שומר…" : "💾 שמירת נוסחים"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setDraft(cloneDefaultRestaurantDinnerMessages())}
          style={{
            padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)",
            background: "#fff", fontFamily: "inherit", fontWeight: 700,
          }}
        >
          איפוס לברירת מחדל
        </button>
      </div>
    </div>
  );
}
