// ⌘K / Ctrl+K — global guest + navigation search.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { getGuestTimingBadge } from "../utils/guestTiming";

function normalizeSearch(q) {
  return (q ?? "").trim().toLowerCase();
}

function phoneDigits(p) {
  return (p ?? "").replace(/\D/g, "");
}

export default function GlobalCommandPalette({
  open,
  onClose,
  onOpenInbox,
  navItems = [],
  onNavigate,
}) {
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!open || !isSupabaseConfigured || !supabase) return;
    setLoading(true);
    supabase
      .from("guests")
      .select("id, name, phone, room, arrival_date, departure_date, status, portal_token")
      .neq("status", "cancelled")
      .order("arrival_date", { ascending: false })
      .limit(400)
      .then(({ data, error }) => {
        if (!error) setGuests(data ?? []);
        setLoading(false);
      });
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  // Role-filtered — App.js already excludes anything this user can't see/reach
  // (see paletteNavItems there), so no further permission check needed here.
  const navActions = useMemo(() => (
    navItems.map((item) => ({
      id: `nav-${item.id}`,
      label: `${item.icon ?? ""} ${item.label}`.trim(),
      run: () => onNavigate?.(item.id),
    }))
  ), [navItems, onNavigate]);

  // Searchable by label, not just shown as a static default list — previously
  // nav actions vanished entirely the moment you typed anything (guestMatches
  // was the only thing query filtered), so typing e.g. "אוטומציה" found nothing.
  const navMatches = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return navActions;
    return navActions.filter((a) => a.label.toLowerCase().includes(q)).slice(0, 8);
  }, [navActions, query]);

  const guestMatches = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return guests.slice(0, 12);
    const qDigits = phoneDigits(q);
    return guests.filter((g) => {
      const name = (g.name ?? "").toLowerCase();
      const room = (g.room ?? "").toLowerCase();
      const ph = phoneDigits(g.phone);
      return name.includes(q) || room.includes(q) || (qDigits.length >= 3 && ph.includes(qDigits));
    }).slice(0, 15);
  }, [guests, query]);

  const items = useMemo(() => {
    const list = [];
    list.push(...navMatches);
    guestMatches.forEach((g) => {
      list.push({
        id: `guest-${g.id}`,
        type: "guest",
        guest: g,
        label: `${g.name ?? "ללא שם"} · ${g.room ?? "ללא חדר"}`,
        sub: g.phone,
      });
    });
    return list;
  }, [guestMatches, navMatches]);

  const runItem = useCallback((item) => {
    if (!item) return;
    if (item.run) {
      item.run();
      onClose?.();
      return;
    }
    if (item.type === "guest" && item.guest) {
      const g = item.guest;
      const bare = phoneDigits(g.phone);
      onOpenInbox?.({ phone: bare, guestName: g.name });
      onClose?.();
    }
  }, [onClose, onOpenInbox]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, items.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter" && items[selected]) {
        e.preventDefault();
        runItem(items[selected]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, selected, onClose, runItem]);

  if (!open) return null;

  return (
    <div className="cmd-palette-overlay" onClick={onClose} role="presentation">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="חיפוש גלובלי">
        <input
          className="cmd-palette__input"
          autoFocus
          placeholder="חפש אורח, חדר, טלפון… או נווט (Ctrl+K)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
        />
        {loading && <div className="cmd-palette__hint">טוען אורחים…</div>}
        <ul className="cmd-palette__list">
          {items.map((item, idx) => {
            const badge = item.guest ? getGuestTimingBadge(item.guest) : null;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`cmd-palette__item${idx === selected ? " cmd-palette__item--active" : ""}`}
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setSelected(idx)}
                >
                  <span className="cmd-palette__item-label">{item.label}</span>
                  {badge && (
                    <span className="cmd-palette__badge" style={{ color: badge.color }}>
                      {badge.label}
                    </span>
                  )}
                  {item.sub && <span className="cmd-palette__sub">{item.sub}</span>}
                </button>
              </li>
            );
          })}
          {!loading && items.length === 0 && (
            <li className="cmd-palette__empty">לא נמצאו תוצאות</li>
          )}
        </ul>
        <div className="cmd-palette__footer">↑↓ לניווט · Enter לבחירה · Esc לסגירה</div>
      </div>
    </div>
  );
}
