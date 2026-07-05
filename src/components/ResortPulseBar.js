// Sticky operational pulse — arrivals / in-resort / attention / automation health.
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { computeResortPulse } from "../utils/resortPulseStats";

const GUEST_SELECT =
  "status, arrival_date, departure_date, requires_attention, needs_callback";

export default function ResortPulseBar({ onAction, className = "" }) {
  const [stats, setStats] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [blockedAutomation, setBlockedAutomation] = useState(0);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { data: guests, error } = await supabase.from("guests").select(GUEST_SELECT);
      if (error) throw error;

      let blocked = 0;
      try {
        const { data: q } = await supabase.functions.invoke("automation-queue");
        if (q?.attentionRequired) {
          blocked = q.attentionRequired.filter((r) => r.status === "blocked_by_meta").length;
        }
      } catch {
        /* queue preview optional */
      }

      setBlockedAutomation(blocked);
      setStats(computeResortPulse(guests ?? [], { blockedAutomation: blocked }));
      setLoadError(null);
    } catch (e) {
      setLoadError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 60_000);
    if (!isSupabaseConfigured || !supabase) return () => clearInterval(iv);

    const ch = supabase
      .channel("resort-pulse-guests")
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, () => refresh())
      .subscribe();
    return () => {
      clearInterval(iv);
      supabase.removeChannel(ch);
    };
  }, [refresh]);

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
      id: "attention",
      label: "דורש טיפול",
      value: stats?.needsAttention ?? "—",
      emoji: "🔴",
      highlight: (stats?.needsAttention ?? 0) > 0,
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
      <button type="button" className="resort-pulse-bar__refresh" onClick={refresh} title="רענן">
        🔄
      </button>
    </div>
  );
}
