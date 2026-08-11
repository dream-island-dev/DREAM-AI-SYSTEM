// Sticky operational pulse — arrivals / in-resort / attention / automation health.
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { usePageVisibility } from "../hooks/usePageVisibility";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { computeResortPulse, buildGuestsByPhoneKey, countActiveInboxAlerts } from "../utils/resortPulseStats";
import { fetchGuestsForResortPulse } from "../utils/resortPulseFetch";

const PULSE_CACHE_TTL_MS = 5 * 60_000;
const pulseMemoryCache = { stats: null, blockedAutomation: 0, at: 0 };

export default function ResortPulseBar({ onAction, className = "" }) {
  const pageVisible = usePageVisibility();
  const [stats, setStats] = useState(() => pulseMemoryCache.stats);
  const [loadError, setLoadError] = useState(null);
  const [blockedAutomation, setBlockedAutomation] = useState(() => pulseMemoryCache.blockedAutomation);

  const refresh = useCallback(async (opts = {}) => {
    if (!isSupabaseConfigured || !supabase) return;
    const force = opts.force === true;
    if (
      !force
      && pulseMemoryCache.stats
      && Date.now() - pulseMemoryCache.at < PULSE_CACHE_TTL_MS
    ) {
      setStats(pulseMemoryCache.stats);
      setBlockedAutomation(pulseMemoryCache.blockedAutomation);
      return;
    }
    try {
      const [guestsPack, alertsRes] = await Promise.all([
        fetchGuestsForResortPulse(supabase, {
          // Pulse chips don't need arrival_time / name — keep payload lean.
          select: "phone, status, arrival_date, departure_date, room, room_type",
        }),
        supabase
          .from("whatsapp_conversations")
          .select("phone")
          .eq("human_requested", true)
          .eq("direction", "inbound"),
      ]);
      if (alertsRes.error) throw alertsRes.error;

      const guests = guestsPack.guests ?? [];
      const inboxAlerts = countActiveInboxAlerts(
        (alertsRes.data ?? []).map((r) => r.phone),
        buildGuestsByPhoneKey(guests),
      );

      let blocked = 0;
      const queueStale = Date.now() - pulseMemoryCache.at >= PULSE_CACHE_TTL_MS;
      if (force || queueStale) {
        try {
          const { data: q } = await supabase.functions.invoke("automation-queue");
          if (q?.attentionRequired) {
            blocked = q.attentionRequired.filter((r) => r.status === "blocked_by_meta").length;
          }
        } catch {
          /* queue preview optional */
        }
      } else {
        blocked = pulseMemoryCache.blockedAutomation;
      }

      const nextStats = computeResortPulse(guests, {
        blockedAutomation: blocked,
        inboxAlertsCount: inboxAlerts.total,
        inboxAlertsCountSuite: inboxAlerts.suite,
        inboxAlertsCountDaypass: inboxAlerts.daypass,
        inboxAlertsCountUnmatched: inboxAlerts.unmatched,
      });
      pulseMemoryCache.stats = nextStats;
      pulseMemoryCache.blockedAutomation = blocked;
      pulseMemoryCache.at = Date.now();
      setBlockedAutomation(blocked);
      setStats(nextStats);
      setLoadError(null);
    } catch (e) {
      setLoadError(e?.message ?? String(e));
    }
  }, []);

  const debouncedForceRefresh = useDebouncedCallback(() => refresh({ force: true }), 2500);

  useEffect(() => {
    if (!pageVisible) return undefined;
    refresh({ force: !pulseMemoryCache.stats });
    const iv = setInterval(() => refresh(), 60_000);
    if (!isSupabaseConfigured || !supabase) return () => clearInterval(iv);

    const onGuests = () => debouncedForceRefresh();
    const chGuests = supabase
      .channel("resort-pulse-guests")
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, onGuests)
      .subscribe();
    const chWa = supabase
      .channel("resort-pulse-wa-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, onGuests)
      .subscribe();
    return () => {
      clearInterval(iv);
      supabase.removeChannel(chGuests);
      supabase.removeChannel(chWa);
    };
  }, [refresh, debouncedForceRefresh, pageVisible]);

  if (!stats && !loadError) return null;

  const chips = [
    {
      id: "arrivals_today",
      label: "מגיעים היום",
      value: stats?.arrivalsToday ?? "—",
      emoji: "📅",
    },
    {
      id: "in_resort",
      label: "בריזורט",
      value: stats?.inResort ?? "—",
      emoji: "🟢",
    },
    {
      id: "departing_today",
      label: "עוזבים היום",
      value: stats?.departingToday ?? "—",
      emoji: "🚪",
    },
    {
      id: "attention_suite",
      label: "טיפול · סוויטות",
      value: stats?.needsAttentionSuite ?? "—",
      emoji: "🔴",
      highlight: (stats?.needsAttentionSuite ?? 0) > 0,
    },
    {
      id: "attention_daypass",
      label: "טיפול · בילוי יומי",
      value: stats?.needsAttentionDaypass ?? "—",
      emoji: "🔴",
      highlight: (stats?.needsAttentionDaypass ?? 0) > 0,
    },
    {
      id: "automation",
      label: "חסום Meta",
      value: blockedAutomation,
      emoji: "⚠️",
      highlight: blockedAutomation > 0,
    },
  ];

  return (
    <div className={`resort-pulse-bar ${className}`.trim()}>
      {loadError && (
        <span className="resort-pulse-bar__err" title={loadError}>
          ⚠ שגיאת טעינת מצב מלון
        </span>
      )}
      <span className="resort-pulse-bar__title">מצב מלון</span>
      <div className="resort-pulse-bar__chips">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`resort-pulse-chip${chip.highlight ? " resort-pulse-chip--alert" : ""}`}
            onClick={() => onAction?.(chip.id)}
            title={`פתח: ${chip.label}`}
          >
            <span className="resort-pulse-chip__emoji">{chip.emoji}</span>
            <span className="resort-pulse-chip__value">{chip.value}</span>
            <span className="resort-pulse-chip__label">{chip.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className="resort-pulse-bar__refresh" onClick={() => refresh({ force: true })} title="רענן">
        🔄
      </button>
    </div>
  );
}
