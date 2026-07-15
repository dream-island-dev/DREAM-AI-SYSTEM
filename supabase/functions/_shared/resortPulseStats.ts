// supabase/functions/_shared/resortPulseStats.ts
// Deno-side port of src/utils/resortPulseStats.js + the guestTiming.js helpers
// it depends on — same "duplicated across the front/back boundary" convention
// as suiteNames.ts. Used by the Executive Voice Assistant's get_resort_brief
// tool to build a same-day Hebrew ops snapshot for the CEO.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isEffectiveSuiteGuest } from "./suiteNames.ts";

/** Calendar today in Israel (YYYY-MM-DD) — matches guestTiming.js's israelTodayStr. */
export function israelTodayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/** Add calendar days to a YYYY-MM-DD string (UTC-safe, no TZ drift). */
export function addDaysYmd(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

type GuestRow = {
  id: number;
  status?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
  room?: string | null;
  room_type?: string | null;
};

/** Mirrors guestTiming.js isGuestDeparted. */
export function isGuestDeparted(guest: GuestRow | null | undefined): boolean {
  if (!guest) return false;
  if (guest.status === "checked_out" || guest.status === "cancelled") return true;
  const today = israelTodayStr();
  if (guest.departure_date && guest.departure_date < today) return true;
  return false;
}

/** Mirrors guestTiming.js isGuestInResortToday. */
function isGuestInResortToday(guest: GuestRow): boolean {
  if (!guest.arrival_date) return false;
  if (guest.status !== "checked_in") return false;
  if (isGuestDeparted(guest)) return false;
  const today = israelTodayStr();
  if (guest.arrival_date > today) return false;
  if (guest.departure_date && guest.departure_date < today) return false;
  return true;
}

const PRE_ARRIVAL_STATUSES = new Set(["pending", "expected", "room_ready"]);

function isPreArrivalTodayGuest(guest: GuestRow, today = israelTodayStr()): boolean {
  return PRE_ARRIVAL_STATUSES.has(guest.status ?? "") && guest.arrival_date === today;
}

function isSuiteInResortToday(guest: GuestRow): boolean {
  return isEffectiveSuiteGuest(guest) && isGuestInResortToday(guest);
}

export type ResortBriefTaskCounts = {
  open: number;
  in_progress: number;
  pending_approval: number;
};

export type ResortBriefInputs = {
  guests: GuestRow[];
  taskCounts: ResortBriefTaskCounts;
  inboxAlertsCount: number;
};

/** Same counters as computeResortPulse() (resortPulseStats.js), plus suite/day-pass split. */
export function computeResortBriefStats(inputs: ResortBriefInputs) {
  const today = israelTodayStr();
  let arrivalsToday = 0;
  let inResort = 0;
  let departingToday = 0;
  let suiteInResort = 0;
  let dayPassToday = 0;

  for (const g of inputs.guests) {
    if (!g || g.status === "cancelled") continue;
    if (isPreArrivalTodayGuest(g)) {
      if (isEffectiveSuiteGuest(g)) arrivalsToday += 1;
      else dayPassToday += 1;
    }
    if (g.departure_date === today && g.status !== "checked_out") departingToday += 1;
    if (isSuiteInResortToday(g)) {
      inResort += 1;
      suiteInResort += 1;
    }
  }

  return {
    arrivalsToday,
    dayPassToday,
    inResort,
    suiteInResort,
    departingToday,
    openTasks: inputs.taskCounts.open + inputs.taskCounts.in_progress,
    pendingApprovalTasks: inputs.taskCounts.pending_approval,
    inboxAlertsCount: inputs.inboxAlertsCount,
  };
}

/** Fetches live counters + composes a max-15-line Hebrew resort brief for the CEO. */
export async function fetchResortBrief(supabase: SupabaseClient): Promise<string> {
  const [{ data: guests }, { data: tasks }, { data: alertRows }] = await Promise.all([
    supabase.from("guests").select("id, status, arrival_date, departure_date, room, room_type"),
    supabase.from("tasks").select("status").in("status", ["open", "in_progress", "pending_approval"]),
    supabase
      .from("whatsapp_conversations")
      .select("phone")
      .eq("direction", "inbound")
      .eq("human_requested", true)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const taskCounts: ResortBriefTaskCounts = { open: 0, in_progress: 0, pending_approval: 0 };
  for (const t of (tasks ?? []) as Array<{ status: string }>) {
    if (t.status in taskCounts) (taskCounts as Record<string, number>)[t.status] += 1;
  }

  const guestsById = new Map<number, GuestRow>();
  for (const g of (guests ?? []) as GuestRow[]) guestsById.set(g.id, g);

  const seenPhones = new Set<string>();
  let inboxAlertsCount = 0;
  for (const row of (alertRows ?? []) as Array<{ phone: string }>) {
    const key = (row.phone ?? "").replace(/\D/g, "").slice(-9);
    if (!key || seenPhones.has(key)) continue;
    seenPhones.add(key);
    inboxAlertsCount += 1;
  }

  const stats = computeResortBriefStats({
    guests: (guests ?? []) as GuestRow[],
    taskCounts,
    inboxAlertsCount,
  });

  const lines = [
    `📊 מצב הריזורט — ${israelTodayStr()}`,
    `מגיעים היום (סוויטות): ${stats.arrivalsToday}${stats.dayPassToday ? ` | דיי-פס: ${stats.dayPassToday}` : ""}`,
    `בריזורט כרגע (סוויטות): ${stats.suiteInResort}`,
    `עוזבים היום: ${stats.departingToday}`,
    `משימות פתוחות: ${stats.openTasks}${stats.pendingApprovalTasks ? ` (+${stats.pendingApprovalTasks} ממתינות לאישור)` : ""}`,
    `התראות בתיבה: ${stats.inboxAlertsCount}`,
  ];
  return lines.join("\n");
}
