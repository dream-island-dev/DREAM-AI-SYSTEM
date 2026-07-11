// src/components/RequestsAlertWidget.js
// Floating realtime widget for guest_alerts — same Realtime pattern as
// AICopilot.js (room_status watcher), but for the Requests Board: staff
// gets a badge + toast the instant a guest request lands, from any page,
// without needing to be on the Requests Board or refresh anything.
// Resolving happens on the Requests Board itself (with the resolution-note
// modal) — this widget only alerts + navigates there, no inline actions.
//
// Session 24 / Sprint 2 (mobile UI fix): on small screens the bottom-right FAB
// (default bottom:24/right:24) overlapped the WhatsApp inbox composer + send
// button, blocking the chat touch targets. Fix = "Both" approach:
//   1. Mobile-aware DEFAULT anchor — raised clear of the composer (~96px) so it
//      never starts on top of the send button on a ~360px viewport.
//   2. Draggable wrapper — drag it anywhere with a thumb; the chosen spot is
//      persisted to localStorage. Tap-vs-drag is disambiguated by a 6px move
//      threshold, so a normal tap still navigates to the Requests Board.
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

const FAB = 56;                       // FAB diameter (px) — used for drag clamping
const MARGIN = 8;                     // min inset from viewport edges while dragging
const POS_KEY = "requestsWidgetPos";  // localStorage key for the dragged position
const Z_INDEX = 10400;                // above sidebar/mobile chrome; below modal overlays (~9999+)

function clampPos(p) {
  const maxRight = window.innerWidth - FAB - MARGIN;
  const maxBottom = window.innerHeight - FAB - MARGIN;
  return {
    right: Math.max(MARGIN, Math.min(maxRight, p.right)),
    bottom: Math.max(MARGIN, Math.min(maxBottom, p.bottom)),
  };
}

function isPosInBounds(p) {
  if (!p || typeof p.right !== "number" || typeof p.bottom !== "number") return false;
  const maxRight = window.innerWidth - FAB - MARGIN;
  const maxBottom = window.innerHeight - FAB - MARGIN;
  return p.right >= MARGIN && p.right <= maxRight && p.bottom >= MARGIN && p.bottom <= maxBottom;
}

function clearSavedPos() {
  try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ }
}

export default function RequestsAlertWidget({ onNavigate }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState(null);

  // Mobile detection (JS-based, same convention as the inbox's useIsMobile).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      setPos((cur) => {
        if (!cur) return null;
        if (isPosInBounds(cur)) return cur;
        clearSavedPos();
        return null;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Hide on the Inbox thread screen (mobile) — same reasoning as AICopilot.js:
  // App.js's .mobile-bar is gone there too, so the raised default anchor would
  // otherwise float over the composer/send button instead of clearing a bottom
  // nav that isn't shown.
  const [hiddenForThread, setHiddenForThread] = useState(
    () => typeof document !== "undefined" && document.body.classList.contains("wa-inbox-mobile-thread")
  );
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setHiddenForThread(document.body.classList.contains("wa-inbox-mobile-thread"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // User-dragged position override ({ right, bottom } in px) or null = default.
  const [pos, setPos] = useState(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (saved && typeof saved.right === "number" && typeof saved.bottom === "number") {
        if (isPosInBounds(saved)) {
          setPos(saved);
        } else {
          clearSavedPos();
        }
      }
    } catch {
      clearSavedPos();
    }
  }, []);

  // dragging:  pointer is down
  // moved:     pointer travelled past the tap threshold → treat as drag, not click
  const drag = useRef({ dragging: false, moved: false, startX: 0, startY: 0 });

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const loadCount = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    const { count } = await supabase
      .from("guest_alerts")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false);
    setPendingCount(count ?? 0);
  }, []);

  useEffect(() => {
    loadCount();
    if (!isSupabaseConfigured || !supabase) return;

    const ch = supabase
      .channel("requests_board_watch")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "guest_alerts" },
        (payload) => {
          const row = payload.new;
          setPendingCount((prev) => prev + 1);
          const typeLabel = row.alert_type === "complaint" ? "🔴 תקלה" : "📝 בקשה";
          showToast(`${typeLabel} חדשה: ${String(row.message ?? "").slice(0, 60)}`);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "guest_alerts" },
        (payload) => {
          // Only decrement on the false→true transition — avoids drifting the
          // count if a row is updated for an unrelated reason while still open.
          if (payload.new.resolved === true && payload.old.resolved === false) {
            setPendingCount((prev) => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [loadCount]);

  // ── Drag handlers (pointer events — touch + mouse, no library) ──────────────
  const onPointerDown = (e) => {
    drag.current = { dragging: true, moved: false, startX: e.clientX, startY: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d.dragging) return;
    if (!d.moved && (Math.abs(e.clientX - d.startX) > 6 || Math.abs(e.clientY - d.startY) > 6)) {
      d.moved = true;
    }
    if (!d.moved) return;
    setPos(clampPos({
      right: window.innerWidth - e.clientX - FAB / 2,
      bottom: window.innerHeight - e.clientY - FAB / 2,
    }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    d.dragging = false;
    if (d.moved) {
      setPos((cur) => {
        if (!cur) return cur;
        const clamped = clampPos(cur);
        try { localStorage.setItem(POS_KEY, JSON.stringify(clamped)); } catch { /* ignore */ }
        return clamped;
      });
    }
  };
  const handleClick = () => {
    // Suppress the navigation if this pointer sequence was a drag, not a tap.
    if (drag.current.moved) { drag.current.moved = false; return; }
    onNavigate?.("requests_board");
  };

  if (!isSupabaseConfigured) return null;
  if (isMobile && hiddenForThread) return null;

  const hasPending = pendingCount > 0;

  // Default anchor: desktop bottom:24/right:24 (unchanged). Mobile raises the
  // default clear of the inbox composer; a dragged position overrides both.
  const anchor = pos
    ? { right: `${pos.right}px`, bottom: `${pos.bottom}px` }
    : { right: isMobile ? "16px" : "24px", bottom: isMobile ? "96px" : "24px" };

  return (
    <div style={{ position: "fixed", ...anchor, zIndex: Z_INDEX, direction: "rtl", touchAction: "none" }}>
      {toast && (
        <div
          onClick={() => onNavigate?.("requests_board")}
          style={{
            position: "absolute", bottom: "72px", right: 0, minWidth: "240px", maxWidth: "320px",
            background: "#FFF5E8", border: "1px solid #F5A623", color: "#7A4A00",
            borderRadius: "10px", padding: "12px 16px", fontSize: "13px", fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)", cursor: "pointer",
          }}
        >
          {toast}
        </div>
      )}
      <button
        onClick={handleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="לוח בקשות (אפשר לגרור)"
        style={{
          width: `${FAB}px`, height: `${FAB}px`, borderRadius: "50%",
          background: hasPending ? "var(--gold, #C9A96E)" : "#E0D5C5",
          border: "none", cursor: "pointer", fontSize: "24px",
          boxShadow: hasPending ? "0 4px 20px rgba(201,169,110,0.55)" : "0 2px 8px rgba(0,0,0,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
          position: "relative", transition: "background 0.2s ease, box-shadow 0.2s ease",
          touchAction: "none",
        }}
      >
        📋
        {hasPending && (
          <span style={{
            position: "absolute", top: "4px", right: "4px",
            background: "#E24B4A", color: "#fff", borderRadius: "50%",
            width: "18px", height: "18px", fontSize: "11px", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}>{pendingCount}</span>
        )}
      </button>
    </div>
  );
}
