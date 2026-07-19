// Waiter tablet — take order and send to kitchen. Phase 2B.

import "../styles/restaurantOrder.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  fetchPublishedMenuKinds,
  fetchPublishedRestaurantMenu,
  MENU_KIND_LABELS,
} from "../utils/restaurantMenu";
import { formatGuestDietaryBrief, normalizeGuestProfile } from "../data/guestProfileSchema";
import RestaurantMenuQrModal from "./restaurant/RestaurantMenuQrModal";
import { ARMONIM_EXTERNAL_MENU_URL } from "../utils/restaurantKioskUi";

function QtyButton({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="armonim-order-qty-btn"
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
  const [menuKind, setMenuKind] = useState("standard");
  const [availableKinds, setAvailableKinds] = useState([]);
  const [menu, setMenu] = useState(null);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [search, setSearch] = useState("");
  const [dishSearch, setDishSearch] = useState("");
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [tableOnly, setTableOnly] = useState("");
  const [cart, setCart] = useState({});
  const [kitchenNotes, setKitchenNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [doneOrder, setDoneOrder] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [menuQrOpen, setMenuQrOpen] = useState(false);

  const loadKinds = useCallback(async () => {
    const { kinds, error } = await fetchPublishedMenuKinds();
    if (error) onToast?.("err", error);
    setAvailableKinds(kinds);
    if (kinds.length && !kinds.includes(menuKind)) {
      setMenuKind(kinds.includes("standard") ? "standard" : kinds[0]);
    }
    return kinds;
  }, [menuKind, onToast]);

  const loadMenu = useCallback(async (kind = menuKind) => {
    setLoadingMenu(true);
    const { menu: m, error } = await fetchPublishedRestaurantMenu(kind);
    if (error) onToast?.("err", error);
    setMenu(m);
    if (m?.sections?.[0]) setActiveSection(m.sections[0].id);
    setLoadingMenu(false);
  }, [menuKind, onToast]);

  useEffect(() => {
    loadKinds().then((kinds) => {
      const kind = kinds?.includes(menuKind) ? menuKind : (kinds?.[0] ?? "standard");
      loadMenu(kind);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (availableKinds.includes(menuKind)) loadMenu(menuKind);
  }, [menuKind, availableKinds, loadMenu]);

  const switchMenuKind = (kind) => {
    if (kind === menuKind) return;
    setMenuKind(kind);
    setCart({});
    setDishSearch("");
  };

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

  const dishQuery = dishSearch.trim().toLowerCase();

  const visibleSections = useMemo(() => {
    if (!menu?.sections) return [];
    if (!dishQuery) return menu.sections;
    return menu.sections
      .map((s) => ({
        ...s,
        items: (s.items ?? []).filter((item) => {
          const hay = `${item.name ?? ""} ${item.description ?? ""}`.toLowerCase();
          return hay.includes(dishQuery);
        }),
      }))
      .filter((s) => s.items.length > 0);
  }, [menu, dishQuery]);

  const activeSec = useMemo(() => {
    if (dishQuery) return visibleSections[0] ?? null;
    return visibleSections.find((s) => s.id === activeSection) ?? visibleSections[0] ?? null;
  }, [visibleSections, activeSection, dishQuery]);

  const itemsToShow = dishQuery
    ? visibleSections.flatMap((s) => s.items.map((item) => ({ ...item, sectionName: s.name })))
    : (activeSec?.items ?? []).map((item) => ({ ...item, sectionName: activeSec.name }));

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
      <div className="armonim-order-done">
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
          הזמנה #{doneOrder.display_number} נשלחה למטבח
        </div>
        <button
          type="button"
          onClick={() => { setDoneOrder(null); setSelectedGuest(null); setTableOnly(""); }}
          className="armonim-order-submit-btn"
        >
          הזמנה חדשה
        </button>
      </div>
    );
  }

  if (loadingMenu) {
    return <div className="armonim-order-loading">טוען תפריט…</div>;
  }

  if (!menu || !availableKinds.length) {
    return (
      <div className="armonim-order-empty">
        <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>אין תפריט פעיל למלצרים</div>
        <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 12px", color: "var(--text-muted)" }}>
          מנהל משמרת: לחצו «סנכרן מאתר ופרסם» בניהול תפריט למעלה — או ייבאו תפריט ספיישל מתמונה/PDF.
        </p>
        <a
          href={externalMenuUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontWeight: 700, color: "#008080" }}
        >
          תפריט לאורחים באתר ↗
        </a>
      </div>
    );
  }

  const dietary = selectedGuest ? formatGuestDietaryBrief(selectedGuest.guest_profile) : null;
  const vip = selectedGuest && normalizeGuestProfile(selectedGuest.guest_profile).vip_status === "vip";
  const hasTableOrGuest = Boolean(selectedGuest || tableOnly.trim());

  return (
    <div className="armonim-order-panel">
      <div className="armonim-order-guest-bar">
        <button type="button" onClick={() => setMenuQrOpen(true)} className="armonim-order-qr-btn">
          📱 תפריט לאורח — QR
        </button>
        {availableKinds.length > 1 && (
          <div className="armonim-order-kind-tabs">
            {availableKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => switchMenuKind(kind)}
                className={`armonim-order-kind-tab${menuKind === kind ? " is-active" : ""}`}
              >
                {MENU_KIND_LABELS[kind] ?? kind}
              </button>
            ))}
          </div>
        )}
        {menu.label && (
          <div className="armonim-order-menu-label">{menu.label}</div>
        )}
      </div>

      {menuQrOpen && (
        <RestaurantMenuQrModal
          menuUrl={externalMenuUrl}
          onClose={() => setMenuQrOpen(false)}
        />
      )}

      <section className="armonim-order-step">
        <div className="armonim-order-step-title">1. למי ההזמנה?</div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חפשו שם או חדר (סוויטה)…"
          className="armonim-order-input"
        />
        <div className="armonim-order-guest-chips">
          {filteredGuests.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => { setSelectedGuest(g); setTableOnly(""); }}
              className={`armonim-order-chip${selectedGuest?.id === g.id ? " is-selected" : ""}`}
            >
              {g.name}{g.room ? ` · ${g.room}` : ""}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={tableOnly}
          onChange={(e) => { setTableOnly(e.target.value); setSelectedGuest(null); }}
          placeholder="או: שולחן / אורח כללי (למשל שולחן 12)"
          className="armonim-order-input"
        />
        {selectedGuest && (dietary || vip) && (
          <div className="armonim-order-dietary">
            {vip && "⭐ VIP "}{dietary && `🥗 ${dietary}`}
          </div>
        )}
      </section>

      <section className="armonim-order-step">
        <div className="armonim-order-step-title">2. בחרו מנות מהתפריט</div>
        <input
          type="search"
          value={dishSearch}
          onChange={(e) => setDishSearch(e.target.value)}
          placeholder="חיפוש מנה…"
          className="armonim-order-input armonim-order-dish-search"
        />
        {!dishQuery && (
          <div className="armonim-order-section-tabs">
            {visibleSections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={`armonim-order-section-tab${activeSec?.id === s.id ? " is-active" : ""}`}
              >
                {s.name}
                <span className="armonim-order-section-count">{s.items?.length ?? 0}</span>
              </button>
            ))}
          </div>
        )}
        {dishQuery && (
          <div className="armonim-order-search-hint">
            {itemsToShow.length} תוצאות ל«{dishSearch.trim()}»
          </div>
        )}
        <div className="armonim-order-items">
          {itemsToShow.length === 0 ? (
            <div className="armonim-order-no-items">לא נמצאו מנות</div>
          ) : (
            itemsToShow.map((item) => {
              const qty = cart[item.id]?.qty ?? 0;
              return (
                <div
                  key={item.id}
                  className={`armonim-order-item${qty > 0 ? " has-qty" : ""}`}
                >
                  <div className="armonim-order-item-body">
                    <div className="armonim-order-item-name">{item.name}</div>
                    {dishQuery && item.sectionName && (
                      <div className="armonim-order-item-section">{item.sectionName}</div>
                    )}
                    {item.description && (
                      <div className="armonim-order-item-desc">{item.description}</div>
                    )}
                    {item.price != null && (
                      <div className="armonim-order-item-price">₪{item.price}</div>
                    )}
                  </div>
                  <div className="armonim-order-item-qty">
                    <QtyButton label="−" onClick={() => setQty(item, -1)} disabled={qty <= 0} />
                    <span className="armonim-order-qty-num">{qty}</span>
                    <QtyButton label="+" onClick={() => setQty(item, 1)} disabled={qty >= 20} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="armonim-order-step">
        <div className="armonim-order-step-title">3. הערה למטבח (אופציונלי)</div>
        <input
          type="text"
          value={kitchenNotes}
          onChange={(e) => setKitchenNotes(e.target.value)}
          placeholder="למשל: בלי בצל"
          className="armonim-order-input"
        />
      </section>

      {totalItems > 0 && (
        <div className="armonim-order-cart-strip">
          <div className="armonim-order-cart-summary">
            <strong>{totalItems}</strong> מנות בסל
            {!hasTableOrGuest && (
              <span className="armonim-order-cart-warn"> — בחרו אורח או שולחן</span>
            )}
          </div>
          <div className="armonim-order-cart-names">
            {cartLines.map((l) => (
              <span key={l.itemId} className="armonim-order-cart-pill">
                {l.name} ×{l.qty}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className={`armonim-order-submit-btn${canSubmit ? "" : " is-disabled"}`}
      >
        {submitting ? "שולח למטבח…" : `✅ שלח למטבח${totalItems ? ` (${totalItems} מנות)` : ""}`}
      </button>
    </div>
  );
}
