// src/components/Toast.js
// Shared fixed-position success/error toast — promoted from PortalSettingsPanel.js's
// private (never exported) Toast/useToast, which every other screen had re-implemented
// slightly differently on its own: different colors, different position (RoomBoard was
// the one outlier at top-right instead of top-center), different showToast() argument
// order (RoomBoard's showToast(msg, type) vs everyone else's showToast(type, msg)),
// different auto-dismiss delay (3000/3500/4000ms). One shared implementation, one look.

import { useState, useCallback } from "react";

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{
      position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
      padding: "12px 24px", borderRadius: 10, fontWeight: 700, fontSize: 14, maxWidth: "90vw",
      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
      color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
      border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
    }}>{toast.msg}</div>
  );
}

/** [toast, showToast] — showToast(type, msg): type is "ok" | "err". */
export function useToast(autoDismissMs = 3500) {
  const [toast, setToast] = useState(null);
  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), autoDismissMs);
  }, [autoDismissMs]);
  return [toast, showToast];
}
