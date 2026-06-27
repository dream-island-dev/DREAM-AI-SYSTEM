// src/components/PortalSettingsPanel.js
// Admin CMS for the Guest Portal — 3 tabs:
//   📸 סצנות     — portal_scenes (scrollytelling photo tour)
//   🏨 סוויטות   — upsell_items catalog for suite guests
//   ☀️ בילוי יומי — upsell_items catalog for day-pass guests (food/room-service excluded)
//
// All DB writes are live — no deploy needed.
// migration 084: portal_scenes (scenes tab)
// migration 093: upsell_items (catalog tabs)
// migration 095: upsell_items.link_url (workshop external-link field)

import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
      padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
      color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
      border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
    }}>{toast.msg}</div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return [toast, showToast];
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENES TAB — portal_scenes CRUD (existing logic, moved into a tab)
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_TYPES = [
  { value: "REQUEST",     label: "בקשה פנימית (REQUEST) — ללוח הבקשות, ללא קישור" },
  { value: "OPS_REQUEST", label: "משימה תפעולית (OPS_REQUEST) — ללוח התפעול + התראת מנהל" },
  { value: "LINK",        label: "קישור חיצוני (LINK) — נפתח בלשונית חדשה" },
];

function emptyCta() {
  return { label: "", actionType: "REQUEST", upsellLabel: "" };
}

function CtaEditor({ ctas, onChange }) {
  const list = Array.isArray(ctas) ? ctas : [];
  function updateCta(i, patch) { onChange(list.map((c, idx) => (idx === i ? { ...c, ...patch } : c))); }
  function removeCta(i) { onChange(list.filter((_, idx) => idx !== i)); }
  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
        כפתורים (0–2)
      </label>
      {list.map((cta, i) => (
        <div key={i} style={{
          display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
          padding: "8px 10px", marginBottom: 6, background: "var(--ivory)", borderRadius: 8,
        }}>
          <input
            value={cta.label ?? ""}
            onChange={(e) => updateCta(i, { label: e.target.value })}
            placeholder="טקסט הכפתור (כולל אימוג'י)"
            style={{ flex: "1 1 220px", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}
          />
          <select
            value={cta.actionType ?? "REQUEST"}
            onChange={(e) => updateCta(i, { actionType: e.target.value })}
            style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}
          >
            {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {cta.actionType === "LINK" ? (
            <input
              value={cta.buttonUrl ?? ""}
              onChange={(e) => updateCta(i, { buttonUrl: e.target.value })}
              placeholder="https://..."
              dir="ltr"
              style={{ flex: "1 1 220px", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}
            />
          ) : (
            <input
              value={cta.upsellLabel ?? ""}
              onChange={(e) => updateCta(i, { upsellLabel: e.target.value })}
              placeholder={cta.actionType === "OPS_REQUEST"
                ? "תיאור המשימה (יוצג ללוח התפעול, לא לאורח)"
                : "טקסט הבקשה (יוצג ללוח הבקשות, לא לאורח)"}
              style={{ flex: "1 1 220px", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}
            />
          )}
          <button
            onClick={() => removeCta(i)}
            title="הסר כפתור"
            style={{ border: "none", background: "transparent", color: "#C0392B", cursor: "pointer", fontSize: 16, padding: "2px 6px" }}
          >✕</button>
        </div>
      ))}
      {list.length < 2 && (
        <button onClick={() => onChange([...list, emptyCta()])} className="btn btn-ghost btn-sm">
          + הוסף כפתור
        </button>
      )}
    </div>
  );
}

function SceneCard({ scene, onChange, onSave, onDelete, saving }) {
  const set = (patch) => onChange(scene.id, patch);
  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ width: 70 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>סדר</label>
          <input
            type="number"
            value={scene.sort_order}
            onChange={(e) => set({ sort_order: Number(e.target.value) || 0 })}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
        </div>
        <div style={{ flex: "2 1 260px" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>כותרת</label>
          <input
            value={scene.title}
            onChange={(e) => set({ title: e.target.value })}
            style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>קובץ תמונה (ב-public/images/)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={scene.image}
              onChange={(e) => set({ image: e.target.value.trim() })}
              dir="ltr"
              placeholder="spa.jpg"
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box" }}
            />
            <img
              src={`/images/${scene.image}`}
              alt=""
              style={{ width: 44, height: 30, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", flexShrink: 0 }}
              onError={(e) => { e.target.style.opacity = 0.15; }}
              onLoad={(e) => { e.target.style.opacity = 1; }}
            />
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 18 }}>
          <input type="checkbox" checked={!!scene.is_active} onChange={(e) => set({ is_active: e.target.checked })} style={{ accentColor: "var(--gold)" }} />
          פעיל
        </label>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>טקסט</label>
        <textarea
          value={scene.body}
          onChange={(e) => set({ body: e.target.value })}
          rows={2}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
        />
      </div>
      <CtaEditor ctas={scene.ctas} onChange={(ctas) => set({ ctas })} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button onClick={() => onDelete(scene.id)} className="btn btn-ghost btn-sm" style={{ color: "#C0392B" }}>🗑 מחק סצנה</button>
        <button onClick={() => onSave(scene)} disabled={saving} className="btn btn-sm" style={{ background: "var(--gold)", fontWeight: 700 }}>
          {saving ? "שומר…" : "💾 שמור"}
        </button>
      </div>
    </div>
  );
}

function ScenesTab({ showToast }) {
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const fetchScenes = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase.from("portal_scenes").select("*").order("sort_order");
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setScenes(data ?? []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { fetchScenes(); }, [fetchScenes]);

  function updateLocal(id, patch) {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function saveScene(scene) {
    setSavingId(scene.id);
    const { error } = await supabase.from("portal_scenes").update({
      sort_order: scene.sort_order, image: scene.image, title: scene.title,
      body: scene.body, ctas: scene.ctas, is_active: scene.is_active,
    }).eq("id", scene.id);
    setSavingId(null);
    if (error) showToast("err", "שגיאה בשמירה: " + error.message);
    else showToast("ok", "✅ נשמר — הפורטל הציבורי יציג את הגרסה הזו מהרענון הבא");
  }

  async function addScene() {
    const nextOrder = scenes.length > 0 ? Math.max(...scenes.map((s) => s.sort_order)) + 10 : 10;
    const { data, error } = await supabase.from("portal_scenes")
      .insert({ sort_order: nextOrder, image: "new-scene.jpg", title: "סצנה חדשה", body: "תיאור הסצנה...", ctas: [] })
      .select().maybeSingle();
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setScenes((prev) => [...prev, data]);
  }

  async function deleteScene(id) {
    if (!window.confirm("למחוק את הסצנה הזו לצמיתות? האורחים לא יראו אותה יותר בפורטל.")) return;
    const { error } = await supabase.from("portal_scenes").delete().eq("id", id);
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setScenes((prev) => prev.filter((s) => s.id !== id));
    showToast("ok", "הסצנה נמחקה");
  }

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
        עריכת הסצנות שיופיעו בפורטל האורח (גלילה אנכית). שינויים נשמרים ל-DB ומשפיעים על הפורטל הציבורי
        מהרענון הבא — אין צורך ב-deploy. תמונות נטענות מ-<code>public/images/</code> לפי שם הקובץ המדויק.
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען סצנות...</div>
      ) : (
        <>
          {scenes.map((scene) => (
            <SceneCard key={scene.id} scene={scene} onChange={updateLocal} onSave={saveScene} onDelete={deleteScene} saving={savingId === scene.id} />
          ))}
          <button onClick={addScene} className="btn btn-sm" style={{ background: "var(--gold)", fontWeight: 700 }}>
            ➕ הוסף סצנה חדשה
          </button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSELL CATALOG TAB — upsell_items CRUD (unified, all audiences)
// ─────────────────────────────────────────────────────────────────────────────
const ALL_CATEGORIES = [
  { value: "spa",      label: "ספא וטיפולים",  icon: "💆" },
  { value: "food",     label: "אוכל ושתייה",    icon: "🍽️" },
  { value: "amenity",  label: "פינוקים",         icon: "🛁" },
  { value: "activity", label: "פעילויות",        icon: "🎾" },
  { value: "workshop", label: "סדנאות",          icon: "📚" },
  { value: "general",  label: "כללי",            icon: "✨" },
];

// visibility_settings vocabulary matches guests.room_type (migration 097)
const VISIBILITY_OPTIONS = [
  { value: "suite",             label: "🏨 סוויטות" },
  { value: "day_guest",         label: "☀️ בילוי יומי" },
  { value: "premium_day_guest", label: "⭐ פרימיום" },
];
const ALL_ROOM_TYPES = VISIBILITY_OPTIONS.map((o) => o.value);

function ItemCard({ item, onChange, onSave, onDelete, saving }) {
  const set = (patch) => onChange(item.id, patch);
  const showLinkUrl = item.category === "workshop";

  // Normalize visibility_settings — old rows may have null/undefined before
  // migration 097 is applied (or if loaded before the DB push).
  const currentVisibility = Array.isArray(item.visibility_settings) && item.visibility_settings.length > 0
    ? item.visibility_settings
    : ALL_ROOM_TYPES;

  function toggleVisibility(value) {
    const isChecked = currentVisibility.includes(value);
    const next = isChecked
      ? currentVisibility.filter((v) => v !== value)
      : [...currentVisibility, value];
    // Guard: at least one must remain checked
    if (next.length === 0) return;
    set({ visibility_settings: next });
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      {/* Row 1 — name + sort + active */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 220px" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>שם הפריט</label>
          <input
            value={item.name ?? ""}
            onChange={(e) => set({ name: e.target.value })}
            style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ width: 90 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>מחיר (₪)</label>
          <input
            type="number"
            min="0"
            value={item.price ?? ""}
            onChange={(e) => set({ price: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="ללא"
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
        </div>
        <div style={{ width: 70 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>סדר</label>
          <input
            type="number"
            value={item.sort_order ?? 100}
            onChange={(e) => set({ sort_order: Number(e.target.value) || 100 })}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 18, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={!!item.is_active} onChange={(e) => set({ is_active: e.target.checked })} style={{ accentColor: "var(--gold)" }} />
          פעיל
        </label>
      </div>

      {/* Row 2 — description */}
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>תיאור (אופציונלי)</label>
        <textarea
          value={item.description ?? ""}
          onChange={(e) => set({ description: e.target.value })}
          rows={2}
          placeholder="תיאור קצר שיוצג לאורח"
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
        />
      </div>

      {/* Row 3 — category + visibility */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 180px" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>קטגוריה</label>
          <select
            value={item.category ?? "general"}
            onChange={(e) => set({ category: e.target.value, link_url: e.target.value !== "workshop" ? null : item.link_url })}
            style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}
          >
            {ALL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "2 1 260px" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
            נראות — מי רואה את הפריט הזה
          </label>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {VISIBILITY_OPTIONS.map(({ value, label }) => {
              const checked = currentVisibility.includes(value);
              return (
                <label key={value} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    style={{ accentColor: "var(--gold)", width: 15, height: 15 }}
                    onChange={() => toggleVisibility(value)}
                  />
                  {label}
                </label>
              );
            })}
          </div>
          {currentVisibility.length === ALL_ROOM_TYPES.length && (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>👥 כל סוגי האורחים</div>
          )}
        </div>
      </div>

      {/* Row 4 — link_url (workshops only) */}
      {showLinkUrl && (
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            🔗 קישור חיצוני לסדנאות — במקום סל קנייה, האורח ילחץ על כפתור "לפרטים ולהזמנה"
          </label>
          <input
            value={item.link_url ?? ""}
            onChange={(e) => set({ link_url: e.target.value.trim() || null })}
            placeholder="https://..."
            dir="ltr"
            style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box", fontSize: 13 }}
          />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button onClick={() => onDelete(item.id)} className="btn btn-ghost btn-sm" style={{ color: "#C0392B" }}>
          🗑 מחק
        </button>
        <button onClick={() => onSave(item)} disabled={saving} className="btn btn-sm" style={{ background: "var(--gold)", fontWeight: 700 }}>
          {saving ? "שומר…" : "💾 שמור"}
        </button>
      </div>
    </div>
  );
}

function UpsellCatalogTab({ showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("upsell_items")
      .select("*")
      .order("sort_order");
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setItems(data ?? []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function updateLocal(id, patch) {
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function saveItem(item) {
    setSavingId(item.id);
    const visSettings = Array.isArray(item.visibility_settings) && item.visibility_settings.length > 0
      ? item.visibility_settings
      : ALL_ROOM_TYPES;
    const { error } = await supabase.from("upsell_items").update({
      name:                item.name,
      description:         item.description,
      price:               item.price,
      category:            item.category,
      visibility_settings: visSettings,
      sort_order:          item.sort_order,
      is_active:           item.is_active,
      link_url:            item.category === "workshop" ? (item.link_url ?? null) : null,
    }).eq("id", item.id);
    setSavingId(null);
    if (error) showToast("err", "שגיאה בשמירה: " + error.message);
    else showToast("ok", "✅ נשמר — הפורטל הציבורי יציג את הגרסה מהרענון הבא");
  }

  async function addItem() {
    const nextOrder = items.length > 0 ? Math.max(...items.map((i) => i.sort_order ?? 0)) + 10 : 10;
    const { data, error } = await supabase
      .from("upsell_items")
      .insert({
        name:                "שירות חדש",
        description:         "",
        price:               null,
        category:            "general",
        visibility_settings: ALL_ROOM_TYPES,
        sort_order:          nextOrder,
        is_active:           false,
        link_url:            null,
      })
      .select()
      .maybeSingle();
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setItems((prev) => [...prev, data]);
    showToast("ok", "פריט חדש נוצר — ערוך את הפרטים ושמור");
  }

  async function deleteItem(id) {
    if (!window.confirm("למחוק את הפריט לצמיתות? האורחים לא יראו אותו יותר.")) return;
    const { error } = await supabase.from("upsell_items").delete().eq("id", id);
    if (error) { showToast("err", "שגיאה: " + error.message); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
    showToast("ok", "הפריט נמחק");
  }

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
        כל שירותי הפורטל בתצוגה אחת. השתמש בתיבות הסימון "נראות" לשליטה מדויקת על אילו סוגי אורחים רואים כל פריט —
        סוויטות, בילוי יומי, פרימיום, או כל השלושה. שינויים נשמרים ל-DB ומשפיעים על הפורטל מהרענון הבא.
      </div>

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון/לערוך פריטים.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען פריטים...</div>
      ) : (
        <>
          {items.length === 0 && (
            <div style={{ padding: "24px 0", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
              אין פריטים — לחץ על "הוסף שירות חדש" כדי להוסיף ראשון
            </div>
          )}
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onChange={updateLocal}
              onSave={saveItem}
              onDelete={deleteItem}
              saving={savingId === item.id}
            />
          ))}
          <button onClick={addItem} className="btn btn-sm" style={{ background: "var(--gold)", fontWeight: 700 }}>
            ➕ הוסף שירות חדש
          </button>
        </>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Main export — 2-tab shell
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "scenes",  label: "📸 סצנות הפורטל" },
  { id: "catalog", label: "📦 קטלוג שירותים" },
];

export default function PortalSettingsPanel() {
  const [activeTab, setActiveTab] = useState("scenes");
  const [toast, showToast] = useToast();

  return (
    <div style={{ direction: "rtl" }}>
      <Toast toast={toast} />

      {/* Tab nav */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap",
        borderBottom: "2px solid var(--border)", paddingBottom: 12,
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="btn btn-sm"
            style={{
              background:  activeTab === tab.id ? "var(--gold)" : "transparent",
              color:       activeTab === tab.id ? "var(--black)" : "var(--text-muted)",
              border:      activeTab === tab.id ? "none" : "1px solid var(--border)",
              fontWeight:  activeTab === tab.id ? 700 : 400,
              borderRadius: 20,
              padding:     "6px 16px",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "scenes"  && <ScenesTab showToast={showToast} />}
      {activeTab === "catalog" && <UpsellCatalogTab showToast={showToast} />}
    </div>
  );
}
