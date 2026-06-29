// Bottom undo snackbar — non-blocking post-action recovery (6s default).
import { useEffect, useRef, useState } from "react";

export default function UndoSnackbar({
  visible,
  message,
  undoLabel = "ביטול",
  onUndo,
  onDismiss,
  durationMs = 6000,
}) {
  const [progress, setProgress] = useState(100);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      dismissedRef.current = false;
      setProgress(100);
      return undefined;
    }
    dismissedRef.current = false;
    setProgress(100);
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 100 - (elapsed / durationMs) * 100));
      if (elapsed >= durationMs && !dismissedRef.current) {
        dismissedRef.current = true;
        clearInterval(tick);
        onDismiss?.();
      }
    }, 50);
    return () => clearInterval(tick);
  }, [visible, durationMs, onDismiss]);

  const handleUndo = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onUndo?.();
    onDismiss?.();
  };

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        direction: "rtl",
        minWidth: 280,
        maxWidth: "min(92vw, 480px)",
        background: "#1A1A1A",
        color: "#F5F0E8",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        border: "1px solid var(--gold-dark, #A8843A)",
        overflow: "hidden",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 18px",
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{message}</span>
        <button
          type="button"
          onClick={handleUndo}
          style={{
            flexShrink: 0,
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid var(--gold, #C9A96E)",
            background: "rgba(201,169,110,0.15)",
            color: "var(--gold-light, #E8C98A)",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "Heebo, sans-serif",
          }}
        >
          {undoLabel}
        </button>
      </div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.08)" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "var(--gold, #C9A96E)",
            transition: "width 0.05s linear",
          }}
        />
      </div>
    </div>
  );
}
