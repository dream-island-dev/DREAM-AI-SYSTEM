// src/components/PhotoTour.js
// Scrollytelling Virtual Tour — Sprint 10.2/10.3 (Pre-Arrival Guest Portal).
//
// No three.js / heavy scroll libraries — each "scene" is a plain full-viewport
// section observed by IntersectionObserver; CSS opacity/transform transitions
// do the crossfade + glass-card reveal. Background images are layered behind
// a brand-tinted gradient (`linear-gradient(...), url(...)`) so a missing
// /images/*.jpg (none are shipped yet — see CLAUDE.md §10) degrades to a
// clean gradient instead of a broken-image hole; once real photography is
// dropped into public/images/, the same markup picks it up with no code change.
//
// Dream Island "XOS" guest-facing palette — deliberately distinct from the
// staff app's --gold/--ivory CSS variables (§11): deep dark + champagne gold,
// per the directive's GLOBAL LUXURY BRANDING PROTOCOL.
import { useEffect, useRef, useState } from "react";

const XOS_GOLD = "#D4AF37";

function Scene({ image, gradient, title, body, ctas, onUpsell, busyLabel }) {
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
      {/* Background layer — gradient first so a 404'd image never leaves a
          blank hole; image (if present) paints over it. */}
      <div
        style={{
          position: "absolute", inset: 0,
          backgroundImage: `${gradient}, url(${image})`,
          backgroundSize: "cover", backgroundPosition: "center",
          opacity: visible ? 1 : 0.35,
          transform: visible ? "scale(1)" : "scale(1.06)",
          transition: "opacity 1.1s ease, transform 1.4s ease",
        }}
      />

      {/* Glassmorphism text card */}
      <div
        style={{
          position: "relative", zIndex: 2, maxWidth: 420, width: "100%",
          background: "rgba(15, 23, 42, 0.45)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: `1px solid rgba(212,175,55,0.35)`,
          borderRadius: 20,
          padding: "28px 26px",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(28px)",
          transition: "opacity 0.9s ease 0.15s, transform 0.9s ease 0.15s",
        }}
      >
        <h2 style={{
          margin: "0 0 10px", fontFamily: "Playfair Display, serif",
          fontSize: 24, fontWeight: 700, color: XOS_GOLD, letterSpacing: 0.3,
        }}>
          {title}
        </h2>
        <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.7, color: "#E5E7EB" }}>
          {body}
        </p>
        {ctas?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ctas.map((cta) => {
              const isBusy = busyLabel === cta.upsellLabel;
              return (
                <button
                  key={cta.upsellLabel}
                  onClick={() => onUpsell(cta.upsellLabel)}
                  disabled={!!busyLabel}
                  style={{
                    padding: "12px 16px", borderRadius: 30, border: `1px solid ${XOS_GOLD}`,
                    background: isBusy
                      ? "rgba(212,175,55,0.15)"
                      : "linear-gradient(135deg, rgba(212,175,55,0.92), rgba(180,140,30,0.92))",
                    color: isBusy ? XOS_GOLD : "#1a1505",
                    fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                    cursor: busyLabel ? "not-allowed" : "pointer",
                    opacity: busyLabel && !isBusy ? 0.45 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  {isBusy ? "⏳ שולח/ת..." : cta.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const SCENES = [
  {
    image: "/images/entrance.jpg",
    gradient: "linear-gradient(135deg, rgba(15,23,42,0.55), rgba(9,9,11,0.75))",
    title: "ברוכים הבאים ל-Dream Island",
    body: "חופשה שתישאר עמכם הרבה אחרי שתחזרו הביתה — כל פרט תוכנן כדי שתרגישו בבית, ברמה של פנטהאוז.",
    ctas: [],
  },
  {
    image: "/images/spa.jpg",
    gradient: "linear-gradient(135deg, rgba(15,40,52,0.55), rgba(9,9,11,0.78))",
    title: "עולם המים והרוגע",
    body: "טיפולי ספא, בריכות מפנקות ושעות של רוגע מוחלט — בדיוק כמו שמגיע לכם.",
    ctas: [{ label: "💆 הזמן/י טיפול ספא", upsellLabel: "בקשת טיפול ספא" }],
  },
  {
    image: "/images/wine.jpg",
    gradient: "linear-gradient(135deg, rgba(52,15,20,0.55), rgba(9,9,11,0.78))",
    title: "קולינריה ויין",
    body: "ארוחות שף, סדנאות יין וטעימות בלתי-נשכחות — חוויה לחמשת החושים.",
    ctas: [
      { label: "🍷 הזמן/י סדנת יין", upsellLabel: "הזמנת סדנת יין" },
      { label: "🍾 שמפניה לסוויטה", upsellLabel: "שמפניה לסוויטה" },
    ],
  },
  {
    image: "/images/suites.jpg",
    gradient: "linear-gradient(135deg, rgba(40,32,12,0.55), rgba(9,9,11,0.8))",
    title: "סוויטות יוקרה",
    body: "כל סוויטה מעוצבת בקפידה לחוויית אירוח מושלמת — הבית-מחוץ-לבית שלכם.",
    ctas: [],
  },
];

export default function PhotoTour({ onUpsell, busyLabel }) {
  return (
    <div>
      {SCENES.map((scene) => (
        <Scene key={scene.title} {...scene} onUpsell={onUpsell} busyLabel={busyLabel} />
      ))}
    </div>
  );
}
