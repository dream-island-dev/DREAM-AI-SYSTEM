import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CHECKIN_TIMELINE_LABELS,
  CHECKIN_TIMELINE_TODAY,
} from "../utils/guestCheckinMatrix";
import {
  CHECKIN_FILTER_STORAGE_KEY,
  loadCheckinFilter,
  saveCheckinFilter,
} from "../utils/checkinFilterStorage";

function formatArrivalDateLabel(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

/**
 * Shared timeline + optional exact-date filter for GuestsPage + GuestDashboard.
 * Persists to sessionStorage so both tabs stay in sync when switching routes.
 */
export function useCheckinTimelineFilter({
  initialScope = null,
  initialCustomDate = null,
  onInitialConsumed,
} = {}) {
  const boot = loadCheckinFilter();

  const [timelineScope, setTimelineScopeState] = useState(
    () => initialScope || boot.scope || CHECKIN_TIMELINE_TODAY,
  );
  const [customArrivalDate, setCustomArrivalDateState] = useState(
    () => initialCustomDate ?? boot.customDate ?? null,
  );

  useEffect(() => {
    if (!initialScope && !initialCustomDate) return;
    if (initialScope) setTimelineScopeState(initialScope);
    if (initialCustomDate !== null && initialCustomDate !== undefined) {
      setCustomArrivalDateState(initialCustomDate);
    }
    saveCheckinFilter({
      scope: initialScope || CHECKIN_TIMELINE_TODAY,
      customDate: initialCustomDate || null,
    });
    onInitialConsumed?.();
    // One-shot deep-link focus from App.js — not a recurring sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScope, initialCustomDate]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== CHECKIN_FILTER_STORAGE_KEY || !e.newValue) return;
      try {
        const { scope, customDate } = JSON.parse(e.newValue);
        setTimelineScopeState(scope || CHECKIN_TIMELINE_TODAY);
        setCustomArrivalDateState(customDate || null);
      } catch {
        /* ignore malformed */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTimelineScope = useCallback((scope) => {
    setTimelineScopeState(scope);
    setCustomArrivalDateState(null);
    saveCheckinFilter({ scope, customDate: null });
  }, []);

  const setCustomArrivalDate = useCallback(
    (date) => {
      const next = date || null;
      setCustomArrivalDateState(next);
      saveCheckinFilter({ scope: timelineScope, customDate: next });
    },
    [timelineScope],
  );

  const filterLabel = useMemo(() => {
    if (customArrivalDate) {
      return `הגעה ${formatArrivalDateLabel(customArrivalDate)}`;
    }
    return CHECKIN_TIMELINE_LABELS[timelineScope] || timelineScope;
  }, [customArrivalDate, timelineScope]);

  return {
    timelineScope,
    customArrivalDate,
    setTimelineScope,
    setCustomArrivalDate,
    filterLabel,
    isCustomDateActive: !!customArrivalDate,
  };
}
