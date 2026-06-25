// src/components/PortalSettingsPanel.js
// "Portal Settings" — admin-only CMS editor for the Guest Portal's
// scrollytelling scenes (portal_scenes table, migration 084). Replaces the
// "ask Claude to edit a file" workflow from the Configurable Scrollytelling
// Engine session with direct DB editing — text and image filenames change
// live, no deploy needed. src/data/portalContent.js remains as PhotoTour.js's
// static fallback if this table is ever unreachable or empty; it is NOT
// edited by this panel.
import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const ACTION_TYPES = [
  { value: "REQUEST", label: "בקשה פנימית (REQUEST) — ללוח הבקשות, ללא קישור" },
  { value: "LINK",    label: "קישור חיצוני (LINK) — נפתח בלשונית חדשה" },
];

function emptyCta() {
  return { label: "", actionType: "REQUEST", upsellLabel: "" };
}

function CtaEditor({ ctas, onChange }) {
  const list = Array.isArray(ctas) ? ctas : [];

  function updateCta(i, patch) {
    onChange(list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeCta(i) {
    onChange(list.filter((_, idx) => idx !== i));
  }

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
              placeholder="טקסט הבקשה (יוצג ללוח הבקשות, לא לאורח)"
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
        <button
          onClick={() => onChange([...list, emptyCta()])}
          className="btn btn-ghost btn-sm"
        >+ הוסף כפתור</button>
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
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            קובץ תמונה (ב-public/images/)
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={scene.image}
              onChange={(e) => set({ image: e.target.value.trim() })}
              dir="ltr"
              placeholder="spa.jpg"
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", boxSizing: "border-box" }}
            />
            {/* Live thumbnail — a typo'd filename shows up as a broken image
                right here, instead of surfacing only as a blank gradient on
                the live portal (the exact bug class this session fixed). */}
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
        <button onClick={() => onDelete(scene.id)} className="btn btn-ghost btn-sm" style={{ color: "#C0392B" }}>
          🗑 מחק סצנה
        </button>
        <button onClick={() => onSave(scene)} disabled={saving} className="btn btn-sm" style={{ background: "var(--gold)", fontWeight: 700 }}>
          {saving ? "שומר…" : "💾 שמור"}
        </button>
      </div>
    </div>
  );
}

export default function PortalSettingsPanel() {
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (type, msg) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3000); };

  const fetchScenes = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    const { data, error } = await supabase.from("portal_scenes").select("*").order("sort_order");
    if (error) showToast("err", "שגיאה בטעינה: " + error.message);
    else setScenes(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchScenes(); }, [fetchScenes]);

  function updateLocal(id, patch) {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function saveScene(scene) {
    setSavingId(scene.id);
    const { error } = await supabase.from("portal_scenes").update({
      sort_order: scene.sort_order,
      image:      scene.image,
      title:      scene.title,
      body:       scene.body,
      ctas:       scene.ctas,
      is_active:  scene.is_active,
    }).eq("id", scene.id);
    setSavingId(null);
    if (error) showToast("err", "שגיאה בשמירה: " + error.message);
    else showToast("ok", "✅ נשמר — הפורטל הציבורי יציג את הגרסה הזו מהרענון הבא");
  }

  async function addScene() {
    const nextOrder = scenes.length > 0 ? Math.max(...scenes.map((s) => s.sort_order)) + 10 : 10;
    const { data, error } = await supabase
      .from("portal_scenes")
      .insert({ sort_order: nextOrder, image: "new-scene.jpg", title: "סצנה חדשה", body: "תיאור הסצנה...", ctas: [] })
      .select()
      .maybeSingle();
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
    <div style={{ direction: "rtl" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      <div style={{ marginBottom: 16, fontSize: 13, color: "var(--text-muted)" }}>
        עריכת הסצנות שיופיעו בפורטל האורח (גלילה אנכית). שינויים נשמרים ל-DB ומשפיעים על הפורטל הציבורי
        מהרענון הבא — אין צורך ב-deploy. תמונות נטענות מ-<code>public/images/</code> לפי שם הקובץ המדויק.
      </div>

      {!isSupabaseConfigured && (
        <div style={{ background: "#FFF5E8", border: "1px solid #F5A623", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#7A4A00" }}>
          Supabase לא מחובר — לא ניתן לטעון/לערוך סצנות.
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>טוען סצנות...</div>
      ) : (
        <>
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onChange={updateLocal}
              onSave={saveScene}
              onDelete={deleteScene}
              saving={savingId === scene.id}
            />
          ))}
          <button onClick={addScene} className="btn btn-sm" style={{ background: "var(--gold)", fontWeight: 700 }}>
            ➕ הוסף סצנה חדשה
          </button>
        </>
      )}
    </div>
  );
}
