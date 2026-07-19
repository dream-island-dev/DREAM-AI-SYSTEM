// Waiter tablet — take order and send to kitchen. Phase 2B.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { fetchPublishedRestaurantMenu } from "../utils/restaurantMenu";
import { formatGuestDietaryBrief, normalizeGuestProfile } from "../data/guestProfileSchema";
import RestaurantMenuQrModal from "./restaurant/RestaurantMenuQrModal";
import { ARMONIM_EXTERNAL_MENU_URL } from "../utils/restaurantKioskUi";

const GOLD_DARK = "#A8843A";

function QtyButton({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 44, height: 44, borderRadius: 10, border: "2px solid var(--border)",
        background: "#fff", fontSize: 20, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "Heebo, sans-serif",
      }}
    >
      {label}
    </button>
  );
}

export default function RestaurantOrderPanel({
  guests,
  onToast,
  mealPeriod = "dinner",
  shiftSession = null,
  onOrderSent,
  externalMenuUrl = ARMONIM_EXTERNAL_MENU_URL,
}) {
  const [menu, setMenu] = useState(null);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [tableOnly, setTableOnly] = useState("");
  const [cart, setCart] = useState({});
  const [kitchenNotes, setKitchenNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [doneOrder, setDoneOrder] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [menuQrOpen, setMenuQrOpen] = useState(false);

  const loadMenu = useCallback(async () => {
    setLoadingMenu(true);
    const { menu: m, error } = await fetchPublishedRestaurantMenu();
    if (error) onToast?.("err", error);
    setMenu(m);
    if (m?.sections?.[0]) setActiveSection(m.sections[0].id);
    setLoadingMenu(false);
  }, [onToast]);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  const filteredGuests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guests.slice(0, 12);
    return guests.filter((g) => {
      const hay = `${g.name ?? ""} ${g.room ?? ""}`.toLowerCase();
      return hay.includes(q);
    }).slice(0, 12);
  }, [guests, search]);

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .filter(([, v]) => v.qty > 0)
      .map(([itemId, v]) => ({ itemId, ...v }));
  }, [cart]);

  const totalItems = cartLines.reduce((s, l) => s + l.qty, 0);

  const setQty = (item, delta) => {
    setCart((prev) => {
      const cur = prev[item.id]?.qty ?? 0;
      const next = Math.max(0, Math.min(20, cur + delta));
      if (next === 0) {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [item.id]: {
          qty: next,
          name: item.name,
          item_id: item.id,
        },
      };
    });
  };

  const canSubmit = totalItems > 0 && (selectedGuest || tableOnly.trim()) && !submitting;

  const submit = async () => {
    if (!canSubmit || !supabase) return;
    setSubmitting(true);
    try {
      const lines = cartLines.map((l) => ({
        item_id: l.item_id,
        quantity: l.qty,
      }));
      const { data, error } = await supabase.functions.invoke("restaurant-order-submit", {
        body: {
          guest_id: selectedGuest?.id ?? null,
          table_label: selectedGuest ? null : tableOnly.trim(),
          meal_period: mealPeriod,
          kitchen_notes: kitchenNotes.trim() || null,
          waiter_name_snap: shiftSession?.displayName ?? null,
          shift_session_id: shiftSession?.sessionId ?? null,
          lines,
        },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error ?? error?.message ?? "שגיאה בשליחה");
      }
      onOrderSent?.();
      setDoneOrder(data.order);
      setCart({});
      setKitchenNotes("");
      onToast?.("ok", `הזמנה #${data.order.display_number} נשלחה למטבח`);
    } catch (e) {
      onToast?.("err", e?.message ?? "שגיאה");
    } finally {
      setSubmitting(false);
    }
  };

  if (doneOrder) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
          הזמנה #{doneOrder.display_number} נשלחה למטבח
        </div>
        <button
          type="button"
          onClick={() => { setDoneOrder(null); setSelectedGuest(null); setTableOnly(""); }}
          style={{
            marginTop: 16, padding: "12px 24px", borderRadius: 10, border: "none",
            background: "#1A7A4A", color: "#fff", fontWeight: 800, fontSize: 15,
            cursor: "pointer", fontFamily: "Heebo, sans-serif",
          }}
        >
          הזמנה חדשה
        </button>
      </div>
    );
  }

  if (loadingMenu) {
    return <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>טוען תפריט…</div>;
  }

  if (!menu) {
    return (
      <div style={{
        padding: 24, textAlign: "center", border: "1px dashed var(--border)",
        borderRadius: 12, color: "var(--text-muted)",
      }}>
        אין תפריט שפורסם. מנהל צריך להוסיף מנות וללחוץ «פרסם תפריט».
      </div>
    );
  }

  const activeSec = menu.sections.find((s) => s.id === activeSection) ?? menu.sections[0];
  const dietary = selectedGuest ? formatGuestDietaryBrief(selectedGuest.guest_profile) : null;
  const vip = selectedGuest && normalizeGuestProfile(selectedGuest.guest_profile).vip_status === "vip";

  return (
    <div>
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14,
        padding: "12px 14px", borderRadius: 12,
        background: "rgba(0, 128, 128, 0.08)", border: "1px solid rgba(0, 128, 128, 0.22)",
      }}>
        <button
          type="button"
          onClick={() => setMenuQrOpen(true)}
          style={{
            flex: "1 1 200px", minHeight: 52, padding: "12px 16px", borderRadius: 12,
            border: "none", background: "linear-gradient(135deg, #008080, #006666)",
            color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer",
            fontFamily: "Heebo, sans-serif",
          }}
        >
          📱 תפריט לאורח — הצג QR לסריקה
        </button>
        <a
          href={externalMenuUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: "0 1 auto", alignSelf: "center", fontSize: 12, fontWeight: 700,
            color: "#008080", textDecoration: "underline", padding: "8px 4px",
          }}
        >
          תפריט באתר ↗
        </a>
      </div>

      {menuQrOpen && (
        <RestaurantMenuQrModal
          menuUrl={externalMenuUrl}
          onClose={() => setMenuQrOpen(false)}
        />
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>1. למי ההזמנה?</div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חפשו שם או חדר…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "10px 12px",
            borderRadius: 8, border: "1px solid var(--border)", marginBottom: 8,
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {filteredGuests.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => { setSelectedGuest(g); setTableOnly(""); }}
              style={{
                padding: "8px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                border: selectedGuest?.id === g.id ? `2px solid ${GOLD_DARK}` : "1px solid var(--border)",
                background: selectedGuest?.id === g.id ? "rgba(201,169,110,0.2)" : "#fff",
                cursor: "pointer", fontFamily: "Heebo, sans-serif",
              }}
            >
              {g.name}{g.room ? ` · ${g.room}` : ""}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={tableOnly}
          onChange={(e) => { setTableOnly(e.target.value); setSelectedGuest(null); }}
          placeholder="או: שולחן / אורח ללא רשימה (למשל שולחן 12)"
          style={{
            width: "100%", boxSizing: "border-box", padding: "9px 10px",
            borderRadius: 8, border: "1px solid var(--border)",
          }}
        />
        {selectedGuest && (dietary || vip) && (
          <div style={{
            marginTop: 8, padding: "8px 10px", borderRadius: 8,
            background: "rgba(180,83,9,0.1)", fontSize: 12, color: "#9A7209",
          }}>
            {vip && "⭐ VIP "}{dietary && `🥗 ${dietary}`}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>2. בחרו מנות</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {menu.sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              style={{
                padding: "8px 14px", borderRadius: 20, fontWeight: 700, fontSize: 12,
                border: activeSec?.id === s.id ? `2px solid ${GOLD_DARK}` : "1px solid var(--border)",
                background: activeSec?.id === s.id ? "rgba(201,169,110,0.18)" : "#fff",
                cursor: "pointer", fontFamily: "Heebo, sans-serif",
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(activeSec?.items ?? []).map((item) => {
            const qty = cart[item.id]?.qty ?? 0;
            return (
              <div
                key={item.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  borderRadius: 10, border: "1px solid var(--border)", background: "#fff",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                  {item.price != null && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>₪{item.price}</div>
                  )}
                </div>
                <QtyButton label="−" onClick={() => setQty(item, -1)} disabled={qty <= 0} />
                <span style={{ fontWeight: 800, minWidth: 24, textAlign: "center" }}>{qty}</span>
                <QtyButton label="+" onClick={() => setQty(item, 1)} disabled={qty >= 20} />
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>3. הערה למטבח (אופציונלי)</div>
        <input
          type="text"
          value={kitchenNotes}
          onChange={(e) => setKitchenNotes(e.target.value)}
          placeholder="למשל: בלי בצל"
          style={{
            width: "100%", boxSizing: "border-box", padding: "9px 10px",
            borderRadius: 8, border: "1px solid var(--border)",
          }}
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        style={{
          width: "100%", padding: "16px 20px", borderRadius: 12, border: "none",
          background: canSubmit ? "#1A7A4A" : "var(--border)",
          color: canSubmit ? "#fff" : "#888",
          fontWeight: 800, fontSize: 16, cursor: canSubmit ? "pointer" : "not-allowed",
          fontFamily: "Heebo, sans-serif",
        }}
      >
        {submitting ? "שולח למטבח…" : `✅ שלח למטבח${totalItems ? ` (${totalItems} מנות)` : ""}`}
      </button>
    </div>
  );
}
