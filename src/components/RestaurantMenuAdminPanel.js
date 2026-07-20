// Manager — manual restaurant menu CMS (draft + publish). Phase 2A.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  fetchDraftRestaurantMenuVersion,
  MENU_KIND_LABELS,
  publishRestaurantDraft,
} from "../utils/restaurantMenu";
import RestaurantMenuImportPanel from "./RestaurantMenuImportPanel";

const GOLD = "#C9A96E";
const GOLD_DARK = "#A8843A";

export default function RestaurantMenuAdminPanel({ user, onToast }) {
  const [menuKind, setMenuKind] = useState("standard");
  const [version, setVersion] = useState(null);
  const [sections, setSections] = useState([]);
  const [kdsToken, setKdsToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { version: v, sections: secs, error } = await fetchDraftRestaurantMenuVersion(menuKind);
    if (error) onToast?.("err", error);
    setVersion(v);
    setSections(secs ?? []);
    if (secs?.[0]?.id) setSectionId(secs[0].id);

    const { data: kds } = await supabase
      .from("restaurant_kds_tokens")
      .select("token, label")
      .eq("is_active", true)
      .maybeSingle();
    setKdsToken(kds);
    setLoading(false);
  }, [menuKind, onToast]);

  useEffect(() => { load(); }, [load]);

  const addItem = async () => {
    const name = newName.trim();
    if (!name || !sectionId || !supabase) return;
    const price = newPrice.trim() ? Number(newPrice) : null;
    const { error } = await supabase.from("restaurant_menu_items").insert({
      section_id: sectionId,
      name,
      price: price != null && !Number.isNaN(price) ? price : null,
      sort_order: 100,
    });
    if (error) {
      onToast?.("err", error.message);
      return;
    }
    setNewName("");
    setNewPrice("");
    onToast?.("ok", "מנה נוספה לטיוטה");
    load();
  };

  const toggleAvailable = async (item) => {
    if (!supabase) return;
    const { error } = await supabase
      .from("restaurant_menu_items")
      .update({ is_available: !item.is_available })
      .eq("id", item.id);
    if (error) onToast?.("err", error.message);
    else load();
  };

  const publish = async () => {
    if (!version?.id) return;
    setPublishing(true);
    try {
      await publishRestaurantDraft(version.id, user?.id, menuKind);
      onToast?.("ok", `${MENU_KIND_LABELS[menuKind]} פורסם — המלצרים רואים אותו בטאב הזמנה`);
      load();
    } catch (e) {
      onToast?.("err", e?.message ?? "שגיאה בפרסום");
    } finally {
      setPublishing(false);
    }
  };

  const kdsUrl = kdsToken?.token
    ? `${window.location.origin}/kds/${kdsToken.token}`
    : null;

  const copyKds = () => {
    if (!kdsUrl) return;
    navigator.clipboard?.writeText(kdsUrl);
    onToast?.("ok", "קישור מסך מטבח הועתק");
  };

  if (loading) {
    return <div style={{ padding: 16, color: "var(--text-muted)" }}>טוען תפריט…</div>;
  }

  const allItems = sections.flatMap((s) => (s.items ?? []).map((i) => ({ ...i, sectionName: s.name })));

  return (
    <div style={{
      marginBottom: 16, padding: "14px 16px", borderRadius: 12,
      border: "1px solid var(--border)", background: "var(--ivory)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#9A7209" }}>📋 ניהול תפריט (מנהל משמרת)</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            התפריט כאן = מה שהמלצר רואה ב«בחרו מנות». עריכה ידנית לתפריט הרגיל, AI לתפריט ספיישל.
          </div>
        </div>
        <button
          type="button"
          onClick={publish}
          disabled={publishing || !version || allItems.length === 0}
          style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`,
            fontWeight: 800, cursor: publishing ? "not-allowed" : "pointer",
            fontFamily: "Heebo, sans-serif",
          }}
        >
          {publishing ? "מפרסם…" : `✓ פרסם ${MENU_KIND_LABELS[menuKind]}`}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {["standard", "special"].map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setMenuKind(kind)}
            style={{
              padding: "8px 14px", borderRadius: 20, fontWeight: 700, fontSize: 12,
              border: menuKind === kind ? `2px solid ${GOLD_DARK}` : "1px solid var(--border)",
              background: menuKind === kind ? "rgba(201,169,110,0.2)" : "#fff",
              cursor: "pointer", fontFamily: "Heebo, sans-serif",
            }}
          >
            {MENU_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      {kdsUrl && (
        <div style={{ marginBottom: 12, fontSize: 12 }}>
          <span style={{ color: "var(--text-muted)" }}>מסך מטבח: </span>
          <button type="button" onClick={copyKds} style={{
            border: "none", background: "transparent", color: "#4338CA",
            fontWeight: 700, cursor: "pointer", fontFamily: "Heebo, sans-serif",
          }}>
            העתק קישור KDS
          </button>
        </div>
      )}

      {menuKind === "special" && (
        <RestaurantMenuImportPanel onToast={onToast} onApplied={load} />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="שם מנה חדשה"
          style={{ flex: "1 1 140px", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
        <input
          type="number"
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
          placeholder="מחיר ₪"
          style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
        />
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)" }}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={addItem}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "none",
            background: "#1A7A4A", color: "#fff", fontWeight: 700, cursor: "pointer",
            fontFamily: "Heebo, sans-serif",
          }}
        >
          + הוסף
        </button>
      </div>

      {allItems.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {menuKind === "special"
            ? "אין מנות בטיוטה — צלמו/העלו תפריט ספיישל למעלה ולחצו «החל על טיוטה»."
            : "אין מנות בטיוטה — הוסיפו מנה למעלה."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {allItems.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", borderRadius: 8, background: "#fff",
                border: "1px solid var(--border)", opacity: item.is_available ? 1 : 0.5,
              }}
            >
              <div style={{ fontSize: 13 }}>
                <strong>{item.name}</strong>
                {item.price != null && <span style={{ color: "var(--text-muted)" }}> · ₪{item.price}</span>}
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 8 }}> ({item.sectionName})</span>
              </div>
              <button
                type="button"
                onClick={() => toggleAvailable(item)}
                title={item.is_available ? "הסתר מהתפריט" : "החזר לתפריט"}
                style={{
                  fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6,
                  border: "1px solid var(--border)", background: "#fff", cursor: "pointer",
                  fontFamily: "Heebo, sans-serif",
                }}
              >
                {item.is_available ? "זמין" : "לא זמין"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
