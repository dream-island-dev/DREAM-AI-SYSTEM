// Pause Supabase Realtime / polling when the browser tab is hidden — cuts egress
// from staff leaving XOS open in the background (Inbox, dashboards, etc.).
import { useEffect, useState } from "react";

function readVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

/** True while the tab is in the foreground. */
export function usePageVisibility() {
  const [visible, setVisible] = useState(readVisible);

  useEffect(() => {
    const onChange = () => setVisible(readVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

/**
 * setInterval that only ticks while the tab is visible.
 * Runs `fn` once immediately when the tab becomes visible again.
 */
export function useIntervalWhenVisible(fn, delayMs, deps = []) {
  const visible = usePageVisibility();

  useEffect(() => {
    if (!visible || !delayMs) return undefined;
    fn();
    const id = setInterval(fn, delayMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, delayMs, ...deps]);
}
