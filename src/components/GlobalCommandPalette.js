// ⌘K / Ctrl+K — global guest + navigation search.
//
// P0 2026-08-09: this used to fetch the 400 most-recent-arrival guests ONCE on
// open and filter client-side. Any guest outside that window (e.g. an older
// stay once future-dated pending bookings crowd the top of the arrival_date
// sort) was permanently invisible here — confirmed on שרית דהן (id 4358,
// arrival 2026-08-04), who sat ~700 rows deep. Now every keystroke queries the
// DB directly (debounced) across ALL guests, not a cache.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { getGuestTimingBadge } from "../utils/guestTiming";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_SEARCH_LEN = 2;
const DEFAULT_RESULT_LIMIT = 15;
const SEARCH_RESULT_LIMIT = 30;
const GUEST_SEARCH_FIELDS = "id, name, phone, room, arrival_date, departure_date, status, portal_token";

function normalizeSearch(q) {
  return (q ?? "").trim();
}

function phoneDigits(p) {
  return (p ?? "").replace(/\D/g, "");
}

// PostgREST .or() filters split terms on "," and group on "()" — a name/room
// typed with those characters would otherwise corrupt the filter string
// instead of just failing to match, so strip them before building it.
function sanitizeOrTerm(term) {
  return term.replace(/[,()]/g, " ").trim();
}

// Active/upcoming first, then most-recent past stays, cancelled last (still
// findable, just not competing with real guests for the top slots).
function guestSortPriority(g, todayStr) {
  if (g.status === "checked_in" || g.status === "room_ready") return 0;
  if (g.status === "cancelled") return 4;
  if (g.arrival_date && g.arrival_date >= todayStr) return 1;
  if (g.status === "checked_out") return 2;
  return 3;
}

function sortGuests(list) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  return [...list].sort((a, b) => {
    const diff = guestSortPriority(a, today) - guestSortPriority(b, today);
    if (diff !== 0) return diff;
    return (b.arrival_date ?? "").localeCompare(a.arrival_date ?? "");
  });
}

function dedupeGuestsById(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const g of list) {
      if (g?.id != null && !byId.has(g.id)) byId.set(g.id, g);
    }
  }
  return [...byId.values()];
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
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!open || !isSupabaseConfigured || !supabase) return undefined;
    const q = normalizeSearch(query);
    const delay = q.length < MIN_SEARCH_LEN ? 0 : SEARCH_DEBOUNCE_MS;

    const timer = setTimeout(async () => {
      const myRequestId = ++requestIdRef.current;
      setLoading(true);
      try {
        let rows = [];
        if (q.length < MIN_SEARCH_LEN) {
          // Idle/short-query view — light recent-arrivals peek, not a search result.
          const { data, error } = await supabase
            .from("guests")
            .select(GUEST_SEARCH_FIELDS)
            .neq("status", "cancelled")
            .order("arrival_date", { ascending: false })
            .limit(60);
          if (error) console.warn("[GlobalCommandPalette] recent list failed:", error.message);
          rows = sortGuests(data ?? []).slice(0, DEFAULT_RESULT_LIMIT);
        } else {
          const term = sanitizeOrTerm(q);
          const qDigits = phoneDigits(q);
          const orParts = [`name.ilike.%${term}%`, `room.ilike.%${term}%`];
          if (qDigits.length >= 3) orParts.push(`phone.ilike.%${qDigits}%`);

          // ilike catches substring matches across all statuses (incl. cancelled —
          // history must stay findable); match_guest_fuzzy (migration 207,
          // pg_trgm) catches name variants ilike can't, e.g. "דהן" typed for a
          // guest actually named "דאהן" — not a contiguous substring match.
          const [ilikeRes, fuzzyRes] = await Promise.all([
            supabase.from("guests").select(GUEST_SEARCH_FIELDS).or(orParts.join(",")).limit(SEARCH_RESULT_LIMIT),
            supabase.rpc("match_guest_fuzzy", { p_name: q, p_arrival_date: null }),
          ]);
          if (ilikeRes.error) console.warn("[GlobalCommandPalette] guest search failed:", ilikeRes.error.message);
          if (fuzzyRes.error) console.warn("[GlobalCommandPalette] fuzzy match failed:", fuzzyRes.error.message);

          const merged = dedupeGuestsById([ilikeRes.data ?? [], fuzzyRes.data ?? []]);
          rows = sortGuests(merged).slice(0, SEARCH_RESULT_LIMIT);
        }
        if (myRequestId === requestIdRef.current) setGuests(rows);
      } finally {
        if (myRequestId === requestIdRef.current) setLoading(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [open, query]);

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
    const q = normalizeSearch(query).toLowerCase();
    if (!q) return navActions;
    return navActions.filter((a) => a.label.toLowerCase().includes(q)).slice(0, 8);
  }, [navActions, query]);

  // guests is already the server-filtered/sorted/limited result set (see the
  // search effect above) — no client-side re-filtering needed here anymore.
  const guestMatches = guests;

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
        {loading && <div className="cmd-palette__hint">מחפש…</div>}
        <ul className="cmd-palette__list">
          {items.map((item, idx) => {
            // Cancelled bookings stay findable for history/support (FAIL VISIBLE)
            // but must never look like a live "after departure" guest.
            const badge = item.guest
              ? (item.guest.status === "cancelled"
                  ? { label: "⚠ מבוטל", color: "#B91C1C" }
                  : getGuestTimingBadge(item.guest))
              : null;
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
