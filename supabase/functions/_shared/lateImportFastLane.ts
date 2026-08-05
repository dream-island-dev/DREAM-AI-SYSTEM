// Late-import / same-day guest fast lane — physical presence and T-0/T-1 imports
// should not block on Stage 1 arrival confirmation (2026-08-05).

import { israelYmd } from "./automationSchedule.ts";

export type PhysicalPresenceSource = "check_in" | "late_import";

function isValidYmd(value: string | null | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim().slice(0, 10));
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** arrival_date is today or tomorrow (Israel) — same-day / T-1 import lane. */
export function isLateImportFastLaneEligible(
  arrivalDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!isValidYmd(arrivalDate)) return false;
  const arrival = arrivalDate.trim().slice(0, 10);
  const today = israelYmd(now);
  return arrival === today || arrival === addDaysYmd(today, 1);
}

/**
 * Physical presence (HK group / manual check-in) or late import = arrival confirmed.
 * Never fakes msg_pre_arrival_* sent flags — only unblocks Stage 2+ eligibility.
 */
export function buildPhysicalPresenceArrivalConfirmPatch(
  guest: {
    arrival_confirmed?: boolean | null;
    arrival_confirmed_at?: string | null;
  },
  now: Date = new Date(),
): Record<string, unknown> | null {
  if (guest.arrival_confirmed === true && guest.arrival_confirmed_at) return null;
  const ts = now.toISOString();
  return {
    arrival_confirmed: true,
    arrival_confirmed_at: guest.arrival_confirmed_at ?? ts,
  };
}

export function buildLateImportFastLanePatch(
  guest: {
    arrival_date?: string | null;
    arrival_confirmed?: boolean | null;
    arrival_confirmed_at?: string | null;
    automation_scope?: string | null;
    automation_muted?: boolean | null;
    room_type?: string | null;
  },
  now: Date = new Date(),
): Record<string, unknown> | null {
  if (guest.automation_scope === "muted" || guest.automation_muted === true) return null;
  if (guest.room_type === "day_guest" || guest.room_type === "premium_day_guest") return null;
  if (!isLateImportFastLaneEligible(guest.arrival_date, now)) return null;
  return buildPhysicalPresenceArrivalConfirmPatch(guest, now);
}
