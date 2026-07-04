// src/components/BotConfigPanel.js
// Smart Concierge Bot Config Panel — Dream Island
//
// Admin/super_admin only.
// Reads from / writes to the `bot_config` table in Supabase.
// Organised into three tabs: Persona · Hotel Knowledge · Rules
//
// A fourth "Templates" tab (4 rows: template_night_before/checkin_welcome/
// midstay_checkin/before_checkout) was removed in migration 069 — confirmed
// dead code (seeded in migration 015, never read by any send path; the real
// pipeline is bot_scripts + automation_stages, see AutomationControlCenter.js).

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ── Category metadata ────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "persona",   icon: "🎭", label: "אישיות הבוט",       color: "#5B21B6" },
  { id: "knowledge", icon: "🏨", label: "ידע המלון",          color: "#0369A1" },
  { id: "rules",     icon: "📋", label: "כללי תגובה",         color: "#B45309" },
];

/** Stage 2.5 / morning automation — editable here, read by whatsapp-send. */
const ARRIVAL_HOURS_KEYS = [
  "night_before_entry_time_weekday",
  "night_before_checkin_time_weekday",
  "night_before_entry_time_shabbat",
  "night_before_checkin_time_shabbat",
  "night_before_special_dates",
];

function ArrivalHoursPanel({ items, onChange }) {
  const byKey = Object.fromEntries(items.map((i) => [i.config_key, i]));
  const field = (key, placeholder) => {
    const item = byKey[key];
    if (!item) return null;
    return (
      <ConfigRow key={key} item={item} onChange={onChange} placeholder={placeholder} />
    );
  };
  return (
    <div style={{
      marginBottom: 28, padding: "18px 20px",
      background: "linear-gradient(135deg, rgba(3,105,161,0.06), rgba(201,169,110,0.08))",
      border: "2px solid rgba(3,105,161,0.25)",
      borderRadius: 14,
    }}>
      <div style={{ fontWeight: 800, fontSize: 15, color: "#0369A1", marginBottom: 6 }}>
        🕐 שעות כניסה — אוטומציה (חול / שבת / חג)
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 16 }}>
        משמש שלב 2.5 (ערב לפני) ובוקר הגעה. שבת = יום שבת לפי תאריך ההגעה, או תאריכים ברשימת החגים.
        פורמט שעה: <strong>HH:MM</strong> (למשל 15:00).
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "0 20px",
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)", marginBottom: 10 }}>יום חול</div>
          {field("night_before_entry_time_weekday", "12:00")}
          {field("night_before_checkin_time_weekday", "15:00")}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)", marginBottom: 10 }}>שבת / חג</div>
          {field("night_before_entry_time_shabbat", "12:00")}
          {field("night_before_checkin_time_shabbat", "18:00")}
        </div>
      </div>
      {field("night_before_special_dates", "2026-04-13, 2026-09-22")}
    </div>
  );
}

// ── Helper: textarea auto-height ────────────────────────────────────────────
function AutoTextarea({ value, onChange, rows = 3, placeholder }) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "12px 14px", border: "1.5px solid var(--border)",
        borderRadius: 8, fontFamily: "Heebo, sans-serif", fontSize: 14,
        color: "var(--text-main)", outline: "none", resize: "vertical",
        background: "var(--card-bg)", direction: "rtl", lineHeight: 1.6,
        transition: "border-color 0.2s",
      }}
      onFocus={e => e.target.style.borderColor = "var(--gold)"}
      onBlur={e  => e.target.style.borderColor = "var(--border)"}
    />
  );
}

// ── Config field row ─────────────────────────────────────────────────────────
function ConfigRow({ item, onChange, placeholder }) {
  const isLong = (item.config_value || "").length > 80;
  const ph = placeholder ?? `ערך עבור ${item.label || item.config_key}...`;
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{
        display: "block", fontSize: 12, fontWeight: 700,
        color: "var(--text-muted)", marginBottom: 6,
        letterSpacing: 0.3,
      }}>
        {item.label || item.config_key}
      </label>
      {isLong ? (
        <AutoTextarea
          value={item.config_value}
          rows={4}
          onChange={e => onChange(item.config_key, e.target.value)}
          placeholder={ph}
        />
      ) : (
        <input
          type="text"
          value={item.config_value}
          onChange={e => onChange(item.config_key, e.target.value)}
          placeholder={ph}
          style={{
            width: "100%", padding: "12px 14px",
            border: "1.5px solid var(--border)", borderRadius: 8,
            fontFamily: "Heebo, sans-serif", fontSize: 14,
            color: "var(--text-main)", outline: "none",
            background: "var(--card-bg)", direction: "rtl",
            transition: "border-color 0.2s",
          }}
          onFocus={e => e.target.style.borderColor = "var(--gold)"}
          onBlur={e  => e.target.style.borderColor = "var(--border)"}
        />
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, opacity: 0.7 }}>
        🔑 {item.config_key}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function BotConfigPanel({ user }) {
  const [activeTab, setActiveTab] = useState("persona");
  const [config,    setConfig]    = useState({});   // key → item
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Load all config keys ──────────────────────────────────────────────────
  const fetchConfig = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("bot_config")
      .select("*")
      .order("category")
      .order("config_key");
    if (error) {
      showToast("err", "שגיאה בטעינת הגדרות: " + error.message);
    } else {
      const map = {};
      (data ?? []).forEach(row => { map[row.config_key] = { ...row }; });
      setConfig(map);
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  // ── Handle field change ───────────────────────────────────────────────────
  const handleChange = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: { ...prev[key], config_value: value },
    }));
    setSaved(false);
  };

  // ── Save all config ───────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!isSupabaseConfigured || !supabase) {
      return showToast("err", "Supabase לא מחובר");
    }
    setSaving(true);
    try {
      const rows = Object.values(config).map(item => ({
        id:           item.id,
        config_key:   item.config_key,
        config_value: item.config_value,
        category:     item.category,
        label:        item.label,
        updated_by:   user?.id ?? null,
        updated_at:   new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("bot_config")
        .upsert(rows, { onConflict: "config_key" });

      if (error) throw new Error(error.message);
      setSaved(true);
      showToast("ok", "✅ הגדרות הבוט נשמרו בהצלחה!");
    } catch (e) {
      showToast("err", "שגיאה בשמירה: " + e.message);
    }
    setSaving(false);
  };

  // ── Filtered items for active tab ─────────────────────────────────────────
  const tabItems = Object.values(config).filter(item => item.category === activeTab);
  const arrivalHourItems = tabItems.filter((i) => ARRIVAL_HOURS_KEYS.includes(i.config_key));
  const knowledgeWithoutHours = tabItems.filter((i) => !ARRIVAL_HOURS_KEYS.includes(i.config_key));
  const activeCat = CATEGORIES.find(c => c.id === activeTab);

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999, padding: "12px 24px", borderRadius: 10,
          fontWeight: 700, fontSize: 13, maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A"  : "#C0392B",
          border: `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* Header info banner */}
      <div style={{
        background: "linear-gradient(135deg, rgba(201,169,110,0.12), rgba(201,169,110,0.05))",
        border: "1px solid rgba(201,169,110,0.3)",
        borderRadius: 14, padding: "16px 20px", marginBottom: 24,
        display: "flex", alignItems: "flex-start", gap: 14,
      }}>
        <div style={{ fontSize: 32 }}>🤖</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--black)", marginBottom: 4 }}>
            Smart Concierge — הגדרות הבוט
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            ערוך את אישיות הבוט, ידע המלון, תבניות ההודעות וכללי התגובה.
            שינויים נכנסים לתוקף מיידית עבור כל שיחה חדשה עם לקוחות.
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div style={{
        display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap",
      }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveTab(cat.id)}
            style={{
              padding: "9px 18px", borderRadius: 20, cursor: "pointer",
              fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              border: `2px solid ${activeTab === cat.id ? cat.color : "var(--border)"}`,
              background: activeTab === cat.id
                ? `${cat.color}18`
                : "var(--card-bg)",
              color: activeTab === cat.id ? cat.color : "var(--text-muted)",
              transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {cat.icon} {cat.label}
            {activeTab === cat.id && (
              <span style={{
                background: cat.color, color: "#fff", borderRadius: 10,
                fontSize: 10, fontWeight: 800, padding: "1px 7px", marginRight: 4,
              }}>
                {Object.values(config).filter(i => i.category === cat.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Config form */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">
            {activeCat?.icon} {activeCat?.label}
          </div>
          <button
            onClick={fetchConfig}
            disabled={loading}
            style={{
              background: "none", border: "1px solid var(--border)", borderRadius: 8,
              padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "var(--text-muted)",
            }}
          >
            {loading ? "⏳" : "🔄 רענן"}
          </button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
              ⏳ טוען הגדרות...
            </div>
          ) : tabItems.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "36px 20px",
              color: "var(--text-muted)", fontSize: 14, lineHeight: 2,
              border: "1px dashed var(--border)", borderRadius: 12,
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>⚙️</div>
              אין הגדרות בקטגוריה זו.<br />
              <span style={{ fontSize: 12 }}>הרץ מיגרציה 015 בדאשבורד Supabase כדי לאכלס את טבלת bot_config</span>
            </div>
          ) : (
            <>
              {activeTab === "knowledge" && arrivalHourItems.length > 0 && (
                <ArrivalHoursPanel items={arrivalHourItems} onChange={handleChange} />
              )}
              {(activeTab === "knowledge" ? knowledgeWithoutHours : tabItems).map(item => (
                <ConfigRow key={item.config_key} item={item} onChange={handleChange} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Save button */}
      {tabItems.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
          {saved && (
            <span style={{ fontSize: 13, color: "#1A7A4A", fontWeight: 600 }}>
              ✅ נשמר
            </span>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ minWidth: 160 }}
          >
            {saving ? "⏳ שומר..." : "💾 שמור שינויים"}
          </button>
        </div>
      )}

      {/* Help panel */}
      <div style={{
        marginTop: 24, padding: "16px 20px",
        background: "#F0FDF4", borderRadius: 14,
        border: "1px solid #BBF7D0", fontSize: 13, color: "#065F46",
        lineHeight: 1.8,
      }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>💡 איך זה עובד?</div>
        <div>• שינויים בטבלה <code>bot_config</code> נטענים ע"י הבוט בכל שיחה חדשה.</div>
        <div>• <strong>אישיות</strong> — שם הבוט + טון הדיבור (5 כוכבים, עברית תקנית).</div>
        <div>• <strong>ידע</strong> — שעות כניסה (חול/שבת), WiFi, מידע שהבוט צריך לדעת לענות עליו.</div>
        <div>• <strong>כללים</strong> — איך הבוט מגיב לתלונות, שדרוגים ומקרים מיוחדים.</div>
      </div>
    </div>
  );
}
