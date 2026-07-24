// Cohort queries for Dream Bot outreach (service window opener, SOS broadcasts).
// Shared by guest-emergency-broadcast — suite guests only for in-resort cohorts.

import { isEffectiveSuiteGuest } from "./suiteNames.ts";

export type DreamBotCohort =
  | "arrival_today"
  | "arriving_tomorrow"
  | "in_resort"
  | "active"; // in_resort + arriving_tomorrow + arrival_today (deduped)

export type GuestOutreachRow = {
  id: number;
  name: string | null;
  phone: string | null;
  status: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  wa_window_expires_at: string | null;
  room: string | null;
  room_type: string | null;
};

export function israelYmd(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function israelTomorrowYmd(d = new Date()): string {
  const today = israelYmd(d);
  const [y, m, day] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function isMetaWindowOpen(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() > now.getTime();
}

function isSuiteInResort(g: GuestOutreachRow, today: string): boolean {
  if (!isEffectiveSuiteGuest(g)) return false;
  if (g.status !== "checked_in") return false;
  if (!g.arrival_date || g.arrival_date > today) return false;
  if (g.departure_date && g.departure_date < today) return false;
  return true;
}

function isSuiteArrivingTomorrow(g: GuestOutreachRow, tomorrow: string): boolean {
  if (!isEffectiveSuiteGuest(g)) return false;
  if (g.status === "cancelled" || g.status === "checked_out") return false;
  return g.arrival_date === tomorrow;
}

function isSuiteArrivingToday(g: GuestOutreachRow, today: string): boolean {
  if (!isEffectiveSuiteGuest(g)) return false;
  if (g.status === "cancelled" || g.status === "checked_out") return false;
  return g.arrival_date === today;
}

/** Filter fetched guest rows to the requested cohort (client-side after DB fetch). */
export function filterGuestsForDreamBotCohort(
  rows: GuestOutreachRow[],
  cohort: DreamBotCohort,
  opts: { onlyMissingMetaWindow?: boolean; now?: Date } = {},
): GuestOutreachRow[] {
  const now = opts.now ?? new Date();
  const today = israelYmd(now);
  const tomorrow = israelTomorrowYmd(now);

  let filtered: GuestOutreachRow[];
  switch (cohort) {
    case "arrival_today":
      filtered = rows.filter((g) => isSuiteArrivingToday(g, today));
      break;
    case "arriving_tomorrow":
      filtered = rows.filter((g) => isSuiteArrivingTomorrow(g, tomorrow));
      break;
    case "in_resort":
      filtered = rows.filter((g) => isSuiteInResort(g, today));
      break;
    case "active": {
      const seen = new Set<number>();
      filtered = [];
      for (const g of rows) {
        if (seen.has(g.id)) continue;
        if (
          isSuiteInResort(g, today) ||
          isSuiteArrivingTomorrow(g, tomorrow) ||
          isSuiteArrivingToday(g, today)
        ) {
          seen.add(g.id);
          filtered.push(g);
        }
      }
      break;
    }
    default:
      filtered = [];
  }

  if (opts.onlyMissingMetaWindow) {
    filtered = filtered.filter((g) => !isMetaWindowOpen(g.wa_window_expires_at, now));
  }

  return filtered.filter((g) => String(g.phone ?? "").trim() !== "");
}
