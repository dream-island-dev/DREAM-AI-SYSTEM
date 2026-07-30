// Suite departure safety net — auto checkout + survey when housekeeping WA missed Co N.
// Primary writer remains housekeeping group; this runs from whatsapp-cron at 16:00 Israel.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AUTO_CHECKOUT_ELIGIBLE_STATUSES,
  israelLocalHour,
  israelYmd,
} from "./automationSchedule.ts";
import { enqueueSuitePostCheckoutSurvey } from "./postCheckoutSurvey.ts";
import { performSuiteCheckOut } from "./suiteCheckinSync.ts";
import { isEffectiveSuiteGuest } from "./suiteNames.ts";

/** Israel-local hour when missed suite departures are auto-checked-out (after staff Co window). */
export const AUTO_CHECKOUT_SUITE_LOCAL_HOUR = 16;

export function isPastSuiteDepartureAutoCheckoutGateway(now: Date = new Date()): boolean {
  return israelLocalHour(now) >= AUTO_CHECKOUT_SUITE_LOCAL_HOUR;
}

type DepartingSuiteGuest = {
  id: number;
  name: string | null;
  room: string | null;
  suite_name: string | null;
  status: string;
  departure_date: string | null;
  room_type: string | null;
};

export async function autoCheckoutMissedSuiteDepartures(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ skipped?: string; scanned: number; checkedOut: number; surveyQueued: number }> {
  if (!isPastSuiteDepartureAutoCheckoutGateway(now)) {
    return { skipped: "before_gateway", scanned: 0, checkedOut: 0, surveyQueued: 0 };
  }

  const today = israelYmd(now);
  const eligibleStatuses = [...AUTO_CHECKOUT_ELIGIBLE_STATUSES];

  const { data: rows, error } = await supabase
    .from("guests")
    .select("id, name, room, suite_name, status, departure_date, room_type")
    .neq("status", "cancelled")
    .lte("departure_date", today)
    .not("departure_date", "is", null)
    .in("status", eligibleStatuses)
    .limit(50);

  if (error) {
    console.error("[suiteDepartureAutoCheckout] lookup failed:", error.message);
    return { skipped: "lookup_error", scanned: 0, checkedOut: 0, surveyQueued: 0 };
  }

  let checkedOut = 0;
  let surveyQueued = 0;

  for (const guest of (rows ?? []) as DepartingSuiteGuest[]) {
    if (!isEffectiveSuiteGuest(guest)) continue;

    const sync = await performSuiteCheckOut(supabase, guest, {
      roomId: guest.room ?? guest.suite_name ?? undefined,
      auditSource: "צ'ק-אאוט אוטומטי 16:00 (לא דווח בקבוצת ניקיון)",
    });
    if (!sync.ok) {
      console.warn(
        `[suiteDepartureAutoCheckout] guest=${guest.id} checkout failed:`,
        sync.error,
      );
      continue;
    }

    checkedOut += 1;
    const survey = await enqueueSuitePostCheckoutSurvey(supabase, {
      guestId: guest.id,
      roomId: sync.roomId ?? (guest.room ? String(guest.room) : null),
      source: "auto_checkout_16h",
    });
    if (survey.queued) surveyQueued += 1;

    console.log(
      `[suiteDepartureAutoCheckout] guest=${guest.id} ${guest.name ?? "—"} ` +
      `room=${sync.roomId ?? "—"} survey=${survey.queued}`,
    );
  }

  if (checkedOut > 0) {
    console.log(
      `[suiteDepartureAutoCheckout] ${today} checked_out=${checkedOut} survey_queued=${surveyQueued}`,
    );
  }

  return { scanned: rows?.length ?? 0, checkedOut, surveyQueued };
}
