// supabase/functions/_shared/teamOpsDigestFetch.ts
// Shared fetch for team-ops stats appended to Eliad's daily resort digest.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveDigestRange } from "./resortDigestStats.ts";
import {
  computeTeamOpsStats,
  type GuestAlertRow,
  type HousekeepingEventRow,
  type StaffGroupMessageRow,
  type TeamOpsPeriod,
  type TeamOpsStats,
  type TeamOpsTaskRow,
} from "./teamOpsAnalytics.ts";

export async function fetchTeamOpsStatsForPeriod(
  supabase: SupabaseClient,
  period: TeamOpsPeriod,
  now: Date = new Date(),
): Promise<{ stats: TeamOpsStats | null; error?: string }> {
  const range = resolveDigestRange(period, now);
  const rangeStartIso = range.rangeStart.toISOString();
  const rangeEndIso = range.rangeEnd.toISOString();

  const [messagesRes, tasksRes, hkRes, alertsRes] = await Promise.all([
    supabase
      .from("staff_group_messages")
      .select("from_phone, from_name, profile_id, group_key, message_kind, is_operational, operational_kind, created_at")
      .gte("created_at", rangeStartIso)
      .lt("created_at", rangeEndIso),
    supabase
      .from("tasks")
      .select("id, status, created_at, resolved_at, reporter_profile_id, resolved_by_phone, resolved_by_name, sla_deadline")
      .gte("created_at", rangeStartIso)
      .lt("created_at", rangeEndIso),
    supabase
      .from("housekeeping_wa_events")
      .select("room_id, event_type, created_at, from_phone, from_name")
      .gte("created_at", rangeStartIso)
      .lt("created_at", rangeEndIso),
    supabase
      .from("guest_alerts")
      .select("id, resolved, created_at, resolved_at, resolved_by")
      .gte("created_at", rangeStartIso)
      .lt("created_at", rangeEndIso),
  ]);

  if (messagesRes.error || tasksRes.error || hkRes.error || alertsRes.error) {
    return {
      stats: null,
      error:
        messagesRes.error?.message ??
        tasksRes.error?.message ??
        hkRes.error?.message ??
        alertsRes.error?.message ??
        "fetch_failed",
    };
  }

  const tasks = (tasksRes.data ?? []) as TeamOpsTaskRow[];
  const reporterIds = [
    ...new Set(tasks.map((t) => t.reporter_profile_id).filter(Boolean)),
  ] as string[];

  const reporterNames = new Map<string, string>();
  if (reporterIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", reporterIds);
    for (const p of profiles ?? []) {
      const name = String((p as { name?: string | null }).name ?? "").trim();
      if (name) reporterNames.set(p.id as string, name);
    }
  }

  return {
    stats: computeTeamOpsStats({
      period,
      now,
      messages: (messagesRes.data ?? []) as StaffGroupMessageRow[],
      tasks,
      hkEvents: (hkRes.data ?? []) as HousekeepingEventRow[],
      guestAlerts: (alertsRes.data ?? []) as GuestAlertRow[],
      reporterNames,
    }),
  };
}
