// Requires continuous press (default 1.5s) before firing onConfirm — prevents accidental toggles.
import { useCallback, useRef, useState } from "react";

const HOLD_MS_DEFAULT = 1500;

export default function HoldToConfirmButton({
  onConfirm,
  holdMs = HOLD_MS_DEFAULT,
  disabled = false,
  title,
  children,
  style = {},
  className,
  progressColor = "rgba(255,255,255,0.35)",
}) {
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const holdStartRef = useRef(null);
  const activePointerRef = useRef(null);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    holdStartRef.current = null;
    activePointerRef.current = null;
    setHoldProgress(0);
  }, []);

  const startHold = useCallback((pointerId) => {
    if (disabled) return;
    clearHold();
    activePointerRef.current = pointerId;
    holdStartRef.current = Date.now();
    progressIntervalRef.current = setInterval(() => {
      if (!holdStartRef.current) return;
      const pct = Math.min(100, ((Date.now() - holdStartRef.current) / holdMs) * 100);
      setHoldProgress(pct);
    }, 40);
    holdTimerRef.current = setTimeout(() => {
      clearHold();
      onConfirm?.();
    }, holdMs);
  }, [disabled, holdMs, onConfirm, clearHold]);

  const handlePointerDown = (e) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startHold(e.pointerId);
  };

  const handlePointerUp = (e) => {
    if (activePointerRef.current !== e.pointerId) return;
    clearHold();
  };

  const handlePointerCancel = () => clearHold();

  const holdTitle = title
    ? `${title} — החזק ${holdMs / 1000} שניות לשינוי`
    : `החזק ${holdMs / 1000} שניות לאישור`;

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={holdTitle}
      aria-label={holdTitle}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerCancel}
      onPointerCancel={handlePointerCancel}
      onClick={(e) => e.preventDefault()}
      style={{
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        ...style,
      }}
    >
      {holdProgress > 0 && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: `${holdProgress}%`,
            background: progressColor,
            transition: "width 0.04s linear",
            pointerEvents: "none",
          }}
        />
      )}
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </button>
  );
}
