// src/components/PhotoTour.js
// Scrollytelling Virtual Tour — "Luxury Resort UI Upgrade (Dream Island
// XOS)" session. No three.js / heavy scroll libraries — each "scene" is a
// plain full-viewport section observed by IntersectionObserver; CSS
// transitions do the crossfade, slow Ken-Burns zoom, and glass-card reveal.
// Background images are layered behind a brand-tinted gradient
// (`linear-gradient(...), url(...)`) so a missing /images/*.jpg degrades to
// a clean gradient instead of a broken-image hole — once a real photo lands
// in public/images/, the same markup picks it up with no code change.
//
// Content (text/CTAs/image filenames) — "Dynamic CMS" session: live source
// is the portal_scenes table (migration 084), publicly readable, edited via
// the admin "🎨 הגדרות פורטל" panel (PortalSettingsPanel.js) with no deploy
// needed. src/data/portalContent.js's PORTAL_SCENES is now ONLY the static
// fallback — used as the initial paint (so there's never a blank/loading
// flash) and the permanent fallback if the DB fetch fails or the table is
// empty. This file has zero scene-specific content of its own either way.
//
// Dream Island "XOS" guest-facing palette — deliberately distinct from the
// staff app's --gold/--ivory CSS variables (§11): deep dark (#09090b) +
// champagne gold (#D4AF37) + light-gray type, minimalist/architectural,
// mirroring the tone of dream-island.co.il rather than a generic "luxury
// template" look.
import { useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { PORTAL_SCENES as STATIC_PORTAL_SCENES } from "../data/portalContent";

const XOS_GOLD = "#D4AF37";
const XOS_BLACK = "#09090b";

// Cycled by scene index — varied tinting without per-scene config. Add more
// entries here (not in portalContent.js) if you want more variety as scenes
// are added; falls back to repeating this list if there are more scenes
// than tints.
const FALLBACK_TINTS = [
  "linear-gradient(135deg, rgba(15,23,42,0.55), rgba(9,9,11,0.8))",
  "linear-gradient(135deg, rgba(15,40,52,0.55), rgba(9,9,11,0.82))",
  "linear-gradient(135deg, rgba(52,15,20,0.55), rgba(9,9,11,0.82))",
  "linear-gradient(135deg, rgba(40,32,12,0.55), rgba(9,9,11,0.84))",
];

function Scene({ image, gradient, title, body, ctas, onUpsell, busyLabel, showScrollHint }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.35 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      style={{
        position: "relative", height: "100vh", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "0 20px",
      }}
    >
      {/* Background layer — full-bleed, slow Ken-Burns creep while in view
          (long transform transition, not a snap) — gradient first so a
          404'd image never leaves a blank hole. */}
      <div
        style={{
          position: "absolute", inset: 0,
          backgroundImage: `${gradient}, url("${image}")`,
          backgroundSize: "cover", backgroundPosition: "center",
          opacity: visible ? 1 : 0.3,
          transform: visible ? "scale(1.12)" : "scale(1)",
          transition: "opacity 1.4s ease, transform 9s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />

      {/* Glassmorphism text card */}
      <div
        style={{
          position: "relative", zIndex: 2, maxWidth: 420, width: "100%",
          background: "rgba(9, 9, 11, 0.42)",
          backdropFilter: "blur(15px)",
          WebkitBackdropFilter: "blur(15px)",
          border: `1px solid rgba(212,175,55,0.3)`,
          borderRadius: 18,
          padding: "30px 28px",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(28px)",
          transition: "opacity 0.9s ease 0.15s, transform 0.9s ease 0.15s",
        }}
      >
        <h2 style={{
          margin: "0 0 12px", fontFamily: "Heebo, system-ui, sans-serif",
          fontSize: 25, fontWeight: 800, color: XOS_GOLD, letterSpacing: 0.4,
        }}>
          {title}
        </h2>
        <p style={{
          margin: "0 0 20px", fontFamily: "Heebo, system-ui, sans-serif",
          fontSize: 14, lineHeight: 1.8, color: "#D1D5DB", fontWeight: 300,
        }}>
          {body}
        </p>
        {ctas?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ctas.map((cta) => {
              const isLink = cta.actionType === "LINK";
              const isBusy = !isLink && busyLabel === cta.upsellLabel;
              return (
                <button
                  key={cta.label}
                  className="dixos-cta"
                  onClick={() => {
                    if (isLink) {
                      window.open(cta.buttonUrl, "_blank", "noopener,noreferrer");
                    } else {
                      // REQUEST → Requests Board (guest_alerts, sales/reception).
                      // OPS_REQUEST → Operations Board (tasks, physical/actionable)
                      // + a direct alert to the duty manager. actionType is passed
                      // through so GuestPortal.js can call the right Edge Function —
                      // see its handleAction().
                      onUpsell(cta.upsellLabel, cta.actionType);
                    }
                  }}
                  disabled={!isLink && !!busyLabel}
                  style={{
                    padding: "13px 16px", borderRadius: 30, border: `1px solid ${XOS_GOLD}`,
                    background: isBusy
                      ? "rgba(212,175,55,0.15)"
                      : "linear-gradient(135deg, rgba(212,175,55,0.92), rgba(180,140,30,0.92))",
                    color: isBusy ? XOS_GOLD : "#1a1505",
                    fontFamily: "Heebo, system-ui, sans-serif", fontSize: 14, fontWeight: 700,
                    cursor: (!isLink && busyLabel) ? "not-allowed" : "pointer",
                    opacity: (!isLink && busyLabel && !isBusy) ? 0.45 : 1,
                  }}
                >
                  {isBusy ? "⏳ שולח/ת..." : cta.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll-down hint — first scene only, fades with scene visibility
          like everything else here rather than lingering once scrolled past. */}
      {showScrollHint && (
        <div
          style={{
            position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)",
            zIndex: 2, opacity: visible ? 0.85 : 0, transition: "opacity 1s ease 0.6s",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          }}
        >
          <span style={{ fontSize: 11, color: "#D1D5DB", letterSpacing: 1.5, fontFamily: "Heebo, system-ui, sans-serif" }}>
            גלילה למטה
          </span>
          <span style={{ fontSize: 20, color: XOS_GOLD, animation: "dixos-bounce 1.8s ease-in-out infinite" }}>
            ↓
          </span>
        </div>
      )}
    </section>
  );
}

export default function PhotoTour({ onUpsell, busyLabel, scenes: scenesProp, upsellBusy }) {
  // Two rendering paths:
  //   1. scenesProp provided (from guest-portal-data, pre-filtered by room_type) →
  //      use directly, no DB fetch. This is the live portal path.
  //   2. scenesProp not provided (staff preview, legacy callers) →
  //      fetch from portal_scenes directly as before. Falls back to static
  //      PORTAL_SCENES if DB unreachable (never a blank portal).
  const [scenes, setScenes] = useState(
    scenesProp && scenesProp.length > 0 ? scenesProp : STATIC_PORTAL_SCENES
  );

  useEffect(() => {
    // Skip DB fetch entirely when the caller supplies pre-filtered scenes.
    if (scenesProp && scenesProp.length > 0) {
      setScenes(scenesProp);
      return;
    }
    let active = true;
    (async () => {
      if (!isSupabaseConfigured || !supabase) return;
      try {
        const { data, error } = await supabase
          .from("portal_scenes")
          .select("image, title, body, ctas")
          .eq("is_active", true)
          .order("sort_order");
        if (!active || error || !data || data.length === 0) return;
        setScenes(data.map((row) => ({
          image: row.image, title: row.title, body: row.body, ctas: row.ctas ?? [],
        })));
      } catch {
        // Network hiccup etc. — keep whatever's already rendered.
      }
    })();
    return () => { active = false; };
  }, [scenesProp]);

  return (
    <div style={{ background: XOS_BLACK }}>
      <style>{`
        @keyframes dixos-bounce {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(8px); }
        }
        .dixos-cta {
          transition: box-shadow 0.3s ease, transform 0.3s ease, opacity 0.2s ease;
        }
        .dixos-cta:hover:not(:disabled) {
          box-shadow: 0 0 28px rgba(212,175,55,0.55);
          transform: translateY(-2px);
        }
        .dixos-cta:active:not(:disabled) {
          transform: translateY(0);
        }
      `}</style>
      {scenes.map((scene, i) => (
        <Scene
          key={`${scene.title}-${i}`}
          {...scene}
          image={`/images/${scene.image}`}
          gradient={FALLBACK_TINTS[i % FALLBACK_TINTS.length]}
          onUpsell={onUpsell}
          busyLabel={busyLabel}
          showScrollHint={i === 0}
        />
      ))}
    </div>
  );
}
