// Sticky operational pulse — arrivals / in-resort / attention / automation health.
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { computeResortPulse, buildGuestsByPhoneKey, countActiveInboxAlerts } from "../utils/resortPulseStats";

const GUEST_SELECT =
  "phone, status, arrival_date, departure_date, room, room_type";

export default function ResortPulseBar({ onAction, className = "" }) {
  const [stats, setStats] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [blockedAutomation, setBlockedAutomation] = useState(0);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const [guestsRes, alertsRes] = await Promise.all([
        supabase.from("guests").select(GUEST_SELECT),
        supabase
          .from("whatsapp_conversations")
          .select("phone")
          .eq("human_requested", true)
          .eq("direction", "inbound"),
      ]);
      if (guestsRes.error) throw guestsRes.error;
      if (alertsRes.error) throw alertsRes.error;

      const guests = guestsRes.data ?? [];
      const inboxAlertsCount = countActiveInboxAlerts(
        (alertsRes.data ?? []).map((r) => r.phone),
        buildGuestsByPhoneKey(guests),
      );

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
      setStats(computeResortPulse(guests, { blockedAutomation: blocked, inboxAlertsCount }));
      setLoadError(null);
    } catch (e) {
      setLoadError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 60_000);
    if (!isSupabaseConfigured || !supabase) return () => clearInterval(iv);

    const chGuests = supabase
      .channel("resort-pulse-guests")
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, () => refresh())
      .subscribe();
    const chWa = supabase
      .channel("resort-pulse-wa-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () => refresh())
      .subscribe();
    return () => {
      clearInterval(iv);
      supabase.removeChannel(chGuests);
      supabase.removeChannel(chWa);
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
