// Full-screen QR for guests — scan to open Armonim website menu.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ARMONIM_EXTERNAL_MENU_URL } from "../../utils/restaurantKioskUi";

export default function RestaurantMenuQrModal({ menuUrl, onClose }) {
  const url = String(menuUrl ?? ARMONIM_EXTERNAL_MENU_URL).trim() || ARMONIM_EXTERNAL_MENU_URL;
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(url, {
          width: 300,
          margin: 2,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch {
        if (!cancelled) setError("לא ניתן ליצור QR");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="תפריט לאורח — QR"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(26, 20, 16, 0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 360, background: "#fff", borderRadius: 20,
          padding: "24px 20px", textAlign: "center", fontFamily: "Heebo, sans-serif",
          boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900, color: "#5D3A1A", marginBottom: 6 }}>
          📱 תפריט לאורח
        </div>
        <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px", lineHeight: 1.5 }}>
          האורח סורק עם המצלמה — נפתח התפריט באתר ערמונים
        </p>

        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="QR לתפריט מסעדת ערמונים"
            style={{
              width: 280, height: 280, maxWidth: "100%",
              borderRadius: 12, border: "1px solid rgba(93, 58, 26, 0.15)",
            }}
          />
        ) : (
          <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
            {error || "יוצר QR…"}
          </div>
        )}

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block", marginTop: 14, fontSize: 12, color: "#008080",
            wordBreak: "break-all", textDecoration: "underline",
          }}
        >
          {url}
        </a>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 18, width: "100%", minHeight: 48, borderRadius: 12,
            border: "none", background: "#5D3A1A", color: "#fff",
            fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "Heebo, sans-serif",
          }}
        >
          סגור
        </button>
      </div>
    </div>
  );
}
