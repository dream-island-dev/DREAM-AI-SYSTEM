// Collapses a burst of rapid calls (e.g. Supabase Realtime postgres_changes
// events firing once per row) into a single trailing call — cuts refetch
// storms without touching the caller's own logic.
import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback(fn, delayMs) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), delayMs);
  }, [delayMs]);
}
