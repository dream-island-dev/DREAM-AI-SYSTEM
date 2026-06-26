// src/components/InventoryPortal.js
// Inventory Smart-Intake Module — public, password-less daily-fill screen for
// an employee's phone. Mounted directly from index.js for any /inv/:token
// URL — BEFORE <App/> — same reasoning as GuestPortal.js: the staff-auth hook
// chain never runs for this unauthenticated route.
//
// COLOR NOTE: App.js injects the --gold/--ivory/etc CSS variables itself at
// runtime (CLAUDE.md §2 — CSS-in-JS in App.js); since this component renders
// INSTEAD of <App/> on this route, those variables are never defined here.
// Same constraint GuestPortal.js hit — unlike that component (which uses a
// deliberately distinct "XOS" guest palette), this is a STAFF tool, so it
// hardcodes the SAME hex values as the staff app's --gold palette instead of
// inventing a new one.
//
// Submitting here never updates inventory_items directly — it only creates a
// pending inventory_submissions row; a manager must approve it
// (InventoryApprovalQueue.js) before anything counts as "live".

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const GOLD      = "#C9A96E";
const GOLD_DARK = "#A8843A";
const BLACK     = "#1A1A1A";
const IVORY     = "#F5F0E8";
const BORDER    = "#E0D5C5";

export default function InventoryPortal({ token }) {
  const [locationName, setLocationName] = useState("");
  const [items, setItems] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase || !token) {
        setLoadError("הקישור אינו תקין.");
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("inventory-portal-data", { body: { token } });
        if (!active) return;
        if (error || !data?.ok) {
          setLoadError(data?.error === "link_not_found" ? "הקישור אינו תקין, או שהוחלף בקישור חדש — פנו למנהל." : "שגיאה בטעינת המלאי.");
        } else {
          setLocationName(data.location_name);
          setItems(data.items ?? []);
          const initial = {};
          for (const it of data.items ?? []) initial[it.id] = 0;
          setQuantities(initial);
        }
      } catch (e) {
        if (active) setLoadError(e?.message ?? "שגיאה בטעינה.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const adjust = (itemId, delta) => {
    setQuantities((prev) => ({ ...prev, [itemId]: Math.max(0, (prev[itemId] ?? 0) + delta) }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const counts = items.map((it) => ({ itemId: it.id, quantity: quantities[it.id] ?? 0 }));
      const { data, error } = await supabase.functions.invoke("inventory-portal-submit", { body: { token, counts } });
      if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? "שגיאה לא ידועה");
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e?.message ?? "השליחה נכשלה — נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date().toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });

  const screenStyle = {
    minHeight: "100vh", background: IVORY, fontFamily: "Heebo, system-ui, sans-serif",
    direction: "rtl", padding: 16, boxSizing: "border-box",
  };

  if (loading) {
    return <div style={{ ...screenStyle, display: "flex", alignItems: "center", justifyContent: "center", color: GOLD_DARK }}>טוען...</div>;
  }

  if (loadError) {
    return (
      <div style={{ ...screenStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 14, padding: 24, maxWidth: 340, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
          <div style={{ color: BLACK, fontSize: 14 }}>{loadError}</div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ ...screenStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 14, padding: 28, maxWidth: 340, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ color: BLACK, fontSize: 15, fontWeight: 700, marginBottom: 6 }}>נשלח לאישור המנהל</div>
          <div style={{ color: "#6B6A64", fontSize: 13 }}>{locationName} · {today}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={screenStyle}>
      <div style={{ background: BLACK, borderRadius: 14, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ color: "#E8C98A", fontSize: 16, fontWeight: 800 }}>מלאי יומי</div>
        <div style={{ color: IVORY, fontSize: 12, marginTop: 2 }}>{locationName} · {today}</div>
      </div>

      {items.length === 0 ? (
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, textAlign: "center", color: "#6B6A64", fontSize: 13 }}>
          אין פריטים מוגדרים למחסן הזה עדיין — פנו למנהל.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {items.map((it) => (
              <div key={it.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: BLACK }}>{it.item_name}</div>
                  {it.unit && <div style={{ fontSize: 11, color: "#6B6A64" }}>{it.unit}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => adjust(it.id, -1)}
                    style={{ width: 38, height: 38, borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fff", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}
                  >−</button>
                  <span style={{ minWidth: 30, textAlign: "center", fontWeight: 800, fontSize: 16, color: BLACK }}>{quantities[it.id] ?? 0}</span>
                  <button
                    onClick={() => adjust(it.id, 1)}
                    style={{ width: 38, height: 38, borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fff", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}
                  >+</button>
                </div>
              </div>
            ))}
          </div>

          {submitError && (
            <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", color: "#C0392B", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
              ⚠️ {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: "100%", border: "none", borderRadius: 12, padding: 16, fontSize: 15, fontWeight: 800,
              background: submitting ? BORDER : GOLD, color: BLACK, cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {submitting ? "שולח..." : "📤 שלח לאישור"}
          </button>
        </>
      )}
    </div>
  );
}
